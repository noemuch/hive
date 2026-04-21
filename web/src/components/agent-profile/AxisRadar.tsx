"use client";

import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type AxisRadarPoint = {
  axis: string;
  label: string;
  mu: number | null;
  sigma?: number;
  // When set, the row is rendered in the legend as "pending" (no numeric score).
  // Used for axes that exist in the HEAR rubric but haven't been evaluated
  // for this agent yet (e.g. adversarial_robustness before Argus runs).
  pendingLabel?: string;
};

export type AxisRadarProps = {
  data: AxisRadarPoint[];
  className?: string;
};

const SIZE = 220;
const CENTER = SIZE / 2;
const RADIUS = 80;
const LABEL_OFFSET = 20;

function polarToCart(angle: number, r: number): { x: number; y: number } {
  const rad = (angle - 90) * (Math.PI / 180);
  return {
    x: CENTER + r * Math.cos(rad),
    y: CENTER + r * Math.sin(rad),
  };
}

function buildPolygon(points: { x: number; y: number }[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

type ScoredPoint = AxisRadarPoint & { mu: number };

export function AxisRadar({ data, className }: AxisRadarProps) {
  const validData: ScoredPoint[] = data.filter(
    (d): d is ScoredPoint => d.mu != null && !isNaN(d.mu)
  );
  const n = validData.length;

  const { webPoints, gridPolygons, labelPositions, valuePoints } =
    useMemo(() => {
      if (n === 0) return { webPoints: [], gridPolygons: [], labelPositions: [], valuePoints: [] };

      const angles = validData.map((_, i) => (360 / n) * i);

      const webPts = angles.map((a) => polarToCart(a, RADIUS));

      // Concentric grid lines at 25%, 50%, 75%, 100%
      const grids = [0.25, 0.5, 0.75, 1].map((pct) =>
        angles.map((a) => polarToCart(a, RADIUS * pct))
      );

      const lbls = angles.map((a, i) => ({
        pos: polarToCart(a, RADIUS + LABEL_OFFSET),
        label: validData[i].label,
        angle: a,
      }));

      const vals = angles.map((a, i) => ({
        pos: polarToCart(a, (validData[i].mu / 10) * RADIUS),
        mu: validData[i].mu,
      }));

      return {
        webPoints: webPts,
        gridPolygons: grids,
        labelPositions: lbls,
        valuePoints: vals,
      };
    }, [validData, n]);

  // Fallback only when there is *nothing* to show — including pending axes.
  // If the agent has zero scored axes but has a pending row (e.g. AR before
  // Argus runs), we still render the component so the rubric dimension is
  // visible in the legend.
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border bg-card p-8 text-xs text-muted-foreground",
          className
        )}
        aria-label="No radar data available"
      >
        No evaluation data
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-xl border bg-card overflow-hidden", className)}
      aria-label="HEAR axis radar chart"
    >
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">HEAR Axes</h2>
      </div>
      <div className="flex justify-center px-2 py-4">
        {n === 0 ? (
          <div
            className="flex items-center justify-center text-xs text-muted-foreground"
            style={{ width: SIZE, height: SIZE }}
            aria-label="No scored axes yet"
          >
            No scored axes yet
          </div>
        ) : (
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          role="img"
          aria-label={`Radar chart showing scores across ${n} HEAR ${n === 1 ? "axis" : "axes"}`}
          className="max-w-full"
        >
          {/* Grid polygons */}
          {gridPolygons.map((poly, i) => (
            <polygon
              key={i}
              points={buildPolygon(poly)}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="1"
            />
          ))}

          {/* Spoke lines */}
          {webPoints.map((pt, i) => (
            <line
              key={i}
              x1={CENTER}
              y1={CENTER}
              x2={pt.x.toFixed(1)}
              y2={pt.y.toFixed(1)}
              stroke="hsl(var(--border))"
              strokeWidth="1"
            />
          ))}

          {/* Value polygon */}
          <polygon
            points={buildPolygon(valuePoints.map((v) => v.pos))}
            fill="hsl(var(--primary) / 0.2)"
            stroke="hsl(var(--primary))"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Value dots */}
          {valuePoints.map((v, i) => (
            <circle
              key={i}
              cx={v.pos.x.toFixed(1)}
              cy={v.pos.y.toFixed(1)}
              r={3}
              fill="hsl(var(--primary))"
              aria-label={`${validData[i].label}: ${v.mu.toFixed(1)}`}
            />
          ))}

          {/* Axis labels */}
          {labelPositions.map((lbl, i) => {
            const a = lbl.angle % 360;
            const anchor =
              a > 10 && a < 170
                ? "start"
                : a > 190 && a < 350
                ? "end"
                : "middle";
            return (
              <text
                key={i}
                x={lbl.pos.x.toFixed(1)}
                y={lbl.pos.y.toFixed(1)}
                textAnchor={anchor}
                dominantBaseline="middle"
                fontSize={9}
                fill="hsl(var(--muted-foreground))"
                className="font-sans"
              >
                {lbl.label}
              </text>
            );
          })}

          {/* Center score labels */}
          {valuePoints.map((v, i) =>
            v.mu >= 5 ? (
              <text
                key={`score-${i}`}
                x={(v.pos.x + CENTER) / 2}
                y={(v.pos.y + CENTER) / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fill="hsl(var(--primary))"
                opacity="0"
              >
                {v.mu.toFixed(1)}
              </text>
            ) : null
          )}
        </svg>
        )}
      </div>

      {/* Legend table — includes pending axes (null score) so the rubric
          dimension is visible even before an evaluator has graded it. */}
      <div className="divide-y border-t">
        {data.map((d) => {
          const scored = d.mu != null && !isNaN(d.mu);
          return (
            <div
              key={d.axis}
              className="flex items-center justify-between px-4 py-1.5 text-xs"
              title={!scored && d.pendingLabel ? d.pendingLabel : undefined}
            >
              <span className="text-muted-foreground">{d.label}</span>
              {scored ? (
                <span className="tabular-nums font-medium">
                  {(d.mu as number).toFixed(1)}
                </span>
              ) : (
                <span className="italic text-muted-foreground/70">
                  {d.pendingLabel ?? "Pending"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AxisRadarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", className)}>
      <div className="border-b px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex justify-center py-4">
        <Skeleton className="h-[220px] w-[220px] rounded-full" />
      </div>
    </div>
  );
}
