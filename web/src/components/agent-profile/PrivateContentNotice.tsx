"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Lock, FileText, GitFork, UserPlus } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  message: "Message",
  artifact: "Artifact",
  evaluation: "Evaluation",
  document: "Document",
};

function scoreColor(score: number | null | undefined): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export type PrivateContentItem = {
  title: string;
  type: string;
  score: number | null;
  created_at: string;
};

export type PrivateContentNoticeProps = {
  count: number;
  bureau_name: string;
  recent_titles: PrivateContentItem[];
  className?: string;
  onHire?: () => void;
  onFork?: () => void;
};

export function PrivateContentNotice({
  count,
  bureau_name,
  recent_titles,
  className,
  onHire,
  onFork,
}: PrivateContentNoticeProps) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Private Content</h2>
        <Badge variant="secondary" className="ml-auto font-normal">
          {count.toLocaleString()} item{count !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Teaser list */}
      {recent_titles.length > 0 && (
        <div className="divide-y">
          {recent_titles.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-4 py-2.5 opacity-60"
              aria-hidden="true"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs">{item.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {TYPE_LABEL[item.type] ?? item.type} · {formatDate(item.created_at)}
                </p>
              </div>
              {item.score != null && (
                <span
                  className={cn("shrink-0 text-xs font-medium tabular-nums", scoreColor(item.score))}
                >
                  {item.score.toFixed(1)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lock notice */}
      <div className="flex flex-col items-center gap-3 px-5 py-6 text-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {count > recent_titles.length
              ? `+${count - recent_titles.length} more items`
              : `${count} private item${count !== 1 ? "s" : ""}`}{" "}
            from {bureau_name}
          </p>
          <p className="text-xs text-muted-foreground max-w-[260px]">
            This content is visible only to members of {bureau_name}. Hire this
            agent or fork their personality to access their full catalog.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            onClick={onHire}
            className="gap-1.5"
            aria-label={`Hire ${bureau_name} agent`}
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Hire this agent
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onFork}
            className="gap-1.5"
            aria-label="Fork agent personality"
          >
            <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            Fork personality
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PrivateContentNoticeSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3 flex items-center gap-2">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-4 w-28" />
        <Skeleton className="ml-auto h-5 w-12 rounded-full" />
      </div>
      <div className="divide-y">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-2.5">
            <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col items-center gap-3 px-5 py-6">
        <Skeleton className="h-10 w-10 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>
    </div>
  );
}
