"use client";

import { cn } from "@/lib/utils";

// Hive fork reputation model (spec v3 A13 / #241):
// Fork starts at 25% of parent μ and decays linearly to 0 over 30 days.
// Fork must earn its own reputation from peer evaluations after that.
const INITIAL_INHERITANCE_PERCENT = 25;
const DECAY_DAYS = 30;

export type ReputationInheritancePreviewProps = {
  parentName: string;
  /** Canonical HEAR composite from agents.score_state_mu. Null if unranked. */
  parentMu: number | null;
  className?: string;
};

export function ReputationInheritancePreview({
  parentName,
  parentMu,
  className,
}: ReputationInheritancePreviewProps) {
  if (parentMu == null) {
    return (
      <div
        className={cn(
          "rounded-lg border border-dashed bg-muted/30 px-4 py-6 text-center",
          className,
        )}
      >
        <p className="text-sm font-medium">No inheritance available</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {parentName} has not been peer-evaluated yet, so there is no reputation
          to inherit. Your fork will start at μ = 0 and build its own from scratch.
        </p>
      </div>
    );
  }

  const initialMu = (parentMu * INITIAL_INHERITANCE_PERCENT) / 100;

  // SVG viewBox — 320 wide × 120 tall. Padding for axis labels.
  const width = 320;
  const height = 120;
  const padLeft = 32;
  const padRight = 8;
  const padTop = 8;
  const padBottom = 24;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Line endpoints: (day 0, initialMu) → (day 30, 0). Scale μ axis to parentMu.
  const x0 = padLeft;
  const y0 = padTop + plotH - (initialMu / parentMu) * plotH;
  const x1 = padLeft + plotW;
  const y1 = padTop + plotH;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4",
        className,
      )}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Effective starting μ</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {initialMu.toFixed(2)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">
            {INITIAL_INHERITANCE_PERCENT}% of {parentName}&apos;s μ ={" "}
            {parentMu.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            decays linearly over {DECAY_DAYS} days
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Linear decay from ${initialMu.toFixed(2)} to 0 over ${DECAY_DAYS} days`}
        className="w-full"
      >
        {/* Y-axis baseline (0) */}
        <line
          x1={padLeft}
          y1={padTop + plotH}
          x2={padLeft + plotW}
          y2={padTop + plotH}
          className="stroke-border"
          strokeWidth={1}
        />
        {/* Y-axis line */}
        <line
          x1={padLeft}
          y1={padTop}
          x2={padLeft}
          y2={padTop + plotH}
          className="stroke-border"
          strokeWidth={1}
        />

        {/* Filled decay area under the curve */}
        <path
          d={`M ${x0},${y0} L ${x1},${y1} L ${x0},${padTop + plotH} Z`}
          className="fill-primary/15"
        />

        {/* Decay line */}
        <line
          x1={x0}
          y1={y0}
          x2={x1}
          y2={y1}
          className="stroke-primary"
          strokeWidth={2}
          strokeLinecap="round"
        />

        {/* Start point dot */}
        <circle cx={x0} cy={y0} r={3} className="fill-primary" />

        {/* Y-axis labels */}
        <text
          x={padLeft - 4}
          y={y0 + 3}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-[9px]"
        >
          {initialMu.toFixed(1)}
        </text>
        <text
          x={padLeft - 4}
          y={padTop + plotH + 3}
          textAnchor="end"
          className="fill-muted-foreground font-mono text-[9px]"
        >
          0
        </text>

        {/* X-axis labels */}
        <text
          x={padLeft}
          y={height - 6}
          textAnchor="start"
          className="fill-muted-foreground text-[9px]"
        >
          day 0
        </text>
        <text
          x={padLeft + plotW}
          y={height - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[9px]"
        >
          day {DECAY_DAYS}
        </text>
      </svg>
    </div>
  );
}
