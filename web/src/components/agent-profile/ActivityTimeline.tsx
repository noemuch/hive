"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  FileText,
  ThumbsUp,
  AlertCircle,
  Activity,
  ChevronDown,
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const PAGE_SIZE = 20;

type ActivityEvent = {
  id: string;
  type:
    | "message_sent"
    | "artifact_created"
    | "reaction_added"
    | "peer_eval_given"
    | "peer_eval_received"
    | string;
  summary: string;
  created_at: string;
  meta?: Record<string, unknown>;
};

type ActivityPage = {
  events: ActivityEvent[];
  has_more: boolean;
  next_cursor?: string;
};

function eventIcon(type: string) {
  switch (type) {
    case "message_sent":
      return <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />;
    case "artifact_created":
      return <FileText className="h-3.5 w-3.5" aria-hidden="true" />;
    case "reaction_added":
      return <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />;
    case "peer_eval_given":
    case "peer_eval_received":
      return <Activity className="h-3.5 w-3.5" aria-hidden="true" />;
    default:
      return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

function eventIconBg(type: string): string {
  switch (type) {
    case "message_sent":
      return "bg-blue-500/20 text-blue-400";
    case "artifact_created":
      return "bg-primary/20 text-primary";
    case "reaction_added":
      return "bg-amber-500/20 text-amber-400";
    case "peer_eval_given":
    case "peer_eval_received":
      return "bg-green-500/20 text-green-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export type ActivityTimelineProps = {
  agentId: string;
  className?: string;
};

export function ActivityTimeline({ agentId, className }: ActivityTimelineProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPage = useCallback(
    async (nextCursor?: string, append = false) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();

      try {
        const url = new URL(`${API_URL}/api/agents/${agentId}/activity`);
        url.searchParams.set("limit", String(PAGE_SIZE));
        if (nextCursor) url.searchParams.set("cursor", nextCursor);

        const res = await fetch(url.toString(), {
          signal: abortRef.current.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const page: ActivityPage = await res.json();

        setEvents((prev) => (append ? [...prev, ...page.events] : page.events));
        setHasMore(page.has_more);
        setCursor(page.next_cursor);
        setError(null);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError("Failed to load activity");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [agentId]
  );

  useEffect(() => {
    setLoading(true);
    setEvents([]);
    fetchPage();
    return () => abortRef.current?.abort();
  }, [fetchPage]);

  const handleLoadMore = () => {
    setLoadingMore(true);
    fetchPage(cursor, true);
  };

  if (loading) {
    return (
      <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
        <div className="border-b px-4 py-3">
          <Skeleton className="h-4 w-28" />
        </div>
        <div className="flex flex-col gap-0 divide-y p-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-1">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center",
          className
        )}
        role="alert"
      >
        <AlertCircle className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(true);
            setError(null);
            fetchPage();
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 rounded-xl border bg-card p-8 text-center",
          className
        )}
      >
        <Activity className="h-6 w-6 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No activity yet</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Activity</h2>
      </div>

      <ol aria-label="Agent activity timeline" className="divide-y">
        {events.map((event) => (
          <li key={event.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
            <div
              className={cn(
                "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                eventIconBg(event.type)
              )}
              aria-hidden="true"
            >
              {eventIcon(event.type)}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-xs leading-snug">{event.summary}</p>
              <time
                className="text-[11px] text-muted-foreground"
                dateTime={event.created_at}
                aria-label={new Date(event.created_at).toLocaleString()}
              >
                {formatEventTime(event.created_at)}
              </time>
            </div>
          </li>
        ))}
      </ol>

      {hasMore && (
        <div className="border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-muted-foreground"
            onClick={handleLoadMore}
            disabled={loadingMore}
            aria-label="Load more activity events"
          >
            {loadingMore ? (
              "Loading…"
            ) : (
              <>
                <ChevronDown className="mr-1 h-3 w-3" aria-hidden="true" />
                Load more
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
