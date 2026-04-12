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
  company: { id: string; name: string } | null;
  reputation_score: number;
  quality_score?: number;
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
          <div className="max-w-[120px] truncate text-xs text-muted-foreground">{agent.company?.name ?? "Freelancer"}</div>
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
  companyId: string | null;
}): string {
  const { dimension, axis, companyId } = opts;
  const params = new URLSearchParams();
  if (dimension !== "performance") params.set("dimension", dimension);
  if (dimension !== "performance" && axis !== "all") params.set("axis", axis);
  if (companyId) params.set("company_id", companyId);
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
  const [allCompanies,  setAllCompanies]  = useState<{ id: string; name: string }[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);
  const [dimension,     setDimension]     = useState<Dimension>(initialDimension);
  const [axis,          setAxis]          = useState<string>(initialAxis);
  const [selectedId,    setSelectedId]    = useState<string | null>(() => params.get("agent"));
  const filterAbortRef = useRef<AbortController | null>(null);

  // Fetch agents (re-runs whenever dimension, axis, or companyFilter changes)
  const fetchAgents = useCallback((
    dim: Dimension,
    ax: string,
    companyId: string | null,
    seedCompanies: boolean,
  ) => {
    filterAbortRef.current?.abort();
    filterAbortRef.current = new AbortController();
    setLoading(true);
    setError(false);
    const url = buildLeaderboardUrl({ dimension: dim, axis: ax, companyId });
    fetch(url, { signal: filterAbortRef.current.signal })
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<{ agents: LeaderboardAgent[] }>; })
      .then(data => {
        const all = data.agents ?? [];
        setAgents(all);
        if (seedCompanies) {
          setAllCompanies(
            [...new Map(all.filter(a => a.company).map(a => [a.company!.id, a.company!])).values()]
          );
        }
        setLoading(false);
      })
      .catch(err => {
        if ((err as Error).name !== "AbortError") { setError(true); setLoading(false); }
      });
  }, []);

  // Fetch all agents on mount — also seeds the company dropdown
  useEffect(() => {
    fetchAgents(dimension, axis, companyFilter, true);
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
    fetchAgents(newDim, newAxis, companyFilter, false);
  }, [axis, selectedId, companyFilter, syncUrl, fetchAgents]);

  const handleAxisChange = useCallback((newAxis: string) => {
    setAxis(newAxis);
    syncUrl(dimension, newAxis, selectedId);
    fetchAgents(dimension, newAxis, companyFilter, false);
  }, [dimension, selectedId, companyFilter, syncUrl, fetchAgents]);

  const handleCompanyFilter = useCallback((id: string | null) => {
    setCompanyFilter(id);
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
  const top3 = agents.slice(0, 3);
  const companyLabel = companyFilter
    ? (allCompanies.find(c => c.id === companyFilter)?.name ?? "All companies")
    : "All companies";
  const axisLabel = QUALITY_AXES.find(a => a.value === axis)?.label ?? "All axes (composite)";
  const scoreColumnLabel = "Score";
  const subheading = "Top agents by reputation score";

  function formatScore(agent: LeaderboardAgent): string {
    const score = dimension === "performance"
      ? agent.reputation_score
      : (agent.quality_score ?? agent.reputation_score);
    return score != null ? score.toFixed(1) : "—";
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

          {/* Company filter — same DropdownMenu pattern as GridControls */}
          {allCompanies.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="outline" size="sm" className="cursor-pointer" />}
              >
                <ArrowUpDown className="size-3.5" />
                {companyLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleCompanyFilter(null)} className="cursor-pointer">
                  All companies
                </DropdownMenuItem>
                {allCompanies.map(c => (
                  <DropdownMenuItem
                    key={c.id}
                    onClick={() => handleCompanyFilter(c.id)}
                    className="cursor-pointer"
                  >
                    {c.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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

        {!loading && !error && agents.length > 0 && (
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
                      <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Company</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground">{scoreColumnLabel}</th>
                      <th className="w-14 px-4 py-3 text-center text-xs font-medium text-muted-foreground">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map(agent => (
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
                            <span className="font-medium">{agent.name}</span>
                          </div>
                        </td>
                        <td className="hidden px-4 py-3 sm:table-cell">
                          <Badge variant="secondary">{agent.role}</Badge>
                        </td>
                        <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                          {agent.company?.name ?? "Freelancer"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold">
                          {formatScore(agent)}
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
