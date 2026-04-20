"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PixelAvatar } from "@/components/PixelAvatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatScore } from "@/lib/score";
import { avatarBgClass, ringColor } from "@/lib/avatar";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type CollectionAgent = {
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  score_state_mu: number | null;
  company: { id: string; name: string } | null;
};

type CollectionResponse = {
  slug: string;
  title: string;
  filter_query: string;
  agents: CollectionAgent[];
};

type LoadState = "idle" | "loading" | "loaded" | "error";

// Used by IntersectionObserver to pre-fetch slightly before the strip
// enters the viewport, so the skeleton isn't visible for long.
const LAZY_LOAD_ROOT_MARGIN = "200px";

export function CollectionStrip({ slug }: { slug: string }) {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const containerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || state !== "idle") return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          setState("loading");
        }
      },
      { rootMargin: LAZY_LOAD_ROOT_MARGIN },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [state]);

  useEffect(() => {
    if (state !== "loading") return;

    const ac = new AbortController();
    fetch(`${API_URL}/api/agents/collections/${encodeURIComponent(slug)}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as CollectionResponse;
        setData(json);
        setState("loaded");
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setState("error");
      });

    return () => ac.abort();
  }, [state, slug]);

  // Silently hide empty collections (spec: "Empty collections are hidden silently").
  if (state === "error") return null;
  if (state === "loaded" && (!data || data.agents.length === 0)) return null;

  const title = data?.title ?? "";
  const filterQuery = data?.filter_query ?? "";
  const agents = data?.agents ?? [];
  const isLoading = state !== "loaded";

  return (
    <section ref={containerRef} className="rounded-xl border bg-card">
      <div className="flex items-center justify-between px-5 py-3 border-b">
        <h2 className="text-sm font-semibold">
          {title || <Skeleton className="h-4 w-32 inline-block align-middle" />}
        </h2>
        {!isLoading && (
          <Link
            href={`/agents?${filterQuery}`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View all →
          </Link>
        )}
      </div>
      <div className="px-5 py-4">
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2.5 shrink-0 w-48 rounded-lg border px-3 py-2.5 snap-start"
                >
                  <Skeleton className="size-10 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-24" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))
            : agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agent/${agent.id}`}
                  className="flex items-center gap-2.5 shrink-0 w-48 rounded-lg border px-3 py-2.5 snap-start transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <div
                    className={`size-10 rounded-full ring-2 shrink-0 overflow-hidden ${ringColor(agent.score_state_mu)} ${avatarBgClass(agent.avatar_seed)}`}
                  >
                    <PixelAvatar seed={agent.avatar_seed} size={40} className="rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-semibold truncate">{agent.name}</span>
                      <Badge variant="secondary" className="tabular-nums">
                        {formatScore(agent.score_state_mu)}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {agent.role.charAt(0).toUpperCase() + agent.role.slice(1)}
                      {agent.company && <span> · {agent.company.name}</span>}
                    </p>
                  </div>
                </Link>
              ))}
        </div>
      </div>
    </section>
  );
}
