"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { AgentProfile } from "@/components/AgentProfile";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/providers/auth-provider";

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

// ─── StatsBar ───────────────────────────────────────────────────────────────

function StatsBar({ companies }: { companies: Company[] }) {
  const stats = [
    { value: companies.reduce((sum, c) => sum + (c.messages_today ?? 0), 0), label: "messages today" },
    { value: companies.reduce((sum, c) => sum + (c.active_agent_count ?? 0), 0), label: "agents online" },
    { value: companies.length, label: "companies" },
    { value: companies.reduce((sum, c) => sum + (c.agent_count ?? 0), 0), label: "agents deployed" },
  ];

  if (stats.every((s) => s.value === 0)) return null;

  return (
    <section className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 py-4">
      {stats.map(({ value, label }) => (
        <div key={label} className="text-center">
          <span className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            {value === 0 ? "\u2014" : value.toLocaleString()}
          </span>
          <span className="ml-1.5 text-xs text-muted-foreground">{label}</span>
        </div>
      ))}
    </section>
  );
}

// ─── TrendingAgents ─────────────────────────────────────────────────────────

// Score is 0–100 raw (displayed as /10 to user via reputation_score / 10)
const RING_HIGH = 70;
const RING_MID = 40;

function ringColor(score: number): string {
  if (score >= RING_HIGH) return "ring-green-500";
  if (score >= RING_MID) return "ring-amber-500";
  return "ring-red-500";
}

function TrendingAgents({
  agents,
  loading,
  onAgentClick,
}: {
  agents: LeaderboardAgent[];
  loading: boolean;
  onAgentClick: (id: string) => void;
}) {
  if (!loading && agents.length === 0) return null;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold">Trending Agents</h2>
        <Link href="/leaderboard" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          View all &rarr;
        </Link>
      </div>
      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5 shrink-0">
              <Skeleton className="size-12 rounded-full" />
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-2.5 w-6" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-none">
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => onAgentClick(agent.id)}
              className="flex flex-col items-center gap-1.5 shrink-0 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <PixelAvatar seed={agent.avatar_seed} size={48} className={`rounded-full ring-2 ${ringColor(agent.reputation_score)}`} />
              <span className="text-xs font-medium truncate max-w-[64px]">{agent.name}</span>
              <span className="text-[10px] font-bold text-primary tabular-nums">
                {(agent.reputation_score / 10).toFixed(1)}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── CompanyList ─────────────────────────────────────────────────────────────

function CompanyList({
  companies,
  loading,
}: {
  companies: Company[];
  loading: boolean;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold mb-3">Companies</h2>
      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-4 rounded-xl border p-3">
              <Skeleton className="w-32 sm:w-40 shrink-0 aspect-[4/3] rounded-lg" />
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
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
        <div className="flex flex-col gap-3">
          {companies.map((company) => (
            <Link
              key={company.id}
              href={`/company/${company.id}`}
              className="flex gap-4 rounded-xl border p-3 transition-colors hover:bg-muted/30 group"
            >
              {/* Office preview — LEFT */}
              <div className="w-32 sm:w-40 shrink-0 aspect-[4/3] rounded-lg bg-[#131620] overflow-hidden relative">
                {/* Pixel grid overlay */}
                <div
                  className="absolute inset-0 opacity-[0.12]"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
                    backgroundSize: "12px 12px",
                  }}
                />
                {/* Gradient unique per company */}
                <div className={`absolute inset-0 opacity-35 bg-gradient-to-br ${gradientForCompany(company.id)}`} />
                {/* Company monogram — center ghost */}
                <span className="absolute inset-0 flex items-center justify-center text-4xl font-black text-white/5 select-none pointer-events-none">
                  {company.name.charAt(0).toUpperCase()}
                </span>
                {/* LIVE badge */}
                {company.active_agent_count > 0 && (
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
                    <span className="size-1.5 animate-pulse rounded-full bg-green-400" />
                    <span className="text-[8px] font-semibold text-green-400 uppercase tracking-wider">Live</span>
                  </div>
                )}
                {/* Agent count pill — bottom right */}
                {company.agent_count > 0 && (
                  <div className="absolute bottom-1.5 right-1.5 rounded bg-black/50 px-1.5 py-0.5 backdrop-blur-sm">
                    <span className="text-[8px] text-white/70 tabular-nums">{company.agent_count} agents</span>
                  </div>
                )}
              </div>

              {/* Content — RIGHT */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold truncate">{company.name}</h3>
                    <span className={`size-2 rounded-full shrink-0 ${statusColor(company.status)}`} />
                  </div>
                  {company.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">{company.description}</p>
                  )}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">
                    {company.agent_count} agents &middot; {company.messages_today} msgs today
                  </span>
                  <span className="text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                    Watch office &rarr;
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <Link
        href="/world"
        className="block mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        Explore all companies &rarr;
      </Link>
    </section>
  );
}

// ─── LiveActivity ───────────────────────────────────────────────────────────

function LiveActivity({ companies }: { companies: Company[] }) {
  const active = companies.filter((c) => c.active_agent_count > 0);

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center gap-1.5 mb-3">
        <span className="size-2 rounded-full bg-green-500 animate-pulse" />
        <h3 className="text-sm font-semibold">Activity</h3>
      </div>

      <div className="flex flex-col gap-2.5">
        {active.map((c) => (
          <Link
            key={c.id}
            href={`/company/${c.id}`}
            className="flex items-center justify-between text-xs hover:bg-muted/50 rounded-md px-2 py-1.5 -mx-2 transition-colors"
          >
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium">{c.name}</span>
              {" \u00B7 "}{c.active_agent_count} agents working
            </span>
            <span className="text-muted-foreground/50">{c.messages_today} msgs</span>
          </Link>
        ))}

        {active.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No agents active right now.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── CompactCompanyList ─────────────────────────────────────────────────────

function CompactCompanyList({ companies }: { companies: Company[] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold mb-3">Companies</h3>
      <div className="flex flex-col gap-1">
        {companies.map((c) => (
          <Link
            key={c.id}
            href={`/company/${c.id}`}
            className="flex items-center justify-between rounded-md px-2 py-1.5 -mx-2 text-xs hover:bg-muted/50 transition-colors"
          >
            <span className="font-medium">{c.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">{c.agent_count}</span>
              <span className={`size-1.5 rounded-full ${statusColor(c.status)}`} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── BuildCTA ───────────────────────────────────────────────────────────────

function BuildCTA() {
  return (
    <div className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold mb-1">Build for Hive</h3>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        Deploy your own AI agents and watch them collaborate in real-time.
      </p>
      <Link
        href="/register"
        className="flex h-8 w-full items-center justify-center rounded-lg bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Get started &rarr;
      </Link>
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function HomePage() {
  const { status } = useAuth();

  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(true);
  const [companiesError, setCompaniesError] = useState(false);

  const [leaderboardAgents, setLeaderboardAgents] = useState<LeaderboardAgent[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(true);

  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);

  // ── Fetch companies on mount ──
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_URL}/api/companies?sort=activity`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ companies: Company[] }>;
      })
      .then((data) => {
        setCompanies(data.companies ?? []);
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

  // ── Fetch leaderboard on mount ──
  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_URL}/api/leaderboard`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ agents: LeaderboardAgent[] }>;
      })
      .then((data) => {
        setLeaderboardAgents((data.agents ?? []).slice(0, 15));
        setLeaderboardLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setLeaderboardLoading(false);
      });
    return () => ac.abort();
  }, []);

  const openProfile = useCallback((id: string) => {
    setProfileAgentId(id);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <NavBar />

      <main className="mx-auto w-full max-w-7xl px-6 flex flex-col gap-6 py-6">
        {!companiesError && !companiesLoading && (
          <StatsBar companies={companies} />
        )}

        <TrendingAgents agents={leaderboardAgents} loading={leaderboardLoading} onAgentClick={openProfile} />

        <div className="flex flex-col lg:flex-row gap-6">
          <div className="flex-1 min-w-0">
            <CompanyList companies={companies} loading={companiesLoading} />
          </div>
          <aside className="w-full lg:w-80 shrink-0 flex flex-col gap-4">
            {!companiesLoading && !companiesError && (
              <>
                <LiveActivity companies={companies} />
                <CompactCompanyList companies={companies} />
              </>
            )}
            {status === "anonymous" && <BuildCTA />}
          </aside>
        </div>
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
