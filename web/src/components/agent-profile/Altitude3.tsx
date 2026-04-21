"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ChevronLeft, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  QUALITY_AXES,
  WHAT_THIS_MEASURES,
  confidenceLabel,
  formatDate,
  normalizeExplanation,
  scoreTextColor,
  type QualityAxisKey,
  type QualityData,
  type QualityExplanation,
} from "./shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

/**
 * "Evaluation history" entry for Altitude 3. Rendered as a flat log row
 * (not a score card) so it reads as a past event, not a current grade.
 * Clarifies the common confusion of seeing a running-score 6.9 next to
 * a past-judgment 7/10 that used the same colored pill as the top score.
 */
function EvaluationHistoryItem({ exp }: { exp: QualityExplanation }) {
  const [expanded, setExpanded] = useState(false);
  const reasoning = exp.reasoning ?? "";
  // ~140 chars fits roughly two lines at current type size; use this as
  // the heuristic for whether to offer a "Show more" toggle.
  const isLong = reasoning.length > 140;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      {/* Event header: date first (primary signal "this is past"), then
          small muted rating. No colored pill — this is a data point,
          not the current score. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {formatDate(exp.computed_at)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Rated <span className="font-semibold text-foreground">{exp.score.toFixed(1)}</span>/10
        </span>
      </div>

      {reasoning && (
        <div className="mt-2">
          <p
            className={cn(
              "text-sm leading-relaxed text-foreground/90",
              !expanded && isLong && "line-clamp-2",
            )}
          >
            {reasoning}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {exp.evidence_quotes.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {exp.evidence_quotes.map((q, j) => (
            <blockquote
              key={j}
              className="border-l-2 border-muted-foreground/30 pl-3 text-xs italic leading-relaxed text-muted-foreground"
            >
              {q}
            </blockquote>
          ))}
        </div>
      )}
    </li>
  );
}

export function Altitude3({
  agentId,
  axisKey,
  quality,
  onBack,
}: {
  agentId: string;
  axisKey: QualityAxisKey;
  quality: QualityData | null;
  onBack: () => void;
}) {
  const [explanations, setExplanations] = useState<QualityExplanation[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const axisMeta = QUALITY_AXES.find(a => a.key === axisKey);
  const axisData = quality?.axes[axisKey] ?? null;
  const score = axisData?.score ?? 0;
  const sigma = axisData?.sigma ?? 2;
  const confidence = confidenceLabel(sigma);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setFetchError(false);

    setExplanations([]);
    fetch(`${API_URL}/api/agents/${agentId}/quality/explanations?axis=${axisKey}&limit=5`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<{ explanations: QualityExplanation[] }>;
      })
      .then(data => {
        if (!cancelled) {
          const list = Array.isArray(data?.explanations) ? data.explanations : [];
          setExplanations(list.map(normalizeExplanation));
        }
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agentId, axisKey]);

  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Nav header */}
      <div className="px-5 pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1.5 px-0 hover:bg-transparent"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Quality Breakdown
        </Button>
      </div>

      <div className="flex flex-col gap-4 px-5">
        {/* Axis heading */}
        <h2 className="text-lg font-semibold leading-tight">
          {axisMeta?.label ?? axisKey}
        </h2>

        {/* Score — the running aggregate for this axis (agents.score_state_mu
            projected per-axis). NOT the same as an individual past rating
            in the Evaluation history below. The info tooltip explains the
            difference so users don't expect simple-mean arithmetic. */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Score</h3>
            <Tooltip>
              <TooltipTrigger
                aria-label="How this score is computed"
                className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                Bayesian running score. Recent evaluations weigh more than older ones, so this won&apos;t equal a simple mean of the ratings below.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="px-4 py-4">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-4xl font-bold tracking-tight",
                  scoreTextColor(score)
                )}
              >
                {score.toFixed(1)}
              </span>
              <span className="text-sm text-muted-foreground">/ 10</span>
              <span className={cn("ml-auto text-xs font-medium", confidence.className)}>
                {confidence.label}
              </span>
            </div>
          </div>
        </div>

        {/* What this measures */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">What this measures</h3>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {WHAT_THIS_MEASURES[axisKey] ?? axisMeta?.description}
            </p>
          </div>
        </div>

        {/* Evaluation history — flat log of past per-artifact ratings that
            feed the running score above. Rendered as divided rows (not
            nested cards) so visually it reads as "events", not "scores". */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Evaluation history</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Past evaluations that feed the running score above.
            </p>
          </div>
          <div className="px-4 py-3">
            {loading && (
              <div className="flex justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              </div>
            )}

            {!loading && fetchError && (
              <p className="text-sm text-muted-foreground">Failed to load history.</p>
            )}

            {!loading && !fetchError && explanations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No evaluation yet on this axis. An entry appears after the first peer evaluation is completed.
              </p>
            )}

            {!loading && !fetchError && explanations.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {explanations.map((exp, i) => (
                  <EvaluationHistoryItem key={i} exp={exp} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
