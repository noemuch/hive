"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  QUALITY_AXES,
  scoreBarColor,
  scoreTextColor,
  type QualityAxisKey,
  type QualityData,
} from "./shared";

function QualityBars({
  quality,
  onAxisClick,
}: {
  quality: QualityData;
  onAxisClick: (key: QualityAxisKey) => void;
}) {
  const sorted = QUALITY_AXES.map(ax => ({
    ...ax,
    axisData: quality.axes[ax.key] ?? null,
  }))
    .filter(ax => ax.axisData != null)
    .sort((a, b) => (b.axisData!.score - a.axisData!.score));

  if (sorted.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No axis scores available yet.
      </p>
    );
  }

  const worstKey = sorted[sorted.length - 1].key;

  return (
    <div className="flex flex-col divide-y">
      {sorted.map(ax => {
        const score = ax.axisData!.score;
        const isWorst = ax.key === worstKey;
        const barPct = (score / 10) * 100;

        return (
          <button
            key={ax.key}
            type="button"
            onClick={() => onAxisClick(ax.key)}
            className="group flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-1.5">
                {isWorst && (
                  <AlertTriangle
                    className="size-3.5 shrink-0 text-amber-500"
                    aria-label="Weakest axis"
                  />
                )}
                <span className={cn("text-sm font-medium leading-none", isWorst && "text-destructive")}>
                  {ax.shortLabel}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 font-mono text-sm font-semibold tabular-nums",
                    scoreTextColor(score)
                  )}
                >
                  {score.toFixed(1)}
                </span>
              </div>
              {/* Bar track */}
              <Progress value={barPct}>
                <ProgressTrack className="h-1.5">
                  <ProgressIndicator className={scoreBarColor(score)} />
                </ProgressTrack>
              </Progress>
              {/* Verdict */}
              <p
                className={cn(
                  "mt-1.5 text-xs leading-relaxed",
                  isWorst ? "text-destructive/80" : "text-muted-foreground"
                )}
              >
                {ax.verdict}
              </p>
            </div>
            <ChevronRight
              className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

export function Altitude2({
  quality,
  onBack,
  onAxisClick,
}: {
  quality: QualityData | null;
  onBack: () => void;
  onAxisClick: (key: QualityAxisKey) => void;
}) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Nav header */}
      <div className="flex items-center justify-between px-5 pt-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 px-0 hover:bg-transparent">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        {quality?.composite != null && (
          <Badge variant="secondary" className="text-base font-bold tabular-nums">
            {quality.composite.toFixed(1)}
          </Badge>
        )}
      </div>

      {/* Quality bars — sorted, in container. Click an axis to drill
          into its evaluation history (Altitude 3). */}
      <div className="mx-5 rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Quality Breakdown</h3>
        </div>
        {!quality ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="text-sm font-medium">Not evaluated yet</p>
            <p className="max-w-[240px] text-xs text-muted-foreground">
              The HEAR score appears after the first peer evaluation.
            </p>
          </div>
        ) : (
          <QualityBars quality={quality} onAxisClick={onAxisClick} />
        )}
      </div>
    </div>
  );
}
