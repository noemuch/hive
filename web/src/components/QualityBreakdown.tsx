"use client";

import { useEffect, useState, useId } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QUALITY_AXES, type QualityAxisKey } from "@/components/QualityDrilldown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const ROLE_LABELS: Record<string, string> = {
  pm: "PM",
  designer: "Designer",
  developer: "Developer",
  qa: "QA",
  ops: "Ops",
  generalist: "Generalist",
};

type AxisScore = {
  score: number;
  sigma: number;
  last_updated: string;
};

type QualityData = {
  axes: Partial<Record<QualityAxisKey, AxisScore>>;
  composite: number;
};

function ScoreBar({ score, sigma }: { score: number; sigma: number }) {
  const pct = (score / 10) * 100;
  const confidence = Math.max(0, Math.min(1, 1 - sigma / 2));
  const barColor =
    score >= 7.5 ? "bg-green-500" : score >= 5 ? "bg-yellow-500" : "bg-muted-foreground/50";

  return (
    <div
      className="group/bar relative flex items-center gap-2"
      title={`${score.toFixed(1)}/10 (σ ${sigma.toFixed(2)})`}
    >
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${pct}%`, opacity: 0.4 + confidence * 0.6 }}
        />
      </div>
      <span className="w-7 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function CompositeRing({ score, gradientId }: { score: number; gradientId: string }) {
  const r = 28;
  const circ = 2 * Math.PI * r;
  const fill = (score / 10) * circ;

  return (
    <svg width={72} height={72} viewBox="0 0 72 72" aria-label={`Composite quality ${score.toFixed(1)}`}>
      <circle cx={36} cy={36} r={r} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={5} />
      <circle
        cx={36}
        cy={36}
        r={r}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${fill.toFixed(2)} ${circ.toFixed(2)}`}
        strokeDashoffset={circ / 4}
        transform="rotate(-90 36 36) scale(-1 1) translate(-72 0)"
      />
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-primary, oklch(0.6 0.18 260))" stopOpacity={0.7} />
          <stop offset="100%" stopColor="var(--color-primary, oklch(0.6 0.18 260))" stopOpacity={1} />
        </linearGradient>
      </defs>
      <text x={36} y={38} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor">
        {score.toFixed(1)}
      </text>
    </svg>
  );
}

function ConfidencePill({ avgSigma }: { avgSigma: number }) {
  const label = avgSigma < 0.5 ? "Calibrated" : avgSigma < 1.0 ? "Provisional" : "Early";
  const color =
    avgSigma < 0.5
      ? "bg-green-500/15 text-green-400"
      : avgSigma < 1.0
      ? "bg-yellow-500/15 text-yellow-400"
      : "bg-muted-foreground/15 text-muted-foreground";

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium leading-none", color)}>
      {label}
    </span>
  );
}

export function QualityBreakdown({
  agentId,
  agentName,
  role,
}: {
  agentId: string;
  agentName: string;
  role: string;
}) {
  const gradientId = useId();
  const [data, setData] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setFetchError(false);

    fetch(`${API_URL}/api/agents/${agentId}/quality`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<QualityData>;
      })
      .then((d) => {
        if (!cancelled) {
          const hasAny = d?.axes && Object.keys(d.axes).length > 0;
          setData(hasAny ? d : null);
        }
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
  }, [agentId]);

  const axisScores = QUALITY_AXES.map((ax) => ({
    ...ax,
    data: data?.axes[ax.key] ?? null,
  }));

  const avgSigma =
    data && Object.values(data.axes).length > 0
      ? Object.values(data.axes).reduce((sum, a) => sum + (a?.sigma ?? 0), 0) /
        Object.values(data.axes).length
      : 2;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Failed to load quality data.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-tight">{agentName}</p>
          <Badge variant="secondary" className="mt-1 shrink-0 text-xs">
            {ROLE_LABELS[role] ?? role}
          </Badge>
        </div>

        {data ? (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <CompositeRing score={data.composite} gradientId={gradientId} />
            <ConfidencePill avgSigma={avgSigma} />
          </div>
        ) : null}
      </div>

      {/* No data state */}
      {!data ? (
        <div className="flex flex-col gap-1 py-2 text-center">
          <p className="text-xs font-medium text-muted-foreground">Evaluation pending</p>
          <p className="text-[11px] text-muted-foreground/70">
            HEAR evaluations run nightly.
          </p>
        </div>
      ) : (
        /* Axis bars */
        <div className="flex flex-col gap-2">
          {axisScores.map((ax) => (
            <div key={ax.key} className="flex flex-col gap-0.5">
              <p className="text-[10px] text-muted-foreground">{ax.label.split(" ")[0]}</p>
              {ax.data ? (
                <ScoreBar score={ax.data.score} sigma={ax.data.sigma} />
              ) : (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted" />
                  <span className="w-7 text-right text-xs text-muted-foreground/50">—</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* View details link */}
      <Button variant="ghost" size="sm" className="mt-1 h-7 w-full text-xs" asChild>
        <Link href={`/agent/${agentId}`}>View details</Link>
      </Button>
    </div>
  );
}
