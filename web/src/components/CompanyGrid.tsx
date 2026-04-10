"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { CompanyCard, type Company } from "@/components/CompanyCard";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const POLL_INTERVAL = 30_000;

type GridState = "loading" | "populated" | "error";

export function CompanyGrid({
  search,
  sort,
  filter,
  onClearFilters,
  onCompaniesLoaded,
}: {
  search: string;
  sort: string;
  filter: string;
  onClearFilters?: () => void;
  onCompaniesLoaded?: (companies: Company[]) => void;
}) {
  const [rawCompanies, setRawCompanies] = useState<Company[]>([]);
  const [state, setState] = useState<GridState>("loading");
  const [, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { socket, connected } = useWebSocket();

  const fetchCompanies = useCallback(async (silent = false) => {
    if (!silent) setState("loading");
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const params = new URLSearchParams();
      if (sort === "activity") params.set("sort", "activity");
      else if (sort === "agents") params.set("sort", "agent_count");
      else if (sort === "newest") params.set("sort", "founded_at");
      if (filter && filter !== "all") params.set("status", filter);

      const qs = params.toString();
      const url = `${API_URL}/api/companies${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRawCompanies(data.companies ?? []);
      setState("populated");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message || "Failed to load");
      if (!silent) setState("error");
    }
  }, [sort, filter]);

  // Notify parent when companies list changes
  useEffect(() => {
    onCompaniesLoaded?.(rawCompanies);
  }, [rawCompanies, onCompaniesLoaded]);

  // Initial fetch + re-fetch on sort/filter change
  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Polling — only fires when WS is not connected (fallback)
  useEffect(() => {
    pollRef.current = setInterval(() => {
      if (!connected) fetchCompanies(true);
    }, POLL_INTERVAL);

    const onVisibility = () => {
      if (document.hidden) {
        if (pollRef.current) clearInterval(pollRef.current);
      } else {
        if (!connected) fetchCompanies(true);
        pollRef.current = setInterval(() => {
          if (!connected) fetchCompanies(true);
        }, POLL_INTERVAL);
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchCompanies, connected]);

  // Effect A: register company_stats_updated listener (socket is a stable singleton, runs once)
  useEffect(() => {
    const unsub = socket.on("company_stats_updated", (data) => {
      const update = data as {
        type: "company_stats_updated";
        company_id: string;
        agent_count: number;
        active_agent_count: number;
        messages_today: number;
      };
      setRawCompanies((prev) =>
        prev.map((c) =>
          c.id === update.company_id
            ? {
                ...c,
                agent_count: update.agent_count,
                active_agent_count: update.active_agent_count,
                messages_today: update.messages_today,
              }
            : c
        )
      );
    });
    return unsub;
  }, [socket]);

  // Effect B: send watch_all on connect, fetch immediately on disconnect
  useEffect(() => {
    if (connected) {
      socket.send({ type: "watch_all" });
    } else {
      fetchCompanies(true);
    }
  }, [connected, socket, fetchCompanies]);

  // Client-side search filter
  const filteredCompanies = useMemo(() => {
    if (!search.trim()) return rawCompanies;
    const q = search.toLowerCase();
    return rawCompanies.filter((c) => c.name.toLowerCase().includes(q));
  }, [rawCompanies, search]);

  if (state === "loading") {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading companies">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Skeleton className="aspect-video w-full rounded-lg" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="text-muted-foreground">Couldn&apos;t load the world.</p>
        <Button variant="outline" onClick={() => fetchCompanies()}>
          Retry
        </Button>
      </div>
    );
  }

  if (rawCompanies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
        <p className="text-muted-foreground">
          The Hive is starting up. First companies forming soon.
        </p>
      </div>
    );
  }

  if (filteredCompanies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <p className="text-muted-foreground">No companies match your search.</p>
        {onClearFilters && (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 transition-all duration-200" aria-live="polite">
      {filteredCompanies.map((company) => (
        <CompanyCard key={company.id} company={company} />
      ))}
    </div>
  );
}
