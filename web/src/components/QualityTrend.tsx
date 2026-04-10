"use client";

import { useEffect, useState, useId } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type TimelinePoint = {
  date: string;
  score: number;
  sigma: number;
};

function SparkLine({ points, gradientId }: { points: TimelinePoint[]; gradientId: string }) {
  if (points.length < 2) return null;

  const W = 200;
  const H = 40;
  const P = 2;

  const scores = points.map((p) => p.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const range = maxScore - minScore || 1;

  const pts = points.map((p, i) => ({
    x: P + (i / (points.length - 1)) * (W - 2 * P),
    y: H - P - ((p.score - minScore) / range) * (H - 2 * P),
  }));

  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  const areaPath =
    `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;

  const lastScore = scores[scores.length - 1];
  const firstScore = scores[0];
  const delta = lastScore - firstScore;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={40}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={delta >= 0 ? "var(--color-success, oklch(0.65 0.18 142))" : "var(--color-danger, oklch(0.6 0.2 25))"}
            stopOpacity={0.25}
          />
          <stop
            offset="100%"
            stopColor={delta >= 0 ? "var(--color-success, oklch(0.65 0.18 142))" : "var(--color-danger, oklch(0.6 0.2 25))"}
            stopOpacity={0}
          />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={delta >= 0 ? "var(--color-success, oklch(0.65 0.18 142))" : "var(--color-danger, oklch(0.6 0.2 25))"}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function QualityTrend({ agentId, days = 28 }: { agentId: string; days?: number }) {
  const gradientId = useId();
  const [points, setPoints] = useState<TimelinePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setFetchError(false);

    fetch(`${API_URL}/api/agents/${agentId}/quality/timeline?days=${days}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<TimelinePoint[]>;
      })
      .then((data) => {
        if (!cancelled) setPoints(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [agentId, days]);

  if (loading) {
    return (
      <div className="flex h-10 items-center justify-center">
        <div className="size-3 animate-spin rounded-full border border-muted border-t-foreground" />
      </div>
    );
  }

  if (fetchError || points.length < 2) {
    return (
      <p className="py-1 text-center text-[10px] text-muted-foreground/60">
        Not enough data for trend
      </p>
    );
  }

  const lastScore = points[points.length - 1].score;
  const firstScore = points[0].score;
  const delta = lastScore - firstScore;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{days}d trend</span>
        <span
          className={
            delta > 0.05
              ? "text-[10px] font-medium text-green-500"
              : delta < -0.05
              ? "text-[10px] font-medium text-red-400"
              : "text-[10px] text-muted-foreground"
          }
        >
          {delta > 0.05 ? "+" : ""}
          {delta.toFixed(1)}
        </span>
      </div>
      <div className="overflow-hidden rounded-md bg-muted/20 px-1 py-1">
        <SparkLine points={points} gradientId={gradientId} />
      </div>
    </div>
  );
}
