"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/marketplace/AgentCard";
import { MarketplaceFilters } from "@/components/marketplace/MarketplaceFilters";
import { SearchBar } from "@/components/marketplace/SearchBar";
import { SortDropdown } from "@/components/marketplace/SortDropdown";
import { Pagination } from "@/components/marketplace/Pagination";
import { CompareBasket } from "@/components/marketplace/CompareBasket";
import {
  applyFilters,
  applySort,
  filtersToParams,
  MAX_COMPARE,
  PAGE_SIZE,
  paginate,
  parseFilters,
  totalPages,
  type Filters,
  type MarketplaceAgent,
  type SortKey,
} from "@/components/marketplace/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function AgentCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex items-end justify-between">
        <Skeleton className="h-8 w-12" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  );
}

export function MarketplaceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => parseFilters(new URLSearchParams(searchParams.toString())));
  const [agents, setAgents] = useState<MarketplaceAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fetchAbortRef = useRef<AbortController | null>(null);

  // Fetch once
  useEffect(() => {
    fetchAbortRef.current?.abort();
    fetchAbortRef.current = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial fetch on mount
    setLoading(true);
    setError(false);
    fetch(`${API_URL}/api/leaderboard`, { signal: fetchAbortRef.current.signal })
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ agents: MarketplaceAgent[] }>;
      })
      .then((data) => {
        setAgents(data.agents ?? []);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") {
          setError(true);
          setLoading(false);
        }
      });
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, []);

  // Keep filters in sync with URL when history changes (back/forward)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reflect browser URL into local state
    setFilters(parseFilters(new URLSearchParams(searchParams.toString())));
  }, [searchParams]);

  const syncUrl = useCallback(
    (next: Filters) => {
      const params = filtersToParams(next);
      const qs = params.toString();
      const target = qs ? `/agents?${qs}` : "/agents";
      router.replace(target, { scroll: false });
    },
    [router]
  );

  // Update one or more filter fields; always resets page to 1 unless page itself is being set.
  const updateFilters = useCallback(
    (patch: Partial<Filters>) => {
      setFilters((prev) => {
        const resetPage = !("page" in patch);
        const next: Filters = { ...prev, ...patch, page: resetPage ? 1 : patch.page ?? prev.page };
        syncUrl(next);
        return next;
      });
    },
    [syncUrl]
  );

  const handleToggleRole = useCallback(
    (role: string) => {
      updateFilters({
        roles: filters.roles.includes(role)
          ? filters.roles.filter((r) => r !== role)
          : [...filters.roles, role],
      });
    },
    [filters.roles, updateFilters]
  );

  const handleToggleProvider = useCallback(
    (provider: string) => {
      updateFilters({
        providers: filters.providers.includes(provider)
          ? filters.providers.filter((p) => p !== provider)
          : [...filters.providers, provider],
      });
    },
    [filters.providers, updateFilters]
  );

  const handleReset = useCallback(() => {
    updateFilters({
      q: "",
      roles: [],
      providers: [],
      minScore: 0,
      evaluatedOnly: false,
    });
  }, [updateFilters]);

  const handleToggleCompare = useCallback(
    (id: string) => {
      const present = filters.compare.includes(id);
      if (present) {
        updateFilters({ compare: filters.compare.filter((x) => x !== id), page: filters.page });
      } else if (filters.compare.length < MAX_COMPARE) {
        updateFilters({ compare: [...filters.compare, id], page: filters.page });
      }
    },
    [filters.compare, filters.page, updateFilters]
  );

  const handleClearCompare = useCallback(() => {
    updateFilters({ compare: [], page: filters.page });
  }, [filters.page, updateFilters]);

  const filtered = useMemo(() => applyFilters(agents, filters), [agents, filters]);
  const sorted = useMemo(() => applySort(filtered, filters.sort), [filtered, filters.sort]);
  const pageCount = totalPages(sorted.length);
  const currentPage = Math.min(filters.page, pageCount);
  const paged = useMemo(() => paginate(sorted, currentPage, PAGE_SIZE), [sorted, currentPage]);

  const availableRoles = useMemo(() => {
    const set = new Set<string>();
    for (const a of agents) set.add(a.role);
    return Array.from(set).sort();
  }, [agents]);

  const activeCount =
    filters.roles.length +
    filters.providers.length +
    (filters.minScore > 0 ? 1 : 0) +
    (filters.evaluatedOnly ? 1 : 0);

  const hasAnyFilter = activeCount > 0 || filters.q.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />

      <main className="mx-auto w-full max-w-6xl px-6 py-8" aria-label="Agents marketplace">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">Agents Marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse {loading ? "…" : agents.length} verified AI agents · Hire by track record
          </p>
        </header>

        <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-3">
            <MarketplaceFilters
              state={{
                roles: filters.roles,
                providers: filters.providers,
                minScore: filters.minScore,
                evaluatedOnly: filters.evaluatedOnly,
              }}
              availableRoles={availableRoles}
              activeCount={activeCount}
              handlers={{
                onToggleRole: handleToggleRole,
                onToggleProvider: handleToggleProvider,
                onMinScoreChange: (score) => updateFilters({ minScore: score }),
                onEvaluatedToggle: (v) => updateFilters({ evaluatedOnly: v }),
                onReset: handleReset,
              }}
            />
          </div>

          <section className="md:col-span-9" aria-label="Agents">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
              <SearchBar value={filters.q} onChange={(q) => updateFilters({ q })} />
              <div className="flex items-center gap-2">
                <SortDropdown
                  value={filters.sort}
                  onChange={(sort: SortKey) => updateFilters({ sort })}
                />
              </div>
            </div>

            {!loading && !error && (
              <p className="mb-3 text-xs text-muted-foreground">
                {sorted.length === 0
                  ? "No matches"
                  : sorted.length === 1
                  ? "1 agent"
                  : `${sorted.length} agents`}
              </p>
            )}

            {loading && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <AgentCardSkeleton key={i} />
                ))}
              </div>
            )}

            {!loading && error && (
              <p className="py-16 text-center text-sm text-muted-foreground">
                Failed to load agents. Please refresh the page.
              </p>
            )}

            {!loading && !error && sorted.length === 0 && (
              <div className="rounded-xl border bg-card p-10 text-center">
                <p className="text-sm text-muted-foreground">No agents match.</p>
                <div className="mt-3 flex items-center justify-center gap-2">
                  {hasAnyFilter && (
                    <Button variant="outline" size="sm" onClick={handleReset} className="cursor-pointer">
                      Reset filters
                    </Button>
                  )}
                  <Button
                    render={<Link href="/leaderboard" />}
                    variant="ghost"
                    size="sm"
                    className="cursor-pointer"
                  >
                    Browse top agents
                  </Button>
                </div>
              </div>
            )}

            {!loading && !error && sorted.length > 0 && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {paged.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      inCompare={filters.compare.includes(agent.id)}
                      disableCompare={filters.compare.length >= MAX_COMPARE}
                      onToggleCompare={handleToggleCompare}
                    />
                  ))}
                </div>
                <div className="mt-8">
                  <Pagination
                    page={currentPage}
                    total={pageCount}
                    onChange={(page) => updateFilters({ page })}
                  />
                </div>
              </>
            )}
          </section>
        </div>
      </main>

      <Footer />

      <CompareBasket
        selected={filters.compare}
        allAgents={agents}
        onRemove={handleToggleCompare}
        onClear={handleClearCompare}
      />
    </div>
  );
}
