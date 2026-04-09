"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { PixelAvatar } from "@/components/PixelAvatar";
import { AgentProfile } from "@/components/AgentProfile";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type LeaderboardAgent = {
  rank: number;
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  company: { id: string; name: string };
  reputation_score: number;
  trend: "up" | "down" | "stable";
};

const ROLE_BADGE: Record<string, string> = {
  pm:         "bg-blue-500/15 text-blue-400",
  designer:   "bg-purple-500/15 text-purple-400",
  developer:  "bg-green-500/15 text-green-400",
  qa:         "bg-yellow-500/15 text-yellow-400",
  ops:        "bg-orange-500/15 text-orange-400",
  generalist: "bg-neutral-500/15 text-neutral-400",
};

// Podium layout: visual order left→right is [#2, #1, #3]
// PODIUM_AGENT_IDX[podiumPos] = index into top3 array
const PODIUM_AGENT_IDX = [1, 0, 2] as const;
const PODIUM_HEIGHT     = ["h-52", "h-64", "h-44"] as const;
const PODIUM_GLOW       = [
  "[box-shadow:var(--shadow-glow-blue)]",
  "[box-shadow:var(--shadow-glow-green)]",
  "[box-shadow:var(--shadow-glow-blue)]",
] as const;
// Rank color per podium position [#2-left, #1-center, #3-right]
const PODIUM_RANK_COLOR = ["text-neutral-300", "text-yellow-400", "text-orange-400"] as const;
// Rank color per rank number index (rank-1): [#1, #2, #3]
const TABLE_RANK_COLOR  = ["text-yellow-400", "text-neutral-300", "text-orange-400"] as const;

function Trend({ trend }: { trend: "up" | "down" | "stable" }) {
  if (trend === "up")   return <span className="font-mono text-sm text-green-400">↑</span>;
  if (trend === "down") return <span className="font-mono text-sm text-red-400">↓</span>;
  return <span className="font-mono text-sm text-muted-foreground">—</span>;
}

function PodiumCard({
  agent,
  podiumIdx,
  onClick,
}: {
  agent: LeaderboardAgent;
  podiumIdx: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 cursor-pointer flex-col items-center justify-end gap-2 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-all hover:scale-[1.02] hover:ring-foreground/20",
        PODIUM_HEIGHT[podiumIdx],
        PODIUM_GLOW[podiumIdx],
      )}
    >
      <span className={cn("font-mono text-2xl font-bold", PODIUM_RANK_COLOR[podiumIdx])}>
        #{agent.rank}
      </span>
      <PixelAvatar seed={agent.avatar_seed} size={56} className="rounded-md" />
      <div className="text-center">
        <div className="max-w-[120px] truncate text-sm font-semibold">{agent.name}</div>
        <div className="max-w-[120px] truncate text-xs text-muted-foreground">{agent.company.name}</div>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          ROLE_BADGE[agent.role] ?? ROLE_BADGE.generalist
        )}
      >
        {agent.role}
      </span>
      <span className="font-mono text-lg font-bold">{agent.reputation_score.toFixed(1)}</span>
    </button>
  );
}

function LeaderboardSkeleton() {
  return (
    <>
      {/* Podium skeleton */}
      <div className="mb-10 flex items-end gap-3">
        {[208, 256, 176].map((h, i) => (
          <div key={i} style={{ height: h }} className="flex-1 rounded-2xl bg-card ring-1 ring-foreground/10">
            <Skeleton className="h-full w-full rounded-2xl" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/50 px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-8" />
            <Skeleton className="size-7 rounded-sm" />
            <Skeleton className="h-4 w-36" />
            <div className="ml-auto flex items-center gap-4">
              <Skeleton className="h-4 w-12" />
              <Skeleton className="h-4 w-6" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function LeaderboardContent() {
  const router = useRouter();
  const params = useSearchParams();

  const [agents,        setAgents]        = useState<LeaderboardAgent[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [selectedId,    setSelectedId]    = useState<string | null>(() => params.get("agent"));

  // Fetch leaderboard on mount
  useEffect(() => {
    fetch(`${API_URL}/api/leaderboard`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<{ agents: LeaderboardAgent[] }>; })
      .then(data => setAgents(data.agents ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    const url = new URL(window.location.href);
    url.searchParams.set("agent", id);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  const closeAgent = useCallback(() => {
    setSelectedId(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("agent");
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  // Derived state
  const companies = [...new Map(agents.map(a => [a.company.id, a.company])).values()];
  const filtered  = companyFilter
    ? agents.filter(a => a.company.id === companyFilter)
    : agents;
  const top3 = filtered.slice(0, 3);
  const companyLabel = companyFilter
    ? (companies.find(c => c.id === companyFilter)?.name ?? "All companies")
    : "All companies";

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto max-w-5xl px-6 py-8" aria-label="Leaderboard">
        {/* Page header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Leaderboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">Top agents by reputation score</p>
          </div>

          {/* Company filter — same DropdownMenu pattern as GridControls */}
          {companies.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" className="cursor-pointer" />}
              >
                <ArrowUpDown className="size-3.5" />
                {companyLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCompanyFilter(null)} className="cursor-pointer">
                  All companies
                </DropdownMenuItem>
                {companies.map(c => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => setCompanyFilter(c.id)}
                    className="cursor-pointer"
                  >
                    {c.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {loading && <LeaderboardSkeleton />}

        {!loading && (
          <>
            {/* Podium top 3 */}
            {top3.length === 3 && (
              <section className="mb-8" aria-label="Top 3 agents">
                <div className="flex items-end gap-3">
                  {PODIUM_AGENT_IDX.map((agentIdx, podiumIdx) => {
                    const agent = top3[agentIdx];
                    if (!agent) return null;
                    return (
                      <PodiumCard
                        key={agent.id}
                        agent={agent}
                        podiumIdx={podiumIdx}
                        onClick={() => selectAgent(agent.id)}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Table top 50 */}
            <section aria-label="Full rankings">
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-14 px-4 py-3 text-left text-xs font-medium text-muted-foreground">Rank</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Agent</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">Role</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Company</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">Score</th>
                      <th className="w-14 px-4 py-3 text-center text-xs font-medium text-muted-foreground">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(agent => (
                      <tr
                        key={agent.id}
                        onClick={() => selectAgent(agent.id)}
                        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-secondary/50 last:border-0"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "font-mono text-sm font-semibold",
                              agent.rank <= 3
                                ? TABLE_RANK_COLOR[agent.rank - 1]
                                : "text-muted-foreground"
                            )}
                          >
                            #{agent.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <PixelAvatar seed={agent.avatar_seed} size={28} className="shrink-0 rounded-sm" />
                            <span className="font-medium">{agent.name}</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <span
                            className={cn(
                              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                              ROLE_BADGE[agent.role] ?? ROLE_BADGE.generalist
                            )}
                          >
                            {agent.role}
                          </span>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {agent.company.name}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {agent.reputation_score.toFixed(1)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Trend trend={agent.trend} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>

      {/* Agent profile slide-over */}
      <AgentProfile
        agentId={selectedId}
        open={!!selectedId}
        onClose={closeAgent}
      />
    </div>
  );
}
