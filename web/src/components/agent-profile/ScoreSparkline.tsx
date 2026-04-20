"use client";

import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type SparklinePoint = {
  date: string;
  mu: number;
  sigma?: number;
};

export type ScoreSparklineProps = {
  data: SparklinePoint[];
  mu?: number | null;
  sigma?: number | null;
  className?: string;
};

const WIDTH = 240;
const HEIGHT = 64;
const PAD_X = 4;
const PAD_Y = 6;

function buildPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}

function buildArea(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const top = buildPath(points);
  const bottomRight = `L ${points[points.length - 1].x.toFixed(1)} ${HEIGHT - PAD_Y}`;
  const bottomLeft = `L ${points[0].x.toFixed(1)} ${HEIGHT - PAD_Y} Z`;
  return `${top} ${bottomRight} ${bottomLeft}`;
}

export function ScoreSparkline({
  data,
  mu,
  sigma,
  className,
}: ScoreSparklineProps) {
  const { path, area, points, isEmpty } = useMemo(() => {
    const validData = data.filter((d) => d.mu != null && !isNaN(d.mu));
    if (validData.length < 2) {
      return { path: "", area: "", points: [], isEmpty: true };
    }

    const plotW = WIDTH - PAD_X * 2;
    const plotH = HEIGHT - PAD_Y * 2;

    const minMu = Math.max(0, Math.min(...validData.map((d) => d.mu)) - 0.5);
    const maxMu = Math.min(10, Math.max(...validData.map((d) => d.mu)) + 0.5);
    const range = maxMu - minMu || 1;

    const pts = validData.map((d, i) => ({
      x: PAD_X + (i / (validData.length - 1)) * plotW,
      y: PAD_Y + plotH - ((d.mu - minMu) / range) * plotH,
    }));

    return {
      path: buildPath(pts),
      area: buildArea(pts),
      points: pts,
      isEmpty: false,
    };
  }, [data]);

  if (isEmpty) {
    return (
      <div
        className={cn(
          "flex h-16 items-center justify-center rounded-lg border bg-card text-xs text-muted-foreground",
          className
        )}
        aria-label="No score history available"
      >
        No history yet
      </div>
    );
  }

  const lastPoint = points[points.length - 1];

  return (
    <div
      className={cn("rounded-xl border bg-card overflow-hidden", className)}
      aria-label={`Score trend over last ${data.length} evaluations`}
    >
      <div className="border-b px-4 py-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Score Trend</h2>
        {mu != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {mu.toFixed(1)}
            {sigma != null && (
              <span className="ml-1 opacity-60">±{sigma.toFixed(2)}</span>
            )}
          </span>
        )}
      </div>
      <div className="px-2 py-3">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width="100%"
          height={HEIGHT}
          role="img"
          aria-label="Score sparkline chart"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.25" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Area fill */}
          <path d={area} fill="url(#sparkGradient)" />
          {/* Line */}
          <path
            d={path}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Last point dot */}
          {lastPoint && (
            <circle
              cx={lastPoint.x}
              cy={lastPoint.y}
              r={3}
              fill="hsl(var(--primary))"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

export function ScoreSparklingSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="px-2 py-3">
        <Skeleton className="h-16 w-full rounded" />
      </div>
    </div>
  );
}
