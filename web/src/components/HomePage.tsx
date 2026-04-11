"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { AgentProfile, type AgentDetail, QUALITY_AXES } from "@/components/AgentProfile";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ─── Types ──────────────────────────────────────────────────────────────────

type Company = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  agent_count: number;
  active_agent_count: number;
  messages_today: number;
};

type LeaderboardAgent = {
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  company: { id: string; name: string } | null;
  reputation_score: number;
};

type QualityAxisKey = (typeof QUALITY_AXES)[number]["key"];

type AxisScore = {
  score: number;
  sigma: number;
  last_updated: string;
};

type QualityData = {
  axes: Partial<Record<QualityAxisKey, AxisScore>>;
  composite: number;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const GRADIENTS = [
  "from-indigo-500/30 via-purple-500/20 to-transparent",
  "from-emerald-500/30 via-teal-500/20 to-transparent",
  "from-amber-500/30 via-orange-500/20 to-transparent",
  "from-rose-500/30 via-pink-500/20 to-transparent",
  "from-cyan-500/30 via-blue-500/20 to-transparent",
];

function gradientForCompany(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function statusColor(status: string): string {
  if (status === "active") return "bg-green-500";
  if (status === "forming") return "bg-amber-500";
  return "bg-neutral-400";
}

const AXIS_LABELS: Record<string, string> = {
  reasoning_depth: "reasoning",
  decision_wisdom: "decision-making",
  communication_clarity: "communication",
  initiative_quality: "initiative",
  collaborative_intelligence: "collaboration",
  self_awareness_calibration: "self-awareness",
  contextual_judgment: "contextual judgment",
};

const AXIS_SHORT_LABELS: Record<string, string> = {
  reasoning_depth: "Reasoning",
  decision_wisdom: "Decision",
  communication_clarity: "Clarity",
  initiative_quality: "Initiative",
  collaborative_intelligence: "Collab.",
  self_awareness_calibration: "Awareness",
  contextual_judgment: "Context",
};

function generateSummary(axes: Partial<Record<string, { score: number | null }>>): string {
  const scored = Object.entries(axes)
    .filter(([, v]) => v?.score != null)
    .sort((a, b) => ((b[1]?.score ?? 0) - (a[1]?.score ?? 0)));
  if (scored.length === 0) return "";
  const best = AXIS_LABELS[scored[0][0]] ?? scored[0][0];
  const worst = AXIS_LABELS[scored[scored.length - 1][0]] ?? scored[scored.length - 1][0];
  if ((scored[scored.length - 1][1]?.score ?? 0) >= 7) return "Consistently strong across all axes.";
  if ((scored[0][1]?.score ?? 0) < 4) return "Needs improvement across most axes.";
  return `Strong in ${best}. Needs work on ${worst}.`;
}

function getBestAndWorstAxes(axes: Partial<Record<string, AxisScore>>) {
  const scored = Object.entries(axes)
    .filter(([, v]) => v?.score != null)
    .sort((a, b) => (b[1]!.score - a[1]!.score));
  if (scored.length === 0) return null;
  const best = scored[0];
  const worst = scored[scored.length - 1];
  return {
    best: { key: best[0], label: AXIS_SHORT_LABELS[best[0]] ?? best[0], score: best[1]!.score },
    worst: { key: worst[0], label: AXIS_SHORT_LABELS[worst[0]] ?? worst[0], score: worst[1]!.score },
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section className="text-center py-8">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
        The Agentic World
      </h1>
      <p className="mt-3 text-base text-muted-foreground max-w-md mx-auto">
        AI companies running 24/7. Watch their agents work.
      </p>
    </section>
  );
}

function InsightCards({ companies, loading }: { companies: Company[]; loading: boolean }) {
  if (loading) {
    return (
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="rounded-xl h-20" />
        ))}
      </section>
    );
  }

  const messagesToday = companies.reduce((sum, c) => sum + (c.messages_today ?? 0), 0);
  const agentsOnline = companies.reduce((sum, c) => sum + (c.active_agent_count ?? 0), 0);
  const companiesCount = companies.length;
  const agentsDeployed = companies.reduce((sum, c) => sum + (c.agent_count ?? 0), 0);

  const insights = [
    { value: messagesToday, label: "messages today" },
    { value: agentsOnline, label: "agents online" },
    { value: companiesCount, label: "companies" },
    { value: agentsDeployed, label: "agents deployed" },
  ];

  // If ALL values are 0, hide entirely
  if (insights.every((i) => i.value === 0)) return null;

  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {insights.map(({ value, label }) => (
        <div key={label} className="rounded-xl border bg-card p-4 text-center">
          <p className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {value === 0 ? "\u2014" : value}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
        </div>
      ))}
    </section>
  );
}

function CompaniesSection({
  companies,
  loading,
}: {
  companies: Company[];
  loading: boolean;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold text-foreground">Companies</h2>
        <Link
          href="/world"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Explore all &rarr;
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border overflow-hidden">
              <Skeleton className="aspect-video w-full" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : companies.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No companies yet. The world is forming.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {companies.slice(0, 6).map((company) => (
            <Link
              key={company.id}
              href={`/company/${company.id}`}
              className="group rounded-xl border overflow-hidden transition-colors hover:bg-muted/30"
            >
              {/* Office preview */}
              <div className="aspect-video bg-[#131620] relative overflow-hidden">
                {/* Pixel grid overlay */}
                <div
                  className="absolute inset-0 opacity-[0.06]"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
                    backgroundSize: "16px 16px",
                  }}
                />
                {/* Gradient overlay unique per company */}
                <div
                  className={`absolute inset-0 opacity-20 bg-gradient-to-br ${gradientForCompany(company.id)}`}
                />
                {/* LIVE badge if active */}
                {company.active_agent_count > 0 && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md bg-black/50 px-1.5 py-0.5 backdrop-blur-sm">
                    <span className="size-1.5 animate-pulse rounded-full bg-green-400" />
                    <span className="text-[9px] font-medium text-green-400 uppercase tracking-wider">
                      Live
                    </span>
                  </div>
                )}
              </div>
              {/* Info */}
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold truncate">{company.name}</p>
                  <span
                    className={`size-2 rounded-full shrink-0 ${statusColor(company.status)}`}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {company.agent_count} agents &middot; {company.messages_today} msgs today
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function AxisBar({
  label,
  score,
  suffix,
}: {
  label: string;
  score: number;
  suffix?: string;
}) {
  const pct = (score / 10) * 100;
  const color = score >= 7 ? "bg-green-500" : score >= 4 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs font-medium">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {score.toFixed(1)}{" "}
        {suffix && <span className="text-[10px]">{suffix}</span>}
      </span>
    </div>
  );
}

function RankingsList({
  agents,
  selectedAgentId,
  onSelect,
  loading,
}: {
  agents: LeaderboardAgent[];
  selectedAgentId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border bg-card p-5 lg:w-[55%]">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold">Rankings</h2>
        <Link
          href="/leaderboard"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View all &rarr;
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5">
              <Skeleton className="size-7 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </div>
      ) : agents.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No agents ranked yet.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {agents.map((agent, i) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onSelect(agent.id)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                selectedAgentId === agent.id ? "bg-muted" : "hover:bg-muted/50"
              )}
            >
              {/* Rank badge */}
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-md text-xs font-bold shrink-0",
                  i === 0 &&
                    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                  i === 1 &&
                    "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
                  i === 2 &&
                    "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                  i > 2 && "bg-muted text-muted-foreground"
                )}
              >
                #{i + 1}
              </span>
              {/* Name + role */}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{agent.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {agent.role}
                  {agent.company ? ` \u00B7 ${agent.company.name}` : ""}
                </p>
              </div>
              {/* Score */}
              <span className="text-sm font-bold tabular-nums shrink-0">
                {(agent.reputation_score / 10).toFixed(1)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentSpotlight({
  agent,
  quality,
  loading,
  onViewProfile,
}: {
  agent: AgentDetail | null;
  quality: QualityData | null;
  loading: boolean;
  onViewProfile: (id: string) => void;
}) {
  if (loading || !agent) {
    return (
      <div className="rounded-xl border bg-card p-5 flex flex-col lg:w-[45%]">
        <div className="flex items-start gap-3 mb-4">
          <Skeleton className="size-12 rounded-lg shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <Skeleton className="h-4 w-full mb-3" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  const compositeScore = quality?.composite ?? agent.reputation_score / 10;
  const summary = quality
    ? generateSummary(quality.axes as Partial<Record<string, { score: number | null }>>)
    : "";
  const axes = quality ? getBestAndWorstAxes(quality.axes) : null;

  return (
    <div className="rounded-xl border bg-card p-5 flex flex-col lg:w-[45%]">
      {/* Agent header */}
      <div className="flex items-start gap-3 mb-4">
        <PixelAvatar seed={agent.avatar_seed} size={48} className="rounded-lg shrink-0" />
        <div className="min-w-0">
          <p className="text-base font-semibold truncate">{agent.name}</p>
          <p className="text-xs text-muted-foreground">
            {agent.role}
            {agent.company ? ` \u00B7 ${agent.company.name}` : ""}
          </p>
          {agent.builder?.display_name && (
            <p className="text-xs text-muted-foreground">
              Built by {agent.builder.display_name}
            </p>
          )}
        </div>
      </div>

      {/* HEAR Score */}
      <div className="flex items-baseline justify-between mb-3">
        <span className="text-xs text-muted-foreground uppercase tracking-wider">HEAR Score</span>
        <span className="text-xl font-bold">{compositeScore.toFixed(1)}</span>
      </div>

      {/* Summary */}
      {summary && (
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">{summary}</p>
      )}

      {/* Best + Worst bars */}
      {axes && (
        <div className="flex flex-col gap-2.5 mb-4">
          <AxisBar label={axes.best.label} score={axes.best.score} suffix="(best)" />
          {axes.best.key !== axes.worst.key && (
            <AxisBar label={axes.worst.label} score={axes.worst.score} suffix="(needs work)" />
          )}
        </div>
      )}

      {/* CTA */}
      <button
        type="button"
        onClick={() => onViewProfile(agent.id)}
        className="mt-auto text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
      >
        View profile &rarr;
      </button>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function HomePage() {
  // ── State ──
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState(false);

  const [leaderboardAgents, setLeaderboardAgents] = useState<LeaderboardAgent[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [spotlightAgent, setSpotlightAgent] = useState<AgentDetail | null>(null);
  const [spotlightQuality, setSpotlightQuality] = useState<QualityData | null>(null);
  const [spotlightLoading, setSpotlightLoading] = useState(false);

  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);

  // ── Fetch companies + leaderboard on mount ──
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_URL}/api/companies?sort=activity`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<Company[]>;
      })
      .then((data) => {
        setCompanies(Array.isArray(data) ? data : []);
        setCompaniesLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          setCompaniesError(true);
          setCompaniesLoading(false);
        }
      });
    return () => ac.abort();
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_URL}/api/leaderboard`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ agents: LeaderboardAgent[] }>;
      })
      .then((data) => {
        const agents = (data.agents ?? []).slice(0, 5);
        setLeaderboardAgents(agents);
        if (agents.length > 0) setSelectedAgentId(agents[0].id);
        setLeaderboardLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setLeaderboardLoading(false);
      });
    return () => ac.abort();
  }, []);

  // ── Fetch spotlight agent detail + quality when selection changes ──
  useEffect(() => {
    if (!selectedAgentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSpotlightAgent(null);

      setSpotlightQuality(null);
      return;
    }

    let cancelled = false;
    setSpotlightLoading(true);

    Promise.allSettled([
      fetch(`${API_URL}/api/agents/${selectedAgentId}`).then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<AgentDetail>;
      }),
      fetch(`${API_URL}/api/agents/${selectedAgentId}/quality`).then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<QualityData>;
      }),
    ]).then(([agentResult, qualityResult]) => {
      if (cancelled) return;
      if (agentResult.status === "fulfilled") {
        setSpotlightAgent(agentResult.value);
      } else {
        setSpotlightAgent(null);
      }
      if (qualityResult.status === "fulfilled") {
        const q = qualityResult.value;
        const hasAny = q?.axes && Object.keys(q.axes).length > 0;
        setSpotlightQuality(hasAny ? q : null);
      } else {
        setSpotlightQuality(null);
      }
      setSpotlightLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentId]);

  const handleSelectAgent = useCallback((id: string) => {
    setSelectedAgentId(id);
  }, []);

  const handleViewProfile = useCallback((id: string) => {
    setProfileAgentId(id);
  }, []);

  // Hide sections on error
  const showInsightCards = !companiesError;
  const showCompanies = !companiesError;
  const showRankings = leaderboardLoading || leaderboardAgents.length > 0;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NavBar />

      <main className="mx-auto w-full max-w-7xl px-6 py-8 flex flex-col gap-12">
        <HeroSection />

        {showInsightCards && (
          <InsightCards companies={companies} loading={companiesLoading} />
        )}

        {showCompanies && (
          <CompaniesSection companies={companies} loading={companiesLoading} />
        )}

        {showRankings && (
          <section className="flex flex-col lg:flex-row gap-4">
            <RankingsList
              agents={leaderboardAgents}
              selectedAgentId={selectedAgentId}
              onSelect={handleSelectAgent}
              loading={leaderboardLoading}
            />
            <AgentSpotlight
              agent={spotlightAgent}
              quality={spotlightQuality}
              loading={spotlightLoading}
              onViewProfile={handleViewProfile}
            />
          </section>
        )}
      </main>

      <Footer />

      {/* Agent profile slide-over */}
      <AgentProfile
        agentId={profileAgentId}
        open={!!profileAgentId}
        onClose={() => setProfileAgentId(null)}
      />
    </div>
  );
}
