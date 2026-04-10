"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { type QualityAxisKey } from "@/components/QualityDrilldown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const ROLE_LABELS: Record<string, string> = {
  pm: "PM",
  designer: "Designer",
  developer: "Developer",
  qa: "QA",
  ops: "Ops",
  generalist: "Generalist",
};

const AXIS_SHORT: Record<string, string> = {
  decision_wisdom: "Dec",
  self_awareness_calibration: "Awa",
  reasoning_depth: "Rea",
  communication_clarity: "Cla",
  initiative_quality: "Ini",
  collaborative_intelligence: "Col",
  contextual_judgment: "Con",
  persona_coherence: "Per",
};

const AXIS_LONG: Record<string, string> = {
  reasoning_depth: "reasoning",
  decision_wisdom: "decisions",
  communication_clarity: "communication",
  initiative_quality: "initiative",
  collaborative_intelligence: "collaboration",
  self_awareness_calibration: "self-awareness",
  contextual_judgment: "judgment",
  persona_coherence: "persona",
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

function AxisBar({ label, score }: { label: string; score: number }) {
  const pct = (score / 10) * 100;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-all", barColor(score))}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {score.toFixed(1)} {label}
      </span>
    </div>
  );
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
}: {
  agentId: string;
  agentName: string;
  role: string;
  company?: string | null;
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

  /* Derive best/worst axes */
  const sortedAxes = data
    ? Object.entries(data.axes)
        .filter(([, v]) => v?.score != null)
        .sort((a, b) => (b[1]?.score ?? 0) - (a[1]?.score ?? 0))
    : [];

  const bestEntry = sortedAxes[0] ?? null;
  const worstEntry = sortedAxes[sortedAxes.length - 1] ?? null;

  /* Trend delta display */
  const delta = data?.trend_delta ?? null;
  const deltaPositive = delta !== null && delta > 0;
  const deltaNegative = delta !== null && delta < 0;
  const deltaText =
    delta === null
      ? null
      : delta === 0
      ? "● stable"
      : deltaPositive
      ? `▲ +${delta.toFixed(1)}`
      : `▼ ${delta.toFixed(1)}`;

  const roleLabel = ROLE_LABELS[role] ?? role;
  const subtitle = [roleLabel, company].filter(Boolean).join(" · ");

  /* No data state */
  if (!data) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-sm font-medium leading-tight">{agentName}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex flex-col gap-1 text-center">
            <p className="text-sm font-medium text-muted-foreground">Evaluation pending</p>
            <p className="text-xs text-muted-foreground/70">
              First report in the next batch
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const summaryText = generateSummary(data.axes);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        {/* Agent name + role + company */}
        <div>
          <p className="text-sm font-medium leading-tight">{agentName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>

        {/* Hero number + trend delta */}
        <div className="flex flex-col items-center gap-1">
          <span className="text-4xl font-bold tracking-tight">
            {data.composite.toFixed(1)}
          </span>
          {deltaText && (
            <span
              className={cn(
                "text-sm font-medium",
                deltaPositive && "text-green-500",
                deltaNegative && "text-red-500",
                !deltaPositive && !deltaNegative && "text-muted-foreground",
              )}
            >
              {deltaText}
            </span>
          )}
        </div>

        {/* Best + worst axis bars */}
        {(bestEntry || worstEntry) && (
          <div className="flex flex-col gap-2">
            {bestEntry && (
              <AxisBar
                label={AXIS_SHORT[bestEntry[0]] ?? bestEntry[0]}
                score={bestEntry[1]?.score ?? 0}
              />
            )}
            {worstEntry && worstEntry[0] !== bestEntry?.[0] && (
              <AxisBar
                label={AXIS_SHORT[worstEntry[0]] ?? worstEntry[0]}
                score={worstEntry[1]?.score ?? 0}
              />
            )}
          </div>
        )}

        {/* Natural language summary */}
        {summaryText && (
          <p className="text-xs text-muted-foreground">{summaryText}</p>
        )}

        {/* CTA */}
        <Link
          href={`/agent/${agentId}`}
          className="flex h-7 w-full items-center justify-center rounded-md text-xs hover:bg-foreground/5"
        >
          See breakdown →
        </Link>
      </CardContent>
    </Card>
  );
}
