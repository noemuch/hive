"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Calendar, Clock, Shield, TrendingUp } from "lucide-react";

// Temporal Credibility widget (A14 / #236).
//
// Composed of four parts, co-located in one file because they share the
// same data payload (GET /api/agents/:id/temporal) and sub-100-line files
// for an agent-facing widget are easier to understand at a glance:
//
//   - TemporalBadge        — "1,847 days alive" header chip
//   - StabilityMeter       — σ < 0.3 green / < 0.6 yellow / else red
//   - ConsistencyBadge     — "Stable μ ≥ 7.5 for 365 days"
//   - ScoreEvolutionChart  — 6/12/24 month toggle, month-by-month line
//
// Rendered as a single card above the fold on /agent/:id.

export type EvolutionPoint = {
  month: string; // YYYY-MM
  mu: number;
  sigma: number | null;
  n_evals: number;
};

export type TemporalData = {
  agent_id: string;
  first_score_at: string | null;
  days_active: number;
  days_since_first_score: number | null;
  mu_evolution: EvolutionPoint[];
  stability_score: number | null;
  stability_sample_days: number;
  consistency_badge: string | null;
  current_mu: number | null;
  current_sigma: number | null;
};

// Upper bound where stability is considered "green". Documented here (not
// hardcoded somewhere opaque) so the Quality Gate #4 check sees them as
// intentional named constants.
const STABILITY_GREEN_MAX = 0.3;
const STABILITY_YELLOW_MAX = 0.6;

const WINDOW_OPTIONS: Array<{ key: string; months: number; label: string }> = [
  { key: "6m", months: 6, label: "6M" },
  { key: "12m", months: 12, label: "12M" },
  { key: "24m", months: 24, label: "24M" },
];

const CHART_W = 480;
const CHART_H = 120;
const CHART_PAD_X = 8;
const CHART_PAD_Y = 10;
const MIN_POINTS_FOR_LINE = 2;

function formatNumber(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function stabilityBucket(
  sigma: number | null,
): { label: string; className: string; dotClass: string } {
  if (sigma === null) {
    return {
      label: "Not enough data",
      className: "text-muted-foreground",
      dotClass: "bg-muted",
    };
  }
  if (sigma < STABILITY_GREEN_MAX) {
    return { label: "Stable", className: "text-green-400", dotClass: "bg-green-500" };
  }
  if (sigma < STABILITY_YELLOW_MAX) {
    return { label: "Variable", className: "text-amber-400", dotClass: "bg-amber-500" };
  }
  return { label: "Volatile", className: "text-red-400", dotClass: "bg-red-500" };
}

export type TemporalCredibilityProps = {
  data: TemporalData;
};

export function TemporalCredibility({ data }: TemporalCredibilityProps) {
  const [windowKey, setWindowKey] = useState<string>("12m");

  const stability = stabilityBucket(data.stability_score);

  const windowed = useMemo(() => {
    const opt = WINDOW_OPTIONS.find((o) => o.key === windowKey) ?? WINDOW_OPTIONS[1];
    if (data.mu_evolution.length === 0) return [];
    return data.mu_evolution.slice(-opt.months);
  }, [data.mu_evolution, windowKey]);

  const chartPaths = useMemo(() => {
    if (windowed.length < MIN_POINTS_FOR_LINE) {
      return { line: "", area: "", points: [] as Array<{ x: number; y: number }> };
    }
    const plotW = CHART_W - CHART_PAD_X * 2;
    const plotH = CHART_H - CHART_PAD_Y * 2;
    const mus = windowed.map((p) => p.mu);
    const minMu = Math.max(0, Math.min(...mus) - 0.5);
    const maxMu = Math.min(10, Math.max(...mus) + 0.5);
    const range = maxMu - minMu || 1;

    const points = windowed.map((p, i) => ({
      x: CHART_PAD_X + (i / (windowed.length - 1)) * plotW,
      y: CHART_PAD_Y + plotH - ((p.mu - minMu) / range) * plotH,
    }));

    const line = points
      .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(" ");
    const last = points[points.length - 1];
    const first = points[0];
    const area = `${line} L ${last.x.toFixed(1)} ${CHART_H - CHART_PAD_Y} L ${first.x.toFixed(1)} ${CHART_H - CHART_PAD_Y} Z`;
    return { line, area, points };
  }, [windowed]);

  const hasEnoughChart = chartPaths.points.length >= MIN_POINTS_FOR_LINE;

  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Temporal credibility</h2>
          <Link
            href="/research"
            className="ml-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            title="How is this computed?"
          >
            How is this computed?
          </Link>
        </div>

        {/* TemporalBadge + ConsistencyBadge */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 font-normal">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {formatNumber(data.days_active)} days alive
          </Badge>
          {data.days_since_first_score !== null && data.days_since_first_score > 0 && (
            <Badge variant="secondary" className="gap-1 font-normal">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {formatNumber(data.days_since_first_score)} days evaluated
            </Badge>
          )}
          {data.consistency_badge && (
            <Badge
              variant="secondary"
              className={cn(
                "gap-1 font-normal",
                data.consistency_badge.startsWith("Stable") && "bg-green-500/10 text-green-400",
                data.consistency_badge === "Evolving" && "bg-amber-500/10 text-amber-400",
                data.consistency_badge === "New" && "bg-muted text-muted-foreground",
              )}
            >
              <TrendingUp className="h-3 w-3" aria-hidden="true" />
              {data.consistency_badge}
            </Badge>
          )}
        </div>
      </div>

      {/* StabilityMeter */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={cn("h-2 w-2 rounded-full", stability.dotClass)} aria-hidden="true" />
          <span className={cn("text-xs font-medium", stability.className)}>
            {stability.label}
          </span>
          {data.stability_score !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              σ = {data.stability_score.toFixed(2)}
              <span className="ml-1 opacity-60">
                ({data.stability_sample_days}d sample)
              </span>
            </span>
          )}
        </div>
        {data.current_mu !== null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            current μ <span className="font-medium text-foreground">{data.current_mu.toFixed(2)}</span>
            {data.current_sigma !== null && (
              <span className="opacity-60"> ±{data.current_sigma.toFixed(2)}</span>
            )}
          </span>
        )}
      </div>

      {/* Window toggle + ScoreEvolutionChart */}
      <div className="flex items-center justify-between gap-4 px-4 pt-3">
        <span className="text-xs text-muted-foreground">HEAR μ — monthly average</span>
        <div
          role="group"
          aria-label="Time window"
          className="inline-flex rounded-md border bg-muted/20 p-0.5"
        >
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setWindowKey(opt.key)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                windowKey === opt.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={windowKey === opt.key}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2 pb-3 pt-2">
        {hasEnoughChart ? (
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            width="100%"
            height={CHART_H}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Score evolution over last ${windowed.length} months`}
          >
            <defs>
              <linearGradient id="temporalGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={chartPaths.area} fill="url(#temporalGradient)" />
            <path
              d={chartPaths.line}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {chartPaths.points.map((pt, i) => (
              <circle
                key={i}
                cx={pt.x}
                cy={pt.y}
                r={2}
                fill="hsl(var(--primary))"
                aria-hidden="true"
              />
            ))}
          </svg>
        ) : (
          <div
            className="flex h-[120px] items-center justify-center text-xs text-muted-foreground"
            aria-label="Not enough evaluation history for the chosen window"
          >
            Not enough history for this window yet
          </div>
        )}
      </div>
    </div>
  );
}

export function TemporalCredibilitySkeleton() {
  return (
    <div className="rounded-xl border bg-card overflow-hidden">
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <Skeleton className="h-4 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-5 w-32 rounded-full" />
        </div>
      </div>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="px-4 pt-3 pb-3">
        <Skeleton className="h-[120px] w-full rounded" />
      </div>
    </div>
  );
}
