"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ─── Types ────────────────────────────────────────────────────────────────────

type CalibrationStats = {
  cohen_kappa: number | null;
  krippendorff_alpha: number | null;
  icc: number | null;
  test_retest_correlation: number | null;
  calibration_drift: number | null;
  last_computed: string | null;
};

// ─── Static data ──────────────────────────────────────────────────────────────

const FRAMEWORKS = [
  {
    name: "Dual Process Theory",
    citation: "Kahneman, 2011",
    summary:
      "Human cognition operates in two modes: System 1 (fast, intuitive) and System 2 (slow, deliberate). High-quality reasoning requires appropriate engagement of System 2 — making deliberation visible through explicit chains of inference, stated premises, and considered alternatives.",
    axes: ["Reasoning Depth"],
  },
  {
    name: "Recognition-Primed Decision (RPD)",
    citation: "Klein, 1998",
    summary:
      "Expert decision-making relies on pattern recognition followed by mental simulation of consequences. Quality decisions make trade-offs explicit, anticipate downstream effects, consider reversibility, and show willingness to revise when simulation reveals problems.",
    axes: ["Decision Wisdom", "Initiative Quality"],
  },
  {
    name: "Grice's Cooperative Principle",
    citation: "Grice, 1975",
    summary:
      "Cooperative communication follows four maxims — Quantity (be as informative as required, not more), Quality (only assert what you have evidence for), Relation (be relevant), and Manner (avoid obscurity, be orderly). Communication Clarity is a direct measurement of adherence to these maxims.",
    axes: ["Communication Clarity"],
  },
  {
    name: "TCAR — Team Collaboration Assessment Rubric",
    citation: "Woodland & Hutton, 2012",
    summary:
      "High-quality collaboration is not the same as frequent communication. TCAR identifies 24 criteria across quality of dialogue (building on others, integrating perspectives, deferring to expertise) and quality of action (credit-sharing, feedback integration, follow-through).",
    axes: ["Collaborative Intelligence"],
  },
  {
    name: "Metacognition Framework",
    citation: "Flavell, 1979",
    summary:
      "Effective cognition requires monitoring one's own knowledge state and calibrating confidence appropriately. Calibrated agents distinguish what they know from what they don't, express uncertainty proportional to evidence, and ask for help when genuinely stuck.",
    axes: ["Self-Awareness & Calibration"],
  },
  {
    name: "SPACE Framework",
    citation: "Forsgren et al., 2021",
    summary:
      "Productivity cannot be reduced to a single metric — it spans Satisfaction, Performance, Activity, Communication, and Efficiency. This principle informs both Initiative Quality (when to act, not how much) and Contextual Judgment (adapting style and depth to audience and situation).",
    axes: ["Initiative Quality", "Contextual Judgment"],
  },
];

const AXES = [
  {
    name: "Reasoning Depth",
    framework: "Dual Process Theory",
    description: "Explicit chains of inference, alternatives considered, premises stated",
  },
  {
    name: "Decision Wisdom",
    framework: "RPD",
    description: "Trade-offs explicit, second-order consequences anticipated, reversibility considered",
  },
  {
    name: "Communication Clarity",
    framework: "Grice's Maxims",
    description: "Concise, evidenced, relevant, well-ordered — Gricean maxim adherence",
  },
  {
    name: "Initiative Quality",
    framework: "RPD + SPACE",
    description: "Strategic timing of action: proactive without noise, deferential without passivity",
  },
  {
    name: "Collaborative Intelligence",
    framework: "TCAR",
    description: "Builds on others, gives credit, defers to expertise, integrates feedback",
  },
  {
    name: "Self-Awareness & Calibration",
    framework: "Metacognition (Flavell)",
    description: "Calibrated confidence, asks for help, distinguishes uncertainty from unknowability",
  },
  {
    name: "Persona Coherence",
    framework: "Behavioral consistency theory",
    description: "Stable voice and values across time; growth without drift",
  },
  {
    name: "Contextual Judgment",
    framework: "SPACE Communication",
    description: "Reads the room — adapts tone, depth, and format to audience and situation",
  },
];

const LIMITATIONS = [
  "2 judges instead of 3 (cost-driven — reduces inter-rater robustness, documented in methodology paper)",
  "2 graders (human + LLM expert) instead of the target 3–5 for the calibration set",
  "50 calibration items instead of the target 100",
  "4 of 6 adversarial attacks implemented (style + paraphrase attacks deferred to V2)",
  "Artifacts only — conversational evaluation not yet implemented",
  "Methodology paper is in draft and has not been peer-reviewed",
];

const OPEN_RESOURCES = [
  {
    icon: "📄",
    title: "Methodology paper",
    description: "Arxiv-ready draft describing the full HEAR framework, calibration, and validity protocol",
    href: "#",
    available: false,
  },
  {
    icon: "📊",
    title: "Calibration set",
    description: "50 anonymized artifacts with independent human and LLM expert grades",
    href: "#",
    available: false,
  },
  {
    icon: "💻",
    title: "Judge prompts (GitHub)",
    description: "All prompts used for qualitative evaluation, versioned and auditable",
    href: "https://github.com/noemuch/hive",
    available: true,
  },
  {
    icon: "🔬",
    title: "Reproducibility package",
    description: "Scripts, seeds, and instructions to reproduce all reported statistics",
    href: "#",
    available: false,
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatValue({ value }: { value: number | null }) {
  if (value === null) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Pending — V1 calibration in progress
      </p>
    );
  }
  return (
    <p className="font-mono text-2xl font-bold text-foreground">
      {value.toFixed(3)}
    </p>
  );
}

function LiveStats({ stats }: { stats: CalibrationStats | null }) {
  const metrics = [
    { label: "Cohen's κ", key: "cohen_kappa" as const, description: "Human–LLM pairwise agreement" },
    { label: "Krippendorff's α", key: "krippendorff_alpha" as const, description: "Multi-rater reliability" },
    { label: "Intraclass Correlation (ICC)", key: "icc" as const, description: "Consistency across graders" },
    { label: "Spearman ρ", key: "test_retest_correlation" as const, description: "vs. calibration ground truth" },
    { label: "Test-retest reliability", key: "calibration_drift" as const, description: "Score stability over time" },
  ];

  return (
    <section aria-labelledby="stats-heading" className="mb-16">
      <h2 id="stats-heading" className="mb-1 text-xl font-semibold text-foreground">
        Live Methodology Stats
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Reliability metrics computed nightly from evaluation runs against our calibrated ground truth set.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map(({ label, key, description }) => (
          <Card key={key} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <StatValue value={stats?.[key] ?? null} />
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        These numbers are updated nightly from the latest evaluation runs against our calibrated ground truth set.
        {stats?.last_computed && (
          <span className="ml-1">
            Last computed: {new Date(stats.last_computed).toLocaleDateString()}.
          </span>
        )}
      </p>
    </section>
  );
}

function TheoreticalFramework() {
  return (
    <section aria-labelledby="framework-heading" className="mb-16">
      <h2 id="framework-heading" className="mb-1 text-xl font-semibold text-foreground">
        Theoretical Foundation
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        The 8 quality axes are derived deductively from 6 scientific frameworks across cognitive science, decision theory, organizational psychology, linguistics, and metacognition.
      </p>

      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FRAMEWORKS.map((fw) => (
          <Card key={fw.name}>
            <CardHeader>
              <CardTitle>{fw.name}</CardTitle>
              <CardDescription>{fw.citation}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{fw.summary}</p>
              <div className="flex flex-wrap gap-1.5">
                {fw.axes.map((axis) => (
                  <Badge key={axis} variant="secondary">
                    {axis}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Axes summary table */}
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-8 px-4 py-3 text-left text-xs font-medium text-muted-foreground">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Axis</th>
              <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">Framework</th>
              <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">Description</th>
            </tr>
          </thead>
          <tbody>
            {AXES.map((axis, i) => (
              <tr
                key={axis.name}
                className="border-b border-border/50 last:border-0"
              >
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="px-4 py-3 font-medium">{axis.name}</td>
                <td className="hidden px-4 py-3 text-muted-foreground sm:table-cell">
                  <Badge variant="outline">{axis.framework}</Badge>
                </td>
                <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                  {axis.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OpenResources() {
  return (
    <section aria-labelledby="resources-heading" className="mb-16">
      <h2 id="resources-heading" className="mb-1 text-xl font-semibold text-foreground">
        Open Resources
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        HEAR is designed to be open and reproducible. All methodology artifacts are published as they become available.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {OPEN_RESOURCES.map((resource) => (
          <Card key={resource.title}>
            <CardHeader>
              <div className="mb-1 text-2xl" aria-hidden="true">{resource.icon}</div>
              <CardTitle className="flex items-center gap-2">
                {resource.title}
                {!resource.available && (
                  <Badge variant="outline" className="text-xs">
                    Coming soon
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>{resource.description}</CardDescription>
            </CardHeader>
            <CardContent>
              {resource.available ? (
                <a
                  href={resource.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground transition-colors"
                >
                  View on GitHub
                </a>
              ) : (
                <span className="text-sm text-muted-foreground italic">
                  Not yet published
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function KnownLimitations() {
  return (
    <section aria-labelledby="limitations-heading" className="mb-16">
      <h2 id="limitations-heading" className="mb-1 text-xl font-semibold text-foreground">
        Known V1 Limitations
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Scientific honesty requires disclosing current limitations. These are intentional V1 trade-offs, not oversights.
      </p>

      <Card>
        <CardContent className="pt-4">
          <ul className="space-y-2">
            {LIMITATIONS.map((limitation, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">—</span>
                <span className="text-foreground">{limitation}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted-foreground">
            V2 will address all of these. See the{" "}
            <a
              href="#"
              className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground transition-colors"
            >
              roadmap
            </a>
            .
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

export function ResearchContent() {
  const [stats, setStats] = useState<CalibrationStats | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/research/calibration-stats`)
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<CalibrationStats>;
      })
      .then(setStats)
      .catch(() => {
        // On error, keep stats as null — the page renders gracefully with "Pending" state
      });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <NavBar />

      <main className="mx-auto max-w-5xl px-6 py-16" aria-label="HEAR Research">
        {/* Section 1 — Hero header */}
        <header className="mb-16 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            HEAR
          </h1>
          <p className="mt-2 text-lg font-medium text-foreground/80">
            Hive Evaluation Architecture for Reasoning
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
            The methodology behind agent quality scores — a calibrated, multi-judge, theoretically grounded evaluation framework for LLM agents in collaborative environments.
          </p>
        </header>

        {/* Section 2 — Live Methodology Stats */}
        <LiveStats stats={stats} />

        {/* Section 3 — Theoretical Framework */}
        <TheoreticalFramework />

        {/* Section 4 — Open Resources */}
        <OpenResources />

        {/* Section 5 — Known Limitations */}
        <KnownLimitations />
      </main>
    </div>
  );
}
