"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { QualityDrilldown, QUALITY_AXES, type QualityAxisKey } from "@/components/QualityDrilldown";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type AxisScore = {
  score: number;
  sigma: number;
  last_updated: string;
};

type QualityData = {
  axes: Partial<Record<QualityAxisKey, AxisScore>>;
  composite: number;
};

// Spider chart for quality axes (1–10 scale)
function QualitySpiderChart({ axes, composite }: { axes: Partial<Record<QualityAxisKey, AxisScore>>; composite: number }) {
  const cx = 140, cy = 140, maxR = 95, labelR = 118;
  const n = QUALITY_AXES.length;

  const angleAt = (i: number) => ((i / n) * 2 * Math.PI) - Math.PI / 2;

  const outerPts = QUALITY_AXES.map((_, i) => ({
    x: cx + maxR * Math.cos(angleAt(i)),
    y: cy + maxR * Math.sin(angleAt(i)),
  }));

  const dataPts = QUALITY_AXES.map((ax, i) => {
    const v = Math.max(0, Math.min(10, axes[ax.key]?.score ?? 0));
    return {
      x: cx + (v / 10) * maxR * Math.cos(angleAt(i)),
      y: cy + (v / 10) * maxR * Math.sin(angleAt(i)),
    };
  });

  const AXIS_ABBREV: Record<string, string> = {
    reasoning_depth: "Reasoning",
    decision_wisdom: "Decision",
    communication_clarity: "Clarity",
    initiative_quality: "Initiative",
    collaborative_intelligence: "Collab.",
    self_awareness_calibration: "Awareness",
    persona_coherence: "Persona",
    contextual_judgment: "Context",
  };

  const labelPts = QUALITY_AXES.map((ax, i) => {
    const a = angleAt(i);
    const cos = Math.cos(a), sin = Math.sin(a);
    const shortLabel = AXIS_ABBREV[ax.key] ?? ax.label.split(" ")[0];
    return {
      x: cx + labelR * cos,
      y: cy + labelR * sin,
      label: shortLabel,
      textAnchor: (cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle") as React.SVGAttributes<SVGTextElement>["textAnchor"],
      dy: sin > 0.3 ? "1em" : sin < -0.3 ? "-0.2em" : "0.35em",
    };
  });

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";

  const rings = [0.25, 0.5, 0.75, 1].map(s =>
    toPath(
      QUALITY_AXES.map((_, i) => ({
        x: cx + s * maxR * Math.cos(angleAt(i)),
        y: cy + s * maxR * Math.sin(angleAt(i)),
      }))
    )
  );

  const hasData = QUALITY_AXES.some(ax => (axes[ax.key]?.score ?? 0) > 0);

  return (
    <svg
      viewBox="0 0 280 280"
      width={240}
      height={240}
      className="mx-auto"
      aria-label={`Quality radar chart, composite score ${composite.toFixed(1)}`}
    >
      {rings.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
      ))}
      {outerPts.map((p, i) => (
        <line
          key={i}
          x1={cx} y1={cy}
          x2={p.x.toFixed(2)} y2={p.y.toFixed(2)}
          stroke="currentColor" strokeOpacity={0.08} strokeWidth={1}
        />
      ))}
      {hasData && (
        <>
          <path
            d={toPath(dataPts)}
            fill="var(--color-primary, oklch(0.6 0.18 260))"
            fillOpacity={0.18}
            stroke="var(--color-primary, oklch(0.6 0.18 260))"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
          {dataPts.map((p, i) => (
            <circle key={i} cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={2.5} fill="var(--color-primary, oklch(0.6 0.18 260))" />
          ))}
        </>
      )}
      {labelPts.map((p, i) => (
        <text
          key={i}
          x={p.x.toFixed(2)} y={p.y.toFixed(2)}
          textAnchor={p.textAnchor}
          dy={p.dy}
          fontSize={8.5}
          fill="currentColor"
          fillOpacity={0.55}
        >
          {p.label}
        </text>
      ))}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize={24} fontWeight={700} fill="currentColor">
        {hasData ? composite.toFixed(1) : "—"}
      </text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
        quality
      </text>
    </svg>
  );
}

function sigmaBar(sigma: number) {
  // sigma typically 0–2; lower = more calibrated
  const fill = Math.max(0, Math.min(1, 1 - sigma / 2));
  return (
    <div className="flex items-center gap-1.5" title={`Uncertainty σ ${sigma.toFixed(2)}`} aria-label={`Uncertainty ${sigma.toFixed(2)}`}>
      <div className="h-1 w-10 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full", fill > 0.7 ? "bg-green-500" : fill > 0.4 ? "bg-yellow-500" : "bg-muted-foreground/40")}
          style={{ width: `${fill * 100}%` }}
        />
      </div>
    </div>
  );
}

export function QualityPanel({ agentId }: { agentId: string }) {
  const [data, setData] = useState<QualityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // Drilldown state
  const [drillAxis, setDrillAxis] = useState<QualityAxisKey | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setFetchError(false);
    fetch(`${API_URL}/api/agents/${agentId}/quality`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<QualityData>; })
      .then(d => {
        if (!cancelled) {
          // Treat empty axes as no data
          const hasAny = d?.axes && Object.keys(d.axes).length > 0;
          setData(hasAny ? d : null);
        }
      })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [agentId]);

  function openDrilldown(key: QualityAxisKey) {
    setDrillAxis(key);
    setDrillOpen(true);
  }

  const drillAxisData = drillAxis ? data?.axes[drillAxis] : null;

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Failed to load quality data.
      </p>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <span className="text-2xl" aria-hidden="true">⏳</span>
        <p className="text-sm font-medium">Quality evaluation pending</p>
        <p className="max-w-[240px] text-xs text-muted-foreground">
          HEAR evaluations run nightly. Check back after the agent has produced artifacts.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Spider chart */}
      <QualitySpiderChart axes={data.axes} composite={data.composite} />

      {/* Axis list */}
      <div className="mt-6 border-t border-border/60 pt-5 flex flex-col divide-y divide-border/60">
        {QUALITY_AXES.map(ax => {
          const axData = data.axes[ax.key];
          return (
            <button
              key={ax.key}
              type="button"
              onClick={() => openDrilldown(ax.key)}
              className="group flex items-start gap-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm px-1"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium leading-none">{ax.label}</span>
                  {axData && sigmaBar(axData.sigma)}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {ax.description}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {axData ? (
                  <span className="font-mono text-sm font-semibold tabular-nums">
                    {axData.score.toFixed(1)}
                    <span className="text-xs font-normal text-muted-foreground">/10</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Drilldown Sheet */}
      {drillAxis && (
        <QualityDrilldown
          agentId={agentId}
          axisKey={drillAxis}
          score={drillAxisData?.score ?? 0}
          sigma={drillAxisData?.sigma ?? 2}
          open={drillOpen}
          onClose={() => setDrillOpen(false)}
        />
      )}
    </>
  );
}
