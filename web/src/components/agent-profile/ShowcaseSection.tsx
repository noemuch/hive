"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FileText, Image as ImageIcon, Code, Music, Video, File, Pin } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// A5 · #234 — Builder-curated showcase pins rendered above the stats block
// on /agent/:id. Pins are explicit public opt-ins so it is safe to render
// `content` directly. Max 5 slots enforced server-side.

type ShowcasePin = {
  position: number;
  pinned_at: string;
  artifact: {
    id: string;
    type: string;
    title: string;
    content: string;
    created_at: string;
    media_url: string | null;
    media_mime: string | null;
    score: number | null;
  };
};

type ShowcaseResponse = {
  pins: ShowcasePin[];
};

export type ShowcaseSectionProps = {
  agentId: string;
  className?: string;
};

function typeIcon(type: string) {
  switch (type) {
    case "image":
      return ImageIcon;
    case "audio":
      return Music;
    case "video":
      return Video;
    case "code_diff":
    case "pr":
    case "structured_json":
      return Code;
    case "document":
    case "report":
    case "spec":
      return FileText;
    default:
      return File;
  }
}

function scoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function preview(content: string, max = 140): string {
  const flattened = content.replace(/\s+/g, " ").trim();
  return flattened.length > max ? `${flattened.slice(0, max)}…` : flattened;
}

export function ShowcaseSection({ agentId, className }: ShowcaseSectionProps) {
  const [pins, setPins] = useState<ShowcasePin[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/agents/${agentId}/showcase`);
        if (!res.ok) {
          if (!cancelled) setPins([]);
          return;
        }
        const data = (await res.json()) as ShowcaseResponse;
        if (!cancelled) setPins(data.pins ?? []);
      } catch {
        if (!cancelled) setPins([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (pins === null) {
    return <ShowcaseSectionSkeleton className={className} />;
  }
  if (pins.length === 0) return null;

  return (
    <section
      className={cn("rounded-xl border bg-card overflow-hidden", className)}
      aria-labelledby="showcase-heading"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Pin className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 id="showcase-heading" className="text-sm font-semibold">
            Showcase
          </h2>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">
          {pins.length} pinned
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-px bg-border md:grid-cols-2 lg:grid-cols-3">
        {pins.map((pin) => {
          const Icon = typeIcon(pin.artifact.type);
          const score = pin.artifact.score;
          return (
            <li key={pin.artifact.id} className="bg-card">
              <Link
                href={`/artifact/${pin.artifact.id}`}
                className="flex h-full flex-col gap-3 p-4 transition-colors hover:bg-muted/30 focus:bg-muted/30 focus:outline-none"
                aria-label={`Pinned artifact: ${pin.artifact.title}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <Badge variant="secondary" className="capitalize">
                      {pin.artifact.type.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  {score !== null && (
                    <span
                      className={cn("text-sm font-semibold tabular-nums", scoreColor(score))}
                      aria-label={`Quality score: ${score.toFixed(1)}`}
                    >
                      {score.toFixed(1)}
                    </span>
                  )}
                </div>
                <h3 className="line-clamp-2 text-sm font-medium leading-snug">
                  {pin.artifact.title}
                </h3>
                {pin.artifact.media_url && pin.artifact.media_mime?.startsWith("image/") ? (
                  <img
                    src={pin.artifact.media_url}
                    alt=""
                    className="h-28 w-full rounded border bg-background object-cover"
                    loading="lazy"
                  />
                ) : (
                  <p className="line-clamp-4 text-xs text-muted-foreground">
                    {preview(pin.artifact.content ?? "")}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ShowcaseSectionSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-px bg-border md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-3 bg-card p-4">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
