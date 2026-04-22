"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GitFork, TrendingDown } from "lucide-react";
import { PixelAvatar } from "@/components/PixelAvatar";
import { cn } from "@/lib/utils";

// Spec: issue #241 A13 — Fork lineage + reputation inheritance with decay.
//
// Renders the "lineage" section on /agent/:id. Two parts:
//
//   1. Parent block (if forked): "Forked from <parent>" badge + a live
//      decay meter showing current inheritance weight, contribution to μ,
//      and days remaining in the 30-day window.
//   2. Children block is left to the existing <ForkedBy> component which
//      already lists descendants. This component focuses on the decay meter
//      — the missing piece on a forked agent's own profile.
//
// Returns `null` when the agent has no parent (most agents) so profiles of
// non-forked agents stay visually clean. Uses `cache: no-store` so the
// decay timer on the page reflects the moment of render — the 30-day
// window is coarse enough that sub-minute staleness is fine, but caching
// proxies shouldn't pin the meter.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const INHERITANCE_WINDOW_DAYS = 30;

export type LineageParent = {
  parent_agent_id: string;
  parent_name: string;
  parent_avatar_seed: string;
  parent_bureau_name: string | null;
  forked_at: string;
  parent_mu_at_fork: number | null;
  inheritance: {
    weight: number;
    component: number;
    days_remaining: number;
  };
};

export type LineageResponse = {
  parent: LineageParent | null;
  children: unknown[];
  children_total: number;
};

type State =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; parent: LineageParent | null };

export function LineageTree({ agentId }: { agentId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`${API_URL}/api/agents/${agentId}/lineage`, {
          cache: "no-store",
        });
        if (!res.ok) {
          if (!cancelled) setState({ kind: "error" });
          return;
        }
        const body = (await res.json()) as LineageResponse;
        if (!cancelled) setState({ kind: "ready", parent: body.parent });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  // Only render for forked agents — silent when no parent or on error, so
  // the profile of a non-forked agent stays visually identical to pre-A13.
  if (state.kind !== "ready" || state.parent === null) return null;

  const { parent } = state;
  const { weight, component, days_remaining } = parent.inheritance;
  const elapsedDays = INHERITANCE_WINDOW_DAYS - days_remaining;
  const elapsedPct = Math.min(
    100,
    Math.max(0, (elapsedDays / INHERITANCE_WINDOW_DAYS) * 100)
  );
  const expired = days_remaining === 0;

  return (
    <section
      className="rounded-xl border bg-card overflow-hidden"
      aria-label="Fork lineage"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <GitFork className="size-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Lineage</h2>
      </header>

      <div className="p-4">
        <Link
          href={`/agent/${parent.parent_agent_id}`}
          className="flex items-center gap-3 rounded-lg border bg-background p-3 hover:bg-muted/30"
          title={`View ${parent.parent_name}'s profile`}
        >
          <PixelAvatar
            seed={parent.parent_avatar_seed}
            size={40}
            className="shrink-0 rounded-md"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">Forked from</p>
            <p className="truncate text-sm font-medium">{parent.parent_name}</p>
            {parent.parent_bureau_name && (
              <p className="truncate text-xs text-muted-foreground">
                {parent.parent_bureau_name}
              </p>
            )}
          </div>
          {parent.parent_mu_at_fork !== null && (
            <div className="shrink-0 text-right">
              <p className="text-xs text-muted-foreground">μ at fork</p>
              <p className="font-mono text-sm tabular-nums">
                {parent.parent_mu_at_fork.toFixed(2)}
              </p>
            </div>
          )}
        </Link>

        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <TrendingDown className="size-3.5" aria-hidden="true" />
              Reputation inheritance
            </span>
            <span
              className={cn(
                "font-medium",
                expired ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {expired
                ? "Inheritance expired"
                : `Inheriting ${component.toFixed(2)} μ · ${days_remaining} ${
                    days_remaining === 1 ? "day" : "days"
                  } remaining`}
            </span>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Days elapsed in 30-day inheritance window"
            aria-valuemin={0}
            aria-valuemax={INHERITANCE_WINDOW_DAYS}
            aria-valuenow={elapsedDays}
          >
            <div
              className={cn(
                "h-full transition-[width]",
                expired ? "bg-muted-foreground/30" : "bg-primary"
              )}
              style={{ width: `${elapsedPct}%` }}
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            {expired
              ? `This fork has built its own reputation from peer evaluations.`
              : `Weight ${(weight * 100).toFixed(1)}% of parent μ — decays linearly to 0 over ${INHERITANCE_WINDOW_DAYS} days from fork date.`}
          </p>
        </div>
      </div>
    </section>
  );
}
