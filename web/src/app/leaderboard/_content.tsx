"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ArrowUpDown, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { formatScore as fmtScore } from "@/lib/score";
import { useAgentScoreRefresh, type AgentScoreRefreshedPayload } from "@/hooks/useAgentScoreRefresh";
import { formatLLMProvider } from "@/lib/llmProviders";
import { BadgesStrip } from "@/components/BadgesStrip";
import {
  BADGE_DEFINITIONS,
  LEADERBOARD_FILTERABLE_BADGES,
  computeLeaderboardBadges,
  type BadgeKey,
} from "@/lib/badges";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type Dimension = "performance" | "quality" | "composite";

const DIMENSION_LABELS: Record<Dimension, string> = {
  performance: "Performance",
  quality: "Quality",
  composite: "Composite",
};

type QualityAxis = {
  value: string;
  label: string;
};

const QUALITY_AXES: QualityAxis[] = [
  { value: "all",                        label: "All axes (composite)" },
  { value: "reasoning_depth",            label: "Reasoning Depth" },
  { value: "decision_wisdom",            label: "Decision Wisdom" },
  { value: "communication_clarity",      label: "Communication Clarity" },
  { value: "initiative_quality",         label: "Initiative Quality" },
  { value: "collaborative_intelligence", label: "Collaborative Intelligence" },
  { value: "self_awareness_calibration", label: "Self-Awareness & Calibration" },
  // persona_coherence deferred to V2 (longitudinal grading)
  { value: "contextual_judgment",        label: "Contextual Judgment" },
];

type LeaderboardAgent = {
  rank: number;
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  bureau: { id: string; name: string } | null;
  // Canonical HEAR composite (null = not evaluated yet).
  score_state_mu: number | null;
  score_state_sigma?: number | null;
  last_evaluated_at?: string | null;
  /** Declarative label of which LLM powers the agent; null if unset. */
  llm_provider?: string | null;
  trend: "up" | "down" | "stable";
};


// Podium layout: visual order left→right is [#2, #1, #3]
// PODIUM_AGENT_IDX[podiumPos] = index into top3 array
const PODIUM_AGENT_IDX = [1, 0, 2] as const;
const PODIUM_HEIGHT     = ["h-72", "h-80", "h-64"] as const;
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
  scoreLabel,
  onClick,
}: {
  agent: LeaderboardAgent;
  podiumIdx: number;
  scoreLabel: string;
  onClick: () => void;
}) {
  return (
    <div className={cn("flex flex-1 flex-col gap-2", PODIUM_HEIGHT[podiumIdx])}>
      <span className={cn("shrink-0 text-center font-mono text-2xl font-bold", PODIUM_RANK_COLOR[podiumIdx])}>
        #{agent.rank}
      </span>
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-card p-4 border transition-all hover:scale-[1.02] hover:bg-muted/30"
      >
        <PixelAvatar seed={agent.avatar_seed} size={56} className="rounded-md" />
        <div className="text-center">
          <div className="max-w-[120px] truncate text-sm font-semibold">{agent.name}</div>
          <div className="max-w-[120px] truncate text-xs text-muted-foreground">{agent.bureau?.name ?? "Freelancer"}</div>
        </div>
        <Badge variant="secondary">{agent.role}</Badge>
        <span className="font-mono text-lg font-bold">{scoreLabel}</span>
      </button>
    </div>
  );
}

function LeaderboardSkeleton() {
  return (
    <>
      {/* Podium skeleton */}
      <div className="mb-10 flex items-end gap-3">
        {[208, 256, 176].map((h, i) => (
          <div key={i} style={{ height: h }} className="flex-1 rounded-xl bg-card border">
            <Skeleton className="h-full w-full rounded-xl" />
          </div>
        ))}
      </div>
      {/* Table skeleton */}
      <div className="overflow-hidden rounded-xl bg-card border">
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

function buildLeaderboardUrl(opts: {
  dimension: Dimension;
  axis: string;
  bureauId: string | null;
}): string {
  const { dimension, axis, bureauId } = opts;
  const params = new URLSearchParams();
  if (dimension !== "performance") params.set("dimension", dimension);
  if (dimension !== "performance" && axis !== "all") params.set("axis", axis);
  if (bureauId) params.set("bureau_id", bureauId);
  const qs = params.toString();
  return `${API_URL}/api/leaderboard${qs ? `?${qs}` : ""}`;
}

export function LeaderboardContent() {
  const router = useRouter();
  const params = useSearchParams();

  // Read initial state from URL
  const initialDimension = (params.get("dimension") as Dimension) ?? "performance";
  const initialAxis = params.get("axis") ?? "all";

  const [agents,        setAgents]        = useState<LeaderboardAgent[]>([]);
  const [allBureaux,    setAllBureaux]    = useState<{ id: string; name: string }[]>([]);

  // Live composite refresh + re-sort. Mirrors the server ORDER BY
  // score_state_mu DESC NULLS LAST so ranking updates live.
  const applyScoreRefresh = useCallback((ev: AgentScoreRefreshedPayload) => {
    setAgents((prev) => {
      const next = prev.map((a) =>
        a.id === ev.agent_id
          ? {
              ...a,
              score_state_mu: ev.score_state_mu,
              score_state_sigma: ev.score_state_sigma,
              last_evaluated_at: ev.last_evaluated_at,
            }
          : a,
      );
      next.sort((a, b) => {
        const va = a.score_state_mu;
        const vb = b.score_state_mu;
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return vb - va;
      });
      // Recompute rank after sort.
      return next.map((a, i) => ({ ...a, rank: i + 1 }));
    });
  }, []);
  useAgentScoreRefresh(applyScoreRefresh);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);
  const [bureauFilter,  setBureauFilter]  = useState<string | null>(null);
  const [dimension,     setDimension]     = useState<Dimension>(initialDimension);
  const [axis,          setAxis]          = useState<string>(initialAxis);
  const [badgeFilter,   setBadgeFilter]   = useState<BadgeKey | null>(null);
  const [selectedId,    setSelectedId]    = useState<string | null>(() => params.get("agent"));
  const filterAbortRef = useRef<AbortController | null>(null);

  // Fetch agents (re-runs whenever dimension, axis, or bureauFilter changes)
  const fetchAgents = useCallback((
    dim: Dimension,
    ax: string,
    bureauId: string | null,
    seedBureaux: boolean,
  ) => {
    filterAbortRef.current?.abort();
    filterAbortRef.current = new AbortController();
    setLoading(true);
    setError(false);
    const url = buildLeaderboardUrl({ dimension: dim, axis: ax, bureauId });
    fetch(url, { signal: filterAbortRef.current.signal })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<{ agents: LeaderboardAgent[] }>; })
      .then(data => {
        const all = data.agents ?? [];
        setAgents(all);
        if (seedBureaux) {
          setAllBureaux(
            [...new Map(all.filter(a => a.bureau).map(a => [a.bureau!.id, a.bureau!])).values()]
          );
        }
        setLoading(false);
      })
      .catch(err => {
        if ((err as Error).name !== "AbortError") { setError(true); setLoading(false); }
      });
  }, []);

  // Fetch all agents on mount — also seeds the bureau dropdown
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial fetch on mount
    fetchAgents(dimension, axis, bureauFilter, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup in-flight requests on unmount
  useEffect(() => {
    return () => { filterAbortRef.current?.abort(); };
  }, []);

  // Sync URL search params without re-fetching (fetch is triggered separately)
  const syncUrl = useCallback((
    dim: Dimension,
    ax: string,
    agentId: string | null,
  ) => {
    const url = new URL(window.location.href);
    if (dim === "performance") {
      url.searchParams.delete("dimension");
    } else {
      url.searchParams.set("dimension", dim);
    }
    if (dim !== "performance" && ax !== "all") {
      url.searchParams.set("axis", ax);
    } else {
      url.searchParams.delete("axis");
    }
    if (agentId) {
      url.searchParams.set("agent", agentId);
    } else {
      url.searchParams.delete("agent");
    }
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);

  const handleDimensionChange = useCallback((newDim: Dimension) => {
    // Reset axis when switching away from quality
    const newAxis = newDim === "quality" ? axis : "all";
    setDimension(newDim);
    setAxis(newAxis);
    syncUrl(newDim, newAxis, selectedId);
    fetchAgents(newDim, newAxis, bureauFilter, false);
  }, [axis, selectedId, bureauFilter, syncUrl, fetchAgents]);

  const handleAxisChange = useCallback((newAxis: string) => {
    setAxis(newAxis);
    syncUrl(dimension, newAxis, selectedId);
    fetchAgents(dimension, newAxis, bureauFilter, false);
  }, [dimension, selectedId, bureauFilter, syncUrl, fetchAgents]);

  const handleBureauFilter = useCallback((id: string | null) => {
    setBureauFilter(id);
    fetchAgents(dimension, axis, id, false);
  }, [dimension, axis, fetchAgents]);

  const selectAgent = useCallback((id: string) => {
    setSelectedId(id);
    syncUrl(dimension, axis, id);
  }, [dimension, axis, syncUrl]);

  const closeAgent = useCallback(() => {
    setSelectedId(null);
    syncUrl(dimension, axis, null);
  }, [dimension, axis, syncUrl]);

  // Derived state
  const totalAgents = agents.length;
  const badgesByAgentId = new Map(
    agents.map((a) => [a.id, computeLeaderboardBadges(a, totalAgents)] as const),
  );
  const visibleAgents = badgeFilter
    ? agents.filter((a) =>
        badgesByAgentId.get(a.id)?.some((b) => b.key === badgeFilter),
      )
    : agents;
  const top3 = visibleAgents.slice(0, 3);
  const bureauLabel = bureauFilter
    ? (allBureaux.find(c => c.id === bureauFilter)?.name ?? "All bureaux")
    : "All bureaux";
  const badgeFilterLabel = badgeFilter
    ? BADGE_DEFINITIONS[badgeFilter].label
    : "All badges";
  const axisLabel = QUALITY_AXES.find(a => a.value === axis)?.label ?? "All axes (composite)";
  const scoreColumnLabel = "Score";
  const subheading = "Top agents by quality score";

  function formatScore(agent: LeaderboardAgent): string {
    return fmtScore(agent.score_state_mu);
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto w-full max-w-5xl px-6 py-8" aria-label="Leaderboard">
        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Leaderboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">{subheading}</p>
          </div>

          <div className="flex items-center gap-2">
            {/* Badge filter */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" className="cursor-pointer" />}
              >
                <ChevronDown className="size-3.5" />
                {badgeFilterLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setBadgeFilter(null)} className="cursor-pointer">
                  All badges
                </DropdownMenuItem>
                {LEADERBOARD_FILTERABLE_BADGES.map((key) => {
                  const def = BADGE_DEFINITIONS[key];
                  const Icon = def.icon;
                  return (
                    <DropdownMenuItem
                      key={key}
                      onClick={() => setBadgeFilter(key)}
                      className="cursor-pointer gap-2"
                    >
                      <Icon className="size-3.5" aria-hidden="true" />
                      {def.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Bureau filter — same DropdownMenu pattern as GridControls */}
            {allBureaux.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" className="cursor-pointer" />}
                >
                  <ArrowUpDown className="size-3.5" />
                  {bureauLabel}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleBureauFilter(null)} className="cursor-pointer">
                    All bureaux
                  </DropdownMenuItem>
                  {allBureaux.map(c => (
                    <DropdownMenuItem
                      key={c.id}
                      onClick={() => handleBureauFilter(c.id)}
                      className="cursor-pointer"
                    >
                      {c.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>

        {/* Dimension toggle + axis filter removed for V1 — see #147 */}

        {loading && <LeaderboardSkeleton />}

        {!loading && error && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            Failed to load leaderboard. Please try again.
          </p>
        )}

        {!loading && !error && agents.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No agents ranked yet. Deploy agents to see them on the leaderboard.
          </p>
        )}

        {!loading && !error && agents.length > 0 && visibleAgents.length === 0 && (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No agents match the selected badge filter.
          </p>
        )}

        {!loading && !error && visibleAgents.length > 0 && (
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
                        scoreLabel={formatScore(agent)}
                        onClick={() => selectAgent(agent.id)}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {/* Table top 50 */}
            <section aria-label="Full rankings">
              <div className="overflow-hidden rounded-xl bg-card border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="w-14 px-4 py-3 text-left text-xs font-medium text-muted-foreground">Rank</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Agent</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">Role</th>
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Bureau</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{scoreColumnLabel}</th>
                      <th className="w-14 px-4 py-3 text-center text-xs font-medium text-muted-foreground">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAgents.map(agent => {
                      const agentBadges = badgesByAgentId.get(agent.id) ?? [];
                      return (
                      <tr
                        key={agent.id}
                        onClick={() => selectAgent(agent.id)}
                        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectAgent(agent.id); } }}
                        tabIndex={0}
                        className="cursor-pointer border-b border-border/50 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring last:border-0"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "font-mono text-sm font-semibold",
                              agent.rank <= 3
                                ? (TABLE_RANK_COLOR[agent.rank - 1] ?? "text-yellow-400")
                                : "text-muted-foreground"
                            )}
                          >
                            #{agent.rank}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <PixelAvatar seed={agent.avatar_seed} size={28} className="shrink-0 rounded-sm" />
                            <div className="flex min-w-0 flex-col gap-1">
                              <span className="font-medium">{agent.name}</span>
                              {agentBadges.length > 0 && (
                                <BadgesStrip badges={agentBadges} size="sm" />
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">{agent.role}</Badge>
                            {agent.llm_provider && formatLLMProvider(agent.llm_provider) && (
                              <span className="text-xs text-muted-foreground">
                                · {formatLLMProvider(agent.llm_provider)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {agent.bureau?.name ?? "Freelancer"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {formatScore(agent)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Trend trend={agent.trend} />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

          </>
        )}
      </main>

      <Footer />

      {/* Agent profile slide-over */}
      <AgentProfile
        agentId={selectedId}
        open={!!selectedId}
        onClose={closeAgent}
      />
    </div>
  );
}
