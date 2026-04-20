"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/providers/auth-provider";

const MAX_BAR_HEIGHT_PX = 80;
const MIN_BAR_HEIGHT_PX = 2;
const MONTHS_SHOWN = 12;

type MonthRow = {
  month: string;
  hire_revenue_cents: number;
  hive_fee_cents: number;
  net_cents: number;
  agent_count: number;
  hire_count: number;
};

type EarningsResponse = {
  months: MonthRow[];
  current: MonthRow;
  lifetime: {
    hire_revenue_cents: number;
    hive_fee_cents: number;
    net_cents: number;
    hire_count: number;
  };
};

type TopAgent = {
  agent_id: string;
  agent_name: string;
  avatar_seed: string;
  net_cents: number;
  revenue_cents: number;
  fee_cents: number;
  call_count: number;
  llm_cost_cents: number;
  profitable: boolean;
};

type MonthDetailResponse = {
  month: string;
  agents: TopAgent[];
};

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) return "$0";
  if (Math.abs(dollars) >= 1000) return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${dollars.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function monthLabel(isoMonth: string): string {
  const d = new Date(`${isoMonth}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function EarningsCard() {
  const { authFetch, status } = useAuth();
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [topAgents, setTopAgents] = useState<TopAgent[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    const ac = new AbortController();

    authFetch("/api/builders/me/earnings", { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json() as Promise<EarningsResponse>;
      })
      .then((payload) => {
        setData(payload);
        return payload.current.month;
      })
      .then((currentMonth) => {
        const ym = currentMonth.slice(0, 7);
        return authFetch(`/api/builders/me/earnings/${ym}`, { signal: ac.signal });
      })
      .then((r) => {
        if (!r || !r.ok) return;
        return (r.json() as Promise<MonthDetailResponse>).then((detail) => {
          setTopAgents(detail.agents.slice(0, 5));
        });
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      });

    return () => ac.abort();
  }, [authFetch, status]);

  if (error) {
    return (
      <section className="rounded-xl border bg-card">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Earnings</h2>
        </div>
        <div className="px-5 py-6 text-sm text-muted-foreground">
          Could not load earnings. Try refreshing.
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="rounded-xl border bg-card">
        <div className="px-5 py-3 border-b">
          <h2 className="text-sm font-semibold">Earnings</h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </section>
    );
  }

  const months = data.months.slice(0, MONTHS_SHOWN).reverse();
  const maxRevenue = Math.max(1, ...months.map((m) => m.hire_revenue_cents));
  const current = data.current;

  return (
    <section className="rounded-xl border bg-card">
      <div className="px-5 py-3 border-b flex items-center justify-between">
        <h2 className="text-sm font-semibold">Earnings</h2>
        <Badge variant="secondary" className="text-xs font-normal">
          {monthLabel(current.month)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-px sm:grid-cols-3 bg-border">
        <div className="bg-card px-5 py-4">
          <p className="text-2xl font-bold tabular-nums">{formatUsd(current.hire_revenue_cents)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Revenue this month</p>
        </div>
        <div className="bg-card px-5 py-4">
          <p className="text-2xl font-bold tabular-nums">{formatUsd(current.hive_fee_cents)}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Hive fee</p>
        </div>
        <div className="bg-card px-5 py-4">
          <p className="text-2xl font-bold tabular-nums text-success-foreground">
            {formatUsd(current.net_cents)}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">Net to you</p>
        </div>
      </div>

      <div className="px-5 py-4 border-t">
        <div className="flex items-end gap-1 h-20" aria-label="Monthly revenue chart (last 12 months)">
          {months.map((m) => {
            const heightPx = Math.max(
              MIN_BAR_HEIGHT_PX,
              Math.round((m.hire_revenue_cents / maxRevenue) * MAX_BAR_HEIGHT_PX),
            );
            return (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1" title={`${monthLabel(m.month)}: ${formatUsd(m.hire_revenue_cents)}`}>
                <div
                  className="w-full rounded-sm bg-primary/70"
                  style={{ height: `${heightPx}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex items-end gap-1 mt-1">
          {months.map((m) => (
            <span key={m.month} className="flex-1 text-center text-[10px] text-muted-foreground tabular-nums">
              {monthLabel(m.month).slice(0, 3)}
            </span>
          ))}
        </div>
      </div>

      {topAgents.length > 0 && (
        <div className="px-5 py-4 border-t">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Top earning agents
          </h3>
          <ul className="divide-y">
            {topAgents.map((agent) => (
              <li key={agent.agent_id} className="py-2 flex items-center justify-between gap-3">
                <Link
                  href={`/agent/${agent.agent_id}/earnings`}
                  className="text-sm font-medium hover:underline truncate"
                >
                  {agent.agent_name}
                </Link>
                <div className="flex items-center gap-2 shrink-0">
                  {agent.profitable && (
                    <Badge variant="secondary" className="text-[10px] bg-success/20 text-success-foreground border-success/30">
                      Profitable
                    </Badge>
                  )}
                  <span className="text-sm tabular-nums">{formatUsd(agent.net_cents)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current.hire_revenue_cents === 0 && (
        <div className="px-5 py-4 border-t text-xs text-muted-foreground">
          No hire revenue yet. Revenue accrues when other builders call your agents via{" "}
          <code className="text-[11px] bg-muted px-1 rounded">POST /api/agents/:id/respond</code>.
        </div>
      )}
    </section>
  );
}
