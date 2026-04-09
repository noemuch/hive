"use client";

const AXES = [
  { key: "output",                label: "Output"    },
  { key: "timing",                label: "Timing"    },
  { key: "consistency",           label: "Consistency" },
  { key: "silence_discipline",    label: "Silence"   },
  { key: "decision_contribution", label: "Decisions" },
  { key: "artifact_quality",      label: "Quality"   },
  { key: "collaboration",         label: "Collab"    },
  { key: "peer_signal",           label: "Peer"      },
] as const;

export type ReputationAxes = {
  output: number;
  timing: number;
  consistency: number;
  silence_discipline: number;
  decision_contribution: number;
  artifact_quality: number;
  collaboration: number;
  peer_signal: number;
};

export function SpiderChart({
  axes,
  score,
}: {
  axes: ReputationAxes;
  score: number;
}) {
  const cx = 140, cy = 140, maxR = 95, labelR = 120;
  const n = AXES.length;

  const angleAt = (i: number) => ((i / n) * 2 * Math.PI) - Math.PI / 2;

  const outerPts = AXES.map((_, i) => ({
    x: cx + maxR * Math.cos(angleAt(i)),
    y: cy + maxR * Math.sin(angleAt(i)),
  }));

  const dataPts = AXES.map((ax, i) => ({
    x: cx + (axes[ax.key] / 100) * maxR * Math.cos(angleAt(i)),
    y: cy + (axes[ax.key] / 100) * maxR * Math.sin(angleAt(i)),
  }));

  const labelPts = AXES.map((_, i) => {
    const a = angleAt(i);
    const cos = Math.cos(a), sin = Math.sin(a);
    return {
      x: cx + labelR * cos,
      y: cy + labelR * sin,
      label: AXES[i].label,
      textAnchor: (cos > 0.3 ? "start" : cos < -0.3 ? "end" : "middle") as React.SVGAttributes<SVGTextElement>["textAnchor"],
      dy: sin > 0.3 ? "1em" : sin < -0.3 ? "-0.2em" : "0.35em",
    };
  });

  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";

  // Grid rings at 25%, 50%, 75%, 100%
  const rings = [0.25, 0.5, 0.75, 1].map(s =>
    toPath(
      AXES.map((_, i) => ({
        x: cx + s * maxR * Math.cos(angleAt(i)),
        y: cy + s * maxR * Math.sin(angleAt(i)),
      }))
    )
  );

  return (
    <svg
      viewBox="0 0 280 280"
      width={240}
      height={240}
      className="mx-auto"
      aria-label={`Reputation radar chart, score ${Math.round(score)}`}
    >
      {/* Grid rings */}
      {rings.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeOpacity={0.08} strokeWidth={1} />
      ))}
      {/* Axis spokes */}
      {outerPts.map((p, i) => (
        <line
          key={i}
          x1={cx} y1={cy}
          x2={p.x.toFixed(2)} y2={p.y.toFixed(2)}
          stroke="currentColor" strokeOpacity={0.08} strokeWidth={1}
        />
      ))}
      {/* Data polygon */}
      <path
        d={toPath(dataPts)}
        fill="var(--accent-blue)"
        fillOpacity={0.2}
        stroke="var(--accent-blue)"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* Data point dots */}
      {dataPts.map((p, i) => (
        <circle key={i} cx={p.x.toFixed(2)} cy={p.y.toFixed(2)} r={2.5} fill="var(--accent-blue)" />
      ))}
      {/* Axis labels */}
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
      {/* Central score */}
      <text x={cx} y={cy - 5} textAnchor="middle" fontSize={24} fontWeight={700} fill="currentColor">
        {Math.round(score)}
      </text>
      <text x={cx} y={cy + 13} textAnchor="middle" fontSize={9} fill="currentColor" fillOpacity={0.45}>
        score
      </text>
    </svg>
  );
}
