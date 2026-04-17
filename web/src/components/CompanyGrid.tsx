"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { type Company } from "@/components/CompanyCard";
import { PulseDot } from "@/components/PulseDot";
import { OfficePreview } from "@/components/OfficePreview";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import Link from "next/link";

function hashToIndex(str: string, len: number): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash) % len;
}

const AVATAR_BG = [
  "bg-amber-400", "bg-violet-500", "bg-pink-500",
  "bg-blue-500", "bg-emerald-500", "bg-orange-500",
] as const;

function statusColor(status: string): string {
  if (status === "active") return "bg-green-500";
  if (status === "forming") return "bg-amber-500";
  return "bg-neutral-400";
}

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

  // Initial fetch + re-fetch on sort/filter change — fetchCompanies calls
  // setState internally, which is intentional (initial data hydration).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: initial fetch on mount
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
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: hydrate data when WS drops
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
      <div className="rounded-xl border bg-card">
        <div className="divide-y px-5 py-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-4 py-4 first:pt-0 last:pb-0">
              <Skeleton className="w-28 shrink-0 aspect-[4/3] rounded-lg" />
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
          ))}
        </div>
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
    <div className="rounded-xl border bg-card" aria-live="polite">
      <div className="px-5 py-4">
        <div className="divide-y">
          {filteredCompanies.map((company) => (
            <Link
              key={company.id}
              href={`/company/${company.id}`}
              className="flex gap-4 py-4 first:pt-0 last:pb-0 transition-colors hover:bg-muted/20 -mx-5 px-5"
            >
              {/* Office preview */}
              <div className="w-28 shrink-0 aspect-[4/3] rounded-lg overflow-hidden relative">
                <OfficePreview companyId={company.id} className="w-full h-full" />
                {company.active_agent_count > 0 && (
                  <div className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
                    <PulseDot />
                    <span className="text-[8px] font-semibold text-green-400 uppercase tracking-wider">Live</span>
                  </div>
                )}
              </div>

              {/* Content — 3 lines */}
              <div className="flex-1 min-w-0 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="text-sm font-semibold truncate">{company.name}</h3>
                    <span className={`size-2 rounded-full shrink-0 ${statusColor(company.status)}`} />
                  </div>
                  {company.top_agents && company.top_agents.length > 0 && (
                    <div className="flex items-center -space-x-1.5 shrink-0">
                      {company.top_agents.map((a) => (
                        <div
                          key={a.id}
                          className={`size-6 rounded-full ring-2 ring-card shrink-0 flex items-center justify-center overflow-hidden ${AVATAR_BG[hashToIndex(a.id, AVATAR_BG.length)]}`}
                        >
                          <PixelAvatar seed={a.avatar_seed} size={14} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
                  {company.description || "No description yet"}
                </p>
                <span className="text-xs text-muted-foreground">
                  {company.agent_count} {company.agent_count === 1 ? "agent" : "agents"}
                  {company.messages_today > 0 && <span> · {company.messages_today.toLocaleString()} msgs today</span>}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
