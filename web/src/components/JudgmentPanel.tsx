"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, AlertTriangle, ArrowUpRight } from "lucide-react";

// --- Types ---

export interface AxisJudgment {
  score: number;
  sigma?: number;
  reasoning?: string;
  evidence_quotes?: string[];
}

export interface Judgment {
  axes: Partial<Record<HearAxis, AxisJudgment>>;
  judge_disagreement?: number;
  was_escalated?: boolean;
  methodology_version?: string;
}

export type HearAxis =
  | "reasoning_depth"
  | "decision_wisdom"
  | "communication_clarity"
  | "initiative_quality"
  | "collaborative_intelligence"
  | "self_awareness_calibration"
  | "persona_coherence"
  | "contextual_judgment";

// --- Constants ---

const AXIS_LABELS: Record<HearAxis, string> = {
  reasoning_depth: "Reasoning Depth",
  decision_wisdom: "Decision Wisdom",
  communication_clarity: "Comm. Clarity",
  initiative_quality: "Initiative",
  collaborative_intelligence: "Collaboration",
  self_awareness_calibration: "Self-Awareness",
  persona_coherence: "Persona Coherence",
  contextual_judgment: "Contextual Judgment",
};

// V1: 7 axes shown. persona_coherence deferred to V2 (longitudinal grading).
const AXIS_ORDER: HearAxis[] = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
];

function scoreColor(score: number): string {
  if (score >= 7) return "text-green-400";
  if (score >= 4) return "text-yellow-400";
  return "text-red-400";
}

// --- Sub-components ---

function AxisRow({
  axis,
  judgment,
}: {
  axis: HearAxis;
  judgment: AxisJudgment;
}) {
  const [open, setOpen] = useState(false);
  const hasDetails =
    (judgment.reasoning && judgment.reasoning.trim().length > 0) ||
    (judgment.evidence_quotes && judgment.evidence_quotes.length > 0);

  const score = Math.round(judgment.score * 10) / 10;

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        type="button"
        disabled={!hasDetails}
        aria-expanded={open}
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors",
          hasDetails
            ? "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            : "cursor-default"
        )}
      >
        {/* Score badge */}
        <span
          className={cn(
            "w-8 shrink-0 font-mono text-sm font-bold tabular-nums",
            scoreColor(score)
          )}
        >
          {score.toFixed(1)}
        </span>

        {/* Axis name */}
        <span className="flex-1 text-sm text-foreground">
          {AXIS_LABELS[axis]}
        </span>

        {/* Score bar */}
        <div className="hidden w-20 sm:block">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                score >= 7
                  ? "bg-green-400"
                  : score >= 4
                  ? "bg-yellow-400"
                  : "bg-red-400"
              )}
              style={{ width: `${(score / 10) * 100}%` }}
            />
          </div>
        </div>

        {/* Expand icon */}
        {hasDetails && (
          <span className="shrink-0 text-muted-foreground">
            {open ? (
              <ChevronUp className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {open && hasDetails && (
        <div className="border-t border-border/50 bg-muted/20 px-4 pb-3 pt-2">
          {judgment.reasoning && (
            <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
              {judgment.reasoning}
            </p>
          )}
          {judgment.evidence_quotes && judgment.evidence_quotes.length > 0 && (
            <div className="space-y-1.5">
              {judgment.evidence_quotes.map((quote, i) => (
                <blockquote
                  key={i}
                  className="border-l-2 border-border pl-2 font-mono text-xs italic text-muted-foreground"
                >
                  {quote}
                </blockquote>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main component ---

interface JudgmentPanelProps {
  judgment: Judgment | null;
  /** true while the judgment is being loaded */
  pending?: boolean;
}

export function JudgmentPanel({ judgment, pending = false }: JudgmentPanelProps) {
  if (pending) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">HEAR Judgment</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Quality evaluation pending — this artifact will be evaluated in the
            next nightly batch.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!judgment) return null;

  const disagreementHigh =
    typeof judgment.judge_disagreement === "number" &&
    judgment.judge_disagreement > 2;

  const methodologyVersion = judgment.methodology_version ?? "1.0";

  // Compute average score across axes that have one
  const scoredAxes = AXIS_ORDER.filter((a) => judgment.axes[a]);
  const avgScore =
    scoredAxes.length > 0
      ? scoredAxes.reduce((acc, a) => acc + (judgment.axes[a]?.score ?? 0), 0) /
        scoredAxes.length
      : null;

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-semibold">HEAR Judgment</CardTitle>
          <div className="flex items-center gap-1.5">
            {judgment.was_escalated && (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <ArrowUpRight className="size-2.5" />
                Escalated
              </Badge>
            )}
            {disagreementHigh && (
              <Badge
                variant="destructive"
                className="gap-1 text-[10px]"
                title={`Judge disagreement: ${judgment.judge_disagreement?.toFixed(2)}`}
              >
                <AlertTriangle className="size-2.5" />
                High disagreement
              </Badge>
            )}
          </div>
        </div>

        {avgScore !== null && (
          <div className="mt-1 flex items-baseline gap-1">
            <span className={cn("font-mono text-2xl font-bold tabular-nums", scoreColor(avgScore))}>
              {avgScore.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/ 10 avg</span>
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-hidden rounded-b-xl">
          {AXIS_ORDER.map((axis) => {
            const axisJudgment = judgment.axes[axis];
            if (!axisJudgment) return null;
            return (
              <AxisRow key={axis} axis={axis} judgment={axisJudgment} />
            );
          })}
        </div>
      </CardContent>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 pb-4 pt-3">
        <Badge variant="secondary" className="text-[10px]">
          Methodology v{methodologyVersion}
        </Badge>
        {typeof judgment.judge_disagreement === "number" && (
          <span className="font-mono text-[10px] text-muted-foreground">
            σ disagreement {judgment.judge_disagreement.toFixed(2)}
          </span>
        )}
      </div>
    </Card>
  );
}
