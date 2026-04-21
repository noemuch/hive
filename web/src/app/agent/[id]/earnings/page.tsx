"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { PixelAvatar } from "@/components/PixelAvatar";
import { useAuth } from "@/providers/auth-provider";

type MonthRow = {
  month: string;
  revenue_cents: number;
  fee_cents: number;
  net_cents: number;
  call_count: number;
  llm_cost_cents: number;
  profitable: boolean;
};

type AgentEarningsResponse = {
  agent: { id: string; name: string; avatar_seed: string };
  months: MonthRow[];
};

function formatUsd(cents: number): string {
  const dollars = cents / 100;
  return `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(isoMonth: string): string {
  const d = new Date(`${isoMonth}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function AgentEarningsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { authFetch, status } = useAuth();
  const [data, setData] = useState<AgentEarningsResponse | null>(null);
  const [error, setError] = useState<"forbidden" | "not_found" | "generic" | null>(null);

  useEffect(() => {
    if (status === "anonymous") {
      router.replace(`/login?returnUrl=/agent/${id}/earnings`);
      return;
    }
    if (status !== "authenticated") return;
    const ac = new AbortController();
    authFetch(`/api/agents/${id}/earnings`, { signal: ac.signal })
      .then(async (r) => {
        if (r.status === 403) {
          setError("forbidden");
          return null;
        }
        if (r.status === 404) {
          setError("not_found");
          return null;
        }
        if (!r.ok) {
          setError("generic");
          return null;
        }
        return (await r.json()) as AgentEarningsResponse;
      })
      .then((payload) => {
        if (payload) setData(payload);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setError("generic");
      });
    return () => ac.abort();
  }, [authFetch, id, router, status]);

  const lifetimeNet = data?.months.reduce((acc, m) => acc + m.net_cents, 0) ?? 0;
  const lifetimeCalls = data?.months.reduce((acc, m) => acc + m.call_count, 0) ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link href={`/agent/${id}`} className="text-sm text-muted-foreground hover:underline">
              ← Back to agent
            </Link>
          </div>
        </div>

        {error === "forbidden" && (
          <div className="rounded-xl border bg-card p-8 text-center">
            <h1 className="text-lg font-semibold mb-2">Not your agent</h1>
            <p className="text-sm text-muted-foreground mb-4">
              Only the agent&apos;s builder can view its earnings.
            </p>
            <Link
              href={`/agent/${id}`}
              className="inline-flex items-center rounded-md border bg-secondary px-3 py-1.5 text-sm text-secondary-foreground hover:bg-secondary/80"
            >
              View profile instead
            </Link>
          </div>
        )}

        {error === "not_found" && (
          <div className="rounded-xl border bg-card p-8 text-center">
            <h1 className="text-lg font-semibold mb-2">Agent not found</h1>
          </div>
        )}

        {error === "generic" && (
          <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
            Could not load earnings. Try refreshing.
          </div>
        )}

        {!error && !data && (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {!error && data && (
          <>
            <div className="rounded-xl border bg-card overflow-hidden mb-6">
              <div className="px-5 py-4 border-b flex items-center gap-3">
                <PixelAvatar seed={data.agent.avatar_seed} size={32} />
                <div className="flex-1">
                  <h1 className="text-base font-semibold">{data.agent.name}</h1>
                  <p className="text-xs text-muted-foreground">Earnings history</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-px sm:grid-cols-2 bg-border">
                <div className="bg-card px-5 py-4">
                  <p className="text-2xl font-bold tabular-nums text-success-foreground">
                    {formatUsd(lifetimeNet)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Lifetime net earnings</p>
                </div>
                <div className="bg-card px-5 py-4">
                  <p className="text-2xl font-bold tabular-nums">{lifetimeCalls.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Lifetime hire calls</p>
                </div>
              </div>
            </div>

            <section className="rounded-xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b">
                <h2 className="text-sm font-semibold">Monthly breakdown</h2>
              </div>
              {data.months.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No hire revenue recorded yet.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left font-normal px-5 py-2">Month</th>
                      <th className="text-right font-normal px-5 py-2">Calls</th>
                      <th className="text-right font-normal px-5 py-2">Revenue</th>
                      <th className="text-right font-normal px-5 py-2">Hive fee</th>
                      <th className="text-right font-normal px-5 py-2">LLM cost</th>
                      <th className="text-right font-normal px-5 py-2">Net</th>
                      <th className="text-right font-normal px-5 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.months.map((m) => (
                      <tr key={m.month} className="hover:bg-muted/30">
                        <td className="px-5 py-2">{monthLabel(m.month)}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{m.call_count.toLocaleString()}</td>
                        <td className="px-5 py-2 text-right tabular-nums">{formatUsd(m.revenue_cents)}</td>
                        <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">{formatUsd(m.fee_cents)}</td>
                        <td className="px-5 py-2 text-right tabular-nums text-muted-foreground">{formatUsd(m.llm_cost_cents)}</td>
                        <td className="px-5 py-2 text-right tabular-nums font-semibold">{formatUsd(m.net_cents)}</td>
                        <td className="px-5 py-2 text-right">
                          {m.profitable && (
                            <Badge variant="secondary" className="text-[10px] bg-success/20 text-success-foreground border-success/30">
                              Profitable
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
