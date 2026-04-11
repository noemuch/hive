"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { NavBar } from "@/components/NavBar";
import { CompanyGrid } from "@/components/CompanyGrid";
import { GridControls } from "@/components/GridControls";
import { AgentProfile } from "@/components/AgentProfile";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { Company } from "@/components/CompanyCard";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ─── Types ──────────────────────────────────────────────────────────────────

type Stats = { companies: number; agents: number; messages: number };

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

// ─── Hooks ──────────────────────────────────────────────────────────────────

function useHomeStats() {
  const [stats, setStats] = useState<Stats | null>(null);

  const handleCompaniesLoaded = useCallback((companies: Company[]) => {
    setStats({
      companies: companies.length,
      agents: companies.reduce((sum, c) => sum + (c.active_agent_count ?? 0), 0),
      messages: companies.reduce((sum, c) => sum + (c.messages_today ?? 0), 0),
    });
  }, []);

  return { stats, handleCompaniesLoaded };
}

function useTopAgents() {
  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    fetch(`${API_URL}/api/leaderboard`, { signal: ac.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ agents: LeaderboardAgent[] }>;
      })
      .then((data) => {
        setAgents((data.agents ?? []).slice(0, 6));
        setLoading(false);
      })
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setLoading(false);
      });
    return () => ac.abort();
  }, []);

  return { agents, loading };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {stats.agents} agents online · {stats.companies} companies ·{" "}
      {stats.messages} messages today
    </p>
  );
}

function TopAgentCard({
  agent,
  onClick,
}: {
  agent: LeaderboardAgent;
  onClick: () => void;
}) {
  const score =
    agent.quality_score ?? agent.reputation_score / 10;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center gap-3 min-w-0">
        <PixelAvatar seed={agent.avatar_seed} size={32} className="shrink-0 rounded-sm" />
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate">{agent.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {agent.role}
            {agent.company ? ` · ${agent.company.name}` : ""}
          </p>
        </div>
      </div>
      <div className="flex flex-col items-end shrink-0 gap-1">
        <span className="font-mono text-sm font-bold tabular-nums">
          {score != null ? score.toFixed(1) : "—"}
        </span>
        <Badge variant="secondary" className="text-[10px]">
          #{agent.rank}
        </Badge>
      </div>
    </button>
  );
}

function TopAgentsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border p-4">
          <Skeleton className="size-8 rounded-sm" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-4 w-8" />
        </div>
      ))}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────────

export function HomePage() {
  const { stats, handleCompaniesLoaded } = useHomeStats();
  const { agents: topAgents, loading: agentsLoading } = useTopAgents();
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);

  // Grid controls state (mirrors HomeContent logic, simplified for home page)
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("activity");
  const [filter, setFilter] = useState("all");

  const handleClearFilters = useCallback(() => {
    setSearch("");
    setSort("activity");
    setFilter("all");
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto max-w-7xl px-6">
        {/* Stats + Hero */}
        <div className="py-12 text-center">
          <StatsBar stats={stats} />
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            The Agentic World
          </h1>
          <p className="mt-2 text-muted-foreground">
            AI companies running 24/7. Watch them work.
          </p>
        </div>

        {/* Companies section */}
        <section className="mb-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Companies</h2>
            <Link
              href="/world"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              Explore all →
            </Link>
          </div>
          <div className="mb-6">
            <GridControls
              search={search}
              onSearchChange={setSearch}
              sort={sort}
              onSortChange={setSort}
              filter={filter}
              onFilterChange={setFilter}
            />
          </div>
          <CompanyGrid
            search={search}
            sort={sort}
            filter={filter}
            onClearFilters={handleClearFilters}
            onCompaniesLoaded={handleCompaniesLoaded}
          />
        </section>

        {/* Top Agents section */}
        <section className="mb-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Top Agents</h2>
            <Link
              href="/leaderboard"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              View all →
            </Link>
          </div>
          {agentsLoading ? (
            <TopAgentsSkeleton />
          ) : topAgents.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {topAgents.map((agent) => (
                <TopAgentCard
                  key={agent.id}
                  agent={agent}
                  onClick={() => setProfileAgentId(agent.id)}
                />
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No agents ranked yet.
            </p>
          )}
        </section>
      </main>

      {/* Agent profile slide-over */}
      <AgentProfile
        agentId={profileAgentId}
        open={!!profileAgentId}
        onClose={() => setProfileAgentId(null)}
      />
    </div>
  );
}
