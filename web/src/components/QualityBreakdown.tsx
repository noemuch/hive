"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { type QualityAxisKey } from "@/components/QualityDrilldown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const AXIS_SHORT: Record<string, string> = {
  decision_wisdom: "Decision",
  self_awareness_calibration: "Awareness",
  reasoning_depth: "Reasoning",
  communication_clarity: "Clarity",
  initiative_quality: "Initiative",
  collaborative_intelligence: "Collab.",
  contextual_judgment: "Context",
};

const AXIS_LONG: Record<string, string> = {
  reasoning_depth: "reasoning",
  decision_wisdom: "decisions",
  communication_clarity: "communication",
  initiative_quality: "initiative",
  collaborative_intelligence: "collaboration",
  self_awareness_calibration: "self-awareness",
  contextual_judgment: "judgment",
};

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
  trend_delta?: number | null;
};

function barColor(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function generateSummary(axes: Partial<Record<string, AxisScore>>): string {
  const scored = Object.entries(axes)
    .filter(([, v]) => v?.score != null)
    .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0));

  if (scored.length === 0) return "";
  const best = AXIS_LONG[scored[0][0]] ?? scored[0][0];
  const worst = AXIS_LONG[scored[scored.length - 1][0]] ?? scored[scored.length - 1][0];

  if ((scored[scored.length - 1][1]?.score ?? 0) >= 7) return "Strong across all axes.";
  if ((scored[0][1]?.score ?? 0) < 4) return "Needs improvement overall.";
  return `Strong ${best}, needs work on ${worst}.`;
}

export function QualityBreakdown({
  agentId,
  agentName,
  role,
  company,
  onBreakdownClick,
}: {
  agentId: string;
  agentName: string;
  role: string;
  company?: string | null;
  onBreakdownClick?: (agentId: string) => void;
}) {
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

  const roleLabel = ROLE_LABELS[role] ?? role;
  const subtitle = [roleLabel, company].filter(Boolean).join(" · ");

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center p-6">
          <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (fetchError) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-center text-xs text-muted-foreground">Failed to load quality data.</p>
        </CardContent>
      </Card>
    );
  }

  /* No data state */
  if (!data) {
    return (
      <Card className="flex flex-col">
        <CardContent className="flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold leading-none truncate">{agentName}</p>
              <p className="mt-1 text-xs text-muted-foreground truncate">{subtitle}</p>
            </div>
            <span className="text-sm font-bold text-muted-foreground/40 shrink-0">—</span>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Evaluation pending — first report in the next batch
          </p>
        </CardContent>
      </Card>
    );
  }

  /* Derive best/worst axes */
  const sortedAxes = Object.entries(data.axes)
    .filter(([, v]) => v?.score != null)
    .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0));

  const bestEntry = sortedAxes[0] ?? null;
  const worstEntry = sortedAxes.length > 1 ? sortedAxes[sortedAxes.length - 1] : null;

  /* Trend delta */
  const delta = data.trend_delta ?? null;
  const deltaPositive = delta !== null && delta > 0;
  const deltaNegative = delta !== null && delta < 0;
  const deltaText =
    delta === null ? null
    : delta === 0 ? "stable"
    : deltaPositive ? `▲ +${delta.toFixed(1)}`
    : `▼ ${delta.toFixed(1)}`;

  const summaryText = generateSummary(data.axes);

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3">
        {/* Header: name+role LEFT, score+trend RIGHT */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-none truncate">{agentName}</p>
            <p className="mt-1 text-xs text-muted-foreground truncate">{subtitle}</p>
          </div>
          <div className="flex flex-col items-end shrink-0">
            <span className="text-sm font-bold tracking-tight leading-none">
              {data.composite.toFixed(1)}
            </span>
            {deltaText ? (
              <span
                className={cn(
                  "mt-1 text-xs font-medium",
                  deltaPositive && "text-green-500",
                  deltaNegative && "text-red-500",
                  !deltaPositive && !deltaNegative && "text-muted-foreground",
                )}
              >
                {deltaText}
              </span>
            ) : (
              <span className="mt-1 text-xs text-muted-foreground/50">—</span>
            )}
          </div>
        </div>

        {/* Best + worst axis bars */}
        {bestEntry && (
          <div className="flex flex-col gap-3">
            {/* Best */}
            <div className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Best</span>
                <span className="text-xs font-medium tabular-nums">{(bestEntry[1]?.score ?? 0).toFixed(1)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs font-medium">{AXIS_SHORT[bestEntry[0]] ?? bestEntry[0]}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full transition-all", barColor(bestEntry[1]?.score ?? 0))}
                    style={{ width: `${((bestEntry[1]?.score ?? 0) / 10) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Worst */}
            {worstEntry && worstEntry[0] !== bestEntry[0] && (
              <div className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Needs work</span>
                  <span className="text-xs font-medium tabular-nums">{(worstEntry[1]?.score ?? 0).toFixed(1)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-xs font-medium">{AXIS_SHORT[worstEntry[0]] ?? worstEntry[0]}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn("h-full rounded-full transition-all", barColor(worstEntry[1]?.score ?? 0))}
                      style={{ width: `${((worstEntry[1]?.score ?? 0) / 10) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Separator + summary (truncated to 1 line) */}
        {summaryText && (
          <p className="border-t pt-3 text-xs text-muted-foreground truncate">{summaryText}</p>
        )}

        {/* CTA */}
        <button
          type="button"
          onClick={() => onBreakdownClick?.(agentId)}
          className="flex h-8 w-full items-center justify-center rounded-md border text-xs font-medium text-foreground/80 hover:bg-muted/50 transition-colors"
        >
          See breakdown →
        </button>
      </CardContent>
    </Card>
  );
}
