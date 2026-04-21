"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Quote } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// A5 · #234 — Per-axis citation tabs rendered on /agent/:id. Replaces (or
// complements) the single-carousel CitationCarousel by grouping quotes
// under the HEAR axis they support. Legacy (pre-A5) flat quotes surface
// under a "general" axis bucket.

const AXIS_LABELS: Record<string, string> = {
  reasoning_depth: "Reasoning",
  decision_wisdom: "Decision",
  communication_clarity: "Clarity",
  initiative_quality: "Initiative",
  collaborative_intelligence: "Collab",
  self_awareness_calibration: "Awareness",
  contextual_judgment: "Context",
  adversarial_robustness: "Adversarial",
  general: "General",
};

type AxisCitation = {
  quote: string;
  evaluator_name: string;
  evaluator_role: string;
  score: number;
};

type AxisGroup = {
  axis: string;
  quotes: AxisCitation[];
};

type EvidenceResponse = {
  axes: AxisGroup[];
};

export type AxisCitationsProps = {
  agentId: string;
  className?: string;
};

function scoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-amber-400";
  return "text-red-400";
}

function axisLabel(axis: string): string {
  return AXIS_LABELS[axis] ?? axis.replace(/_/g, " ");
}

export function AxisCitations({ agentId, className }: AxisCitationsProps) {
  const [data, setData] = useState<AxisGroup[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/agents/${agentId}/evidence`);
        if (!res.ok) {
          if (!cancelled) setData([]);
          return;
        }
        const body = (await res.json()) as EvidenceResponse;
        if (!cancelled) setData(body.axes ?? []);
      } catch {
        if (!cancelled) setData([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  if (data === null) return <AxisCitationsSkeleton className={className} />;
  if (data.length === 0) return null;

  const defaultAxis = data[0].axis;

  return (
    <section
      className={cn("rounded-xl border bg-card overflow-hidden", className)}
      aria-labelledby="axis-citations-heading"
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 id="axis-citations-heading" className="text-sm font-semibold">
          Evaluator Citations — per axis
        </h2>
        <span className="text-xs text-muted-foreground">
          {data.reduce((sum, g) => sum + g.quotes.length, 0)} quotes
        </span>
      </div>

      <Tabs defaultValue={defaultAxis} className="px-4 py-3">
        <TabsList variant="line" className="mb-3 w-full overflow-x-auto">
          {data.map((group) => (
            <TabsTrigger key={group.axis} value={group.axis}>
              {axisLabel(group.axis)}
              <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                {group.quotes.length}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {data.map((group) => (
          <TabsContent key={group.axis} value={group.axis}>
            <ul className="flex flex-col divide-y" aria-label={`Citations for ${axisLabel(group.axis)}`}>
              {group.quotes.map((c, idx) => (
                <li key={`${group.axis}-${idx}`} className="flex items-start gap-3 py-3">
                  <Quote
                    className="mt-1 h-3.5 w-3.5 shrink-0 text-primary/30"
                    aria-hidden="true"
                  />
                  <div className="flex-1">
                    <blockquote className="text-sm italic leading-relaxed text-foreground/90">
                      &ldquo;{c.quote}&rdquo;
                    </blockquote>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{c.evaluator_name}</span>
                        <span className="text-muted-foreground">{c.evaluator_role}</span>
                      </div>
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          scoreColor(c.score)
                        )}
                        aria-label={`Score: ${c.score.toFixed(1)}`}
                      >
                        {c.score.toFixed(1)}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}

export function AxisCitationsSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
        </div>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </div>
  );
}
