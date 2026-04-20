"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Button } from "@/components/ui/button";
import { GitFork } from "lucide-react";

// Spec: issue #212 — on /agent/:id, if the agent has been forked,
// render a "X builders forked this agent" section with avatars + names.
// Endpoint: GET /api/agents/:id/forks?limit=N → { forks, total }.

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const PREVIEW_LIMIT = 10;
const FULL_LIMIT = 100;

type Fork = {
  child_agent_id: string;
  child_name: string;
  child_avatar_seed: string;
  builder_name: string | null;
  forked_at: string;
};

type ForksResponse = { forks: Fork[]; total: number };

type FetchState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; forks: Fork[]; total: number; expanded: boolean };

export function ForkedBy({ agentId }: { agentId: string }) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  const fetchForks = useCallback(
    async (limit: number, expanded: boolean) => {
      try {
        const res = await fetch(
          `${API_URL}/api/agents/${agentId}/forks?limit=${limit}`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          setState({ kind: "error" });
          return;
        }
        const body = (await res.json()) as ForksResponse;
        setState({
          kind: "ready",
          forks: body.forks,
          total: body.total,
          expanded,
        });
      } catch {
        setState({ kind: "error" });
      }
    },
    [agentId]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial fetch on mount / agentId change
    void fetchForks(PREVIEW_LIMIT, false);
  }, [fetchForks]);

  // Most agents have zero forks — returning null during loading avoids a
  // skeleton flash on every profile. On error or zero forks, also render
  // nothing so the section only appears when there's something to show.
  if (state.kind !== "ready") return null;
  if (state.total === 0) return null;

  const { forks, total, expanded } = state;
  const hasMore = total > forks.length;
  const label = total === 1 ? "1 fork" : `${total.toLocaleString()} forks`;

  return (
    <div
      className="rounded-xl border bg-card overflow-hidden"
      aria-label="Forks of this agent"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <GitFork className="size-4" aria-hidden="true" />
          {label}
        </h2>
      </div>
      <ul className="divide-y">
        {forks.map((fork) => (
          <li
            key={fork.child_agent_id}
            className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30"
          >
            <Link
              href={`/agent/${fork.child_agent_id}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <PixelAvatar
                seed={fork.child_avatar_seed}
                size={32}
                className="shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{fork.child_name}</p>
                {fork.builder_name && (
                  <p className="truncate text-xs text-muted-foreground">
                    by {fork.builder_name}
                  </p>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {hasMore && !expanded && (
        <div className="border-t px-4 py-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => void fetchForks(FULL_LIMIT, true)}
          >
            View all {total.toLocaleString()} forks
          </Button>
        </div>
      )}
    </div>
  );
}

