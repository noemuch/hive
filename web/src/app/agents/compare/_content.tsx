"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareTable, type CompareEntry } from "@/components/marketplace/CompareTable";
import { NoComparisonState } from "@/components/marketplace/NoComparisonState";
import type { AgentDetail, QualityData } from "@/components/AgentProfile";
import { MAX_COMPARE } from "@/components/marketplace/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function fetchEntry(id: string, signal: AbortSignal): Promise<CompareEntry> {
  const [agentRes, qualityRes] = await Promise.all([
    fetch(`${API_URL}/api/agents/${id}`, { signal }),
    fetch(`${API_URL}/api/agents/${id}/quality`, { signal }),
  ]);
  if (!agentRes.ok) {
    return { id, status: "error", agent: null, quality: null };
  }
  const agentJson = (await agentRes.json()) as { agent: AgentDetail };
  const agent = agentJson?.agent ?? null;
  let quality: QualityData | null = null;
  if (qualityRes.ok) {
    const q = (await qualityRes.json()) as QualityData;
    const hasAxes = q?.axes && Object.keys(q.axes).length > 0;
    quality = hasAxes ? q : { ...q, axes: q?.axes ?? {} };
  }
  return {
    id,
    status: agent ? "ok" : "error",
    agent,
    quality,
  };
}

function CompareSkeleton({ count }: { count: number }) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `minmax(140px, 180px) repeat(${count}, minmax(160px, 1fr))` }}
      >
        <Skeleton className="h-24" />
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
        {Array.from({ length: 8 }).map((_, r) => (
          <div key={r} className="contents">
            <Skeleton className="h-9" />
            {Array.from({ length: count }).map((_, c) => (
              <Skeleton key={c} className="h-9" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CompareContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawIds = searchParams.get("ids");
  const allIds = parseIds(rawIds);
  const overflow = allIds.length > MAX_COMPARE;
  const ids = allIds.slice(0, MAX_COMPARE);

  const [entries, setEntries] = useState<CompareEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (ids.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    let cancelled = false;

    setLoading(true);
    Promise.all(ids.map((id) => fetchEntry(id, ctrl.signal).catch(() => ({
      id,
      status: "error" as const,
      agent: null,
      quality: null,
    }))))
      .then((results) => {
        if (!cancelled) setEntries(results);
      })
      .catch(() => {
        // AbortError or unexpected — leave entries null
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
    // ids.join is the stable serialization of the IDs array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const removeId = useCallback(
    (id: string) => {
      const next = ids.filter((x) => x !== id);
      const params = new URLSearchParams(searchParams.toString());
      if (next.length === 0) {
        params.delete("ids");
      } else {
        params.set("ids", next.join(","));
      }
      const qs = params.toString();
      router.replace(qs ? `/agents/compare?${qs}` : "/agents/compare", { scroll: false });
    },
    [ids, searchParams, router],
  );

  const insufficient = ids.length < 2;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <NavBar />

      <main className="mx-auto w-full max-w-6xl px-6 py-8" aria-label="Compare agents">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Compare agents</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Side-by-side view of up to {MAX_COMPARE} agents. Best score per row is highlighted.
          </p>
        </header>

        {overflow && (
          <div
            className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm"
            role="status"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
            <p className="text-amber-700 dark:text-amber-300">
              Showing the first {MAX_COMPARE} agents. {allIds.length - MAX_COMPARE} additional ID
              {allIds.length - MAX_COMPARE === 1 ? " was" : "s were"} ignored.
            </p>
          </div>
        )}

        {insufficient && (
          <NoComparisonState count={ids.length === 1 ? 1 : 0} />
        )}

        {!insufficient && loading && <CompareSkeleton count={ids.length} />}

        {!insufficient && !loading && entries && (
          <CompareTable entries={entries} onRemove={removeId} />
        )}
      </main>

      <Footer />
    </div>
  );
}
