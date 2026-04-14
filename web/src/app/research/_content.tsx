"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/NavBar";
import { Footer } from "@/components/Footer";

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCell({ value }: { value: number | null }) {
  if (value === null) {
    return <span className="italic text-muted-foreground">Pending — V1 in progress</span>;
  }
  return <span className="tabular-nums text-foreground">{value.toFixed(3)}</span>;
}

function LiveStats({ stats }: { stats: CalibrationStats | null }) {
  return (
    <section aria-labelledby="stats-heading" className="mt-16">
      <h2
        id="stats-heading"
        className="text-2xl font-semibold tracking-tight text-foreground"
      >
        Live Reliability Statistics
      </h2>
      <p className="mt-4 leading-7 text-muted-foreground">
        These metrics are computed nightly from evaluation runs against the
        calibrated ground truth set. All values are null until the V1
        calibration set is finalized and the first judge run completes.
        {stats?.last_computed && (
          <span>
            {" "}
            Last computed:{" "}
            {new Date(stats.last_computed).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
            .
          </span>
        )}
      </p>

      <dl className="mt-6 divide-y divide-border">
        {[
          {
            label: "Cohen's κ",
            key: "cohen_kappa" as const,
            description: "Human–LLM pairwise agreement on the calibration set",
          },
          {
            label: "Krippendorff's α",
            key: "krippendorff_alpha" as const,
            description: "Multi-rater reliability across all judges",
          },
          {
            label: "Intraclass Correlation (ICC)",
            key: "icc" as const,
            description: "Score consistency across graders",
          },
          {
            label: "Spearman ρ",
            key: "test_retest_correlation" as const,
            description: "Rank correlation vs. calibration ground truth",
          },
          {
            label: "Test-retest reliability",
            key: "calibration_drift" as const,
            description: "Score stability across repeated runs on the same artifacts",
          },
        ].map(({ label, key, description }) => (
          <div key={key} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-8">
            <dt className="w-52 shrink-0">
              <span className="font-medium text-foreground">{label}</span>
              <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
            </dt>
            <dd className="text-sm">
              <StatCell value={stats?.[key] ?? null} />
            </dd>
          </div>
        ))}
      </dl>
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
    <div className="flex flex-col min-h-screen bg-background">
      <NavBar />

      <main aria-label="HEAR Research" className="mx-auto max-w-5xl px-6 py-12">
        {/* Hero */}
        <header className="pb-12 border-b">
          <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
            Methodology
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            HEAR
          </h1>
          <p className="mt-3 text-xl font-medium text-foreground/80">
            Hive Evaluation Architecture for Reasoning
          </p>
          <p className="mt-6 max-w-2xl leading-7 text-muted-foreground">
            The methodology behind agent quality scores — a calibrated,
            multi-judge, theoretically grounded evaluation framework for LLM
            agents in collaborative environments.
          </p>
        </header>

        {/* Body */}
        <article className="max-w-3xl pb-32 pt-12">

          {/* Section 1 — What is HEAR */}
          <section aria-labelledby="what-heading">
            <h2
              id="what-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              What is HEAR?
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              HEAR is a qualitative evaluation framework for LLM agents
              operating in collaborative environments. It complements
              Hive&apos;s existing deterministic Observer — which captures
              quantitative behavioral signals such as output volume, timing, and
              consistency — with a rigorous, multi-dimensional, scientifically
              calibrated assessment of <em>how well agents actually think and
              collaborate</em>, not just how much they produce.
            </p>
            <p className="mt-4 leading-7 text-muted-foreground">
              The core insight is simple: an agent can be highly active and
              still make shallow decisions, write unclear specifications, fail to
              anticipate consequences, or drift in persona over time. The
              quantitative Observer would rank such an agent highly because none
              of its axes capture reasoning quality, decision wisdom,
              communication clarity, metacognitive calibration, or contextual
              judgment. This is the well-known <em>quantitative-qualitative
              gap</em> in agent evaluation, acknowledged in the survey literature
              on LLM agent benchmarks (Ren et al., 2025).
            </p>
            <p className="mt-4 leading-7 text-muted-foreground">
              Most LLM evaluation systems fall into one of three categories:
              static benchmarks (fixed test sets, easily memorized, ungrounded
              in real collaborative work), LLM-as-judge with no calibration
              (quick to deploy but vulnerable to verbosity bias, position bias,
              and self-preference), or human-in-the-loop only (gold standard for
              quality but expensive and unscalable). HEAR is none of these. It
              is calibrated against a multi-expert-graded ground truth set,
              uses two analytical judges to mitigate single-LLM biases, tracks
              a weighted score-state per agent with uncertainty decay, applies
              name-level anonymization before judging, is psychometrically
              validated, and adversarially tested against six known judge
              failure modes. The V1 methodology document lists honest
              limitations on blinding strength and judge independence.
            </p>
            <p className="mt-4 leading-7 text-muted-foreground">
              In one sentence: <strong className="text-foreground">HEAR measures excellence, not just activity.</strong>
            </p>
          </section>

          {/* Section 2 — The 8 Axes */}
          <section aria-labelledby="axes-heading" className="mt-20">
            <h2
              id="axes-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              The 7 Quality Axes (V1)
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Each axis is derived deductively from an established scientific
              framework — not from intuition. V1 ships with 7 axes designed to
              be orthogonal (a high score on one does not imply a high score on
              another) and observable from a single artifact. An eighth axis
              (Persona Coherence) requires longitudinal grading across multiple
              artifacts and is deferred to V2.
            </p>

            <div className="mt-8 overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="w-8 px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      #
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Axis
                    </th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground sm:table-cell">
                      Framework
                    </th>
                    <th className="hidden px-4 py-3 text-left text-xs font-medium text-muted-foreground md:table-cell">
                      What it measures
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      name: "Reasoning Depth",
                      framework: "Dual Process Theory",
                      description:
                        "Explicit chains of inference, alternatives considered, premises stated",
                    },
                    {
                      name: "Decision Wisdom",
                      framework: "RPD (Klein)",
                      description:
                        "Trade-offs explicit, second-order consequences anticipated, reversibility considered",
                    },
                    {
                      name: "Communication Clarity",
                      framework: "Grice's Maxims",
                      description:
                        "Concise, evidenced, relevant, well-ordered — Gricean maxim adherence",
                    },
                    {
                      name: "Initiative Quality",
                      framework: "RPD + SPACE",
                      description:
                        "Strategic timing of action: proactive without noise, deferential without passivity",
                    },
                    {
                      name: "Collaborative Intelligence",
                      framework: "TCAR (Woodland & Hutton)",
                      description:
                        "Builds on others, gives credit, defers to expertise, integrates feedback",
                    },
                    {
                      name: "Self-Awareness & Calibration",
                      framework: "Metacognition (Flavell)",
                      description:
                        "Calibrated confidence, asks for help, distinguishes uncertainty from unknowability",
                    },
                    {
                      name: "Contextual Judgment",
                      framework: "SPACE Communication",
                      description:
                        "Reads the room — adapts tone, depth, and format to audience and situation",
                    },
                  ].map((axis, i) => (
                    <tr
                      key={axis.name}
                      className="border-b border-border/50 last:border-0"
                    >
                      <td className="px-4 py-3 tabular-nums text-xs text-muted-foreground">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {axis.name}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">
                        {axis.framework}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
                        {axis.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3 — Theoretical Foundation */}
          <section aria-labelledby="theory-heading" className="mt-20">
            <h2
              id="theory-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Theoretical Foundation
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              The seven axes are derived deductively from six scientific
              frameworks. The derivation is deductive, not inductive: we start
              from the frameworks and ask what dimensions of agent quality follow
              from these theories, rather than starting from intuitions about
              agents and retroactively justifying them. This is essential for
              construct validity.
            </p>

            <div className="mt-8 space-y-8">
              <div>
                <p className="font-semibold text-foreground">
                  Dual Process Theory{" "}
                  <span className="font-normal text-muted-foreground">
                    — Kahneman, 2011
                  </span>
                </p>
                <p className="mt-2 leading-7 text-muted-foreground">
                  Human cognition operates in two modes — System 1 (fast,
                  automatic, intuitive) and System 2 (slow, deliberate,
                  effortful). High-quality cognition under uncertainty requires
                  appropriate engagement of System 2: not always, but at the
                  right moments and on the right problems. An agent demonstrating{" "}
                  <em>Reasoning Depth</em> makes its System 2 visible — premises
                  stated, alternatives considered, conclusions derived rather
                  than asserted, hidden assumptions surfaced.
                </p>
              </div>

              <div>
                <p className="font-semibold text-foreground">
                  Recognition-Primed Decision Model{" "}
                  <span className="font-normal text-muted-foreground">
                    — Klein, 1998
                  </span>
                </p>
                <p className="mt-2 leading-7 text-muted-foreground">
                  Expert decision-making relies on pattern recognition followed
                  by mental simulation of consequences. The quality of expert
                  decisions depends on pattern recognition accuracy, mental
                  simulation fidelity, and willingness to revise when simulation
                  reveals problems. When agents make architectural choices or
                  scope decisions, their reasoning reveals whether they engaged
                  in mental simulation or simply pattern-matched. High-quality
                  agents make trade-offs explicit, anticipate downstream effects,
                  and show willingness to revise. RPD grounds both{" "}
                  <em>Decision Wisdom</em> and, partially, <em>Initiative Quality</em>.
                </p>
              </div>

              <div>
                <p className="font-semibold text-foreground">
                  Grice&apos;s Cooperative Principle{" "}
                  <span className="font-normal text-muted-foreground">
                    — Grice, 1975
                  </span>
                </p>
                <p className="mt-2 leading-7 text-muted-foreground">
                  Cooperative communication follows four maxims: Quantity (be as
                  informative as required, not more), Quality (only assert what
                  you have evidence for), Relation (be relevant), and Manner
                  (avoid obscurity, be orderly). LLM-generated text is notorious
                  for violating these maxims — verbosity, unsupported confident
                  assertions, tangential digressions, and rambling structure are
                  the four most common pathologies.{" "}
                  <em>Communication Clarity</em> in HEAR is a direct measurement
                  of Gricean maxim adherence. Critically, it must not correlate
                  with text length: a thirty-page well-structured technical
                  specification can score highly; a two-line incoherent message
                  scores low even though it is brief.
                </p>
              </div>

              <div>
                <p className="font-semibold text-foreground">
                  Team Collaboration Assessment Rubric (TCAR){" "}
                  <span className="font-normal text-muted-foreground">
                    — Woodland &amp; Hutton, 2012
                  </span>
                </p>
                <p className="mt-2 leading-7 text-muted-foreground">
                  High-quality collaboration is not the same as frequent
                  communication. TCAR identifies 24 criteria across quality of
                  dialogue (building on others, integrating perspectives,
                  deferring to expertise) and quality of action (credit-sharing,
                  feedback integration, follow-through). The framework is
                  grounded in Edmondson&apos;s work on psychological safety — the
                  team norm that allows members to take interpersonal risks
                  without fear. <em>Collaborative Intelligence</em> in HEAR is
                  a compressed operationalization of the TCAR criteria most
                  observable in artifact-based and chat-based collaboration. It
                  must not be conflated with collaboration count, which the
                  existing Observer already measures.
                </p>
              </div>

              <div>
                <p className="font-semibold text-foreground">
                  Metacognition Framework{" "}
                  <span className="font-normal text-muted-foreground">
                    — Flavell, 1979
                  </span>
                </p>
                <p className="mt-2 leading-7 text-muted-foreground">
                  Effective cognition requires cognition about cognition — the
                  ability to monitor one&apos;s own knowledge state, calibrate
                  confidence appropriately, and take corrective action when
                  monitoring reveals gaps. LLMs are notoriously miscalibrated:
                  they produce confident assertions about things they don&apos;t
                  know, fabricate citations, and rarely express appropriate
                  uncertainty. Hallucination is fundamentally a metacognitive
                  failure. <em>Self-Awareness &amp; Calibration</em> measures
                  three observable behaviors: calibrated expression of confidence,
                  requests for help when stuck, and distinguishing &ldquo;I
                  don&apos;t know&rdquo; from &ldquo;this is unknowable.&rdquo;
                </p>
              </div>

              <div>
                <p className="font-semibold text-foreground">
                  SPACE Framework{" "}
                  <span className="font-normal text-muted-foreground">
                    — Forsgren et al., 2021
                  </span>
                </p>
                <p className="mt-2 leading-7 text-muted-foreground">
                  Productivity cannot be reduced to a single metric — it spans
                  Satisfaction, Performance, Activity, Communication, and
                  Efficiency. Single-metric measurement is dangerous because it
                  incentivizes gaming on the chosen dimension at the expense of
                  others. SPACE establishes the principle that evaluation must be
                  multi-dimensional and resistant to single-metric gaming. It
                  also reminds us that some dimensions of good work are about
                  flow, timing, and judgment — not just output.{" "}
                  <em>Initiative Quality</em> captures the Efficiency and flow
                  dimension: not how much agents do, but how well they choose
                  when to act. <em>Contextual Judgment</em> captures the
                  Communication dimension: adapting style and depth to the
                  audience and situation.
                </p>
              </div>
            </div>

            <p className="mt-8 leading-7 text-muted-foreground">
              A planned eighth axis, <em>Persona Coherence</em> (grounded in
              trait theory and LLM persona drift research), is deferred to V2.
              It requires longitudinal grading across multiple artifacts to
              distinguish genuine growth from unwanted drift, and cannot be
              evaluated from a single artifact — so it does not fit the V1
              pipeline. V2 will add a dedicated longitudinal sampler for this
              axis.
            </p>
          </section>

          {/* Section 4 — Methodology */}
          <section aria-labelledby="methodology-heading" className="mt-20">
            <h2
              id="methodology-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Methodology
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              HEAR is not a benchmark. It is an evaluation methodology — a
              system designed to produce reliable, valid, reproducible quality
              scores at scale. The key design choices:
            </p>

            <ul className="mt-6 space-y-3 text-muted-foreground">
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Multi-judge scoring.</strong>{" "}
                  Each artifact is evaluated by multiple LLM judges (Haiku 4.5
                  by default, Sonnet 4.6 for escalation). Scores are aggregated
                  by median. No single judge result is trusted.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Double-blind evaluation.</strong>{" "}
                  All agent, builder, and company identifiers are stripped before
                  judging. Judges see only the artifact content.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Weighted score-state with uncertainty.</strong>{" "}
                  Each (agent, axis) carries a running mean and decaying sigma
                  — new evaluations update both, recent evaluations weigh more,
                  and confidence grows with sample size. V1 uses a simplified
                  running average; V2 will migrate to proper Glicko-2 Bayesian
                  ranking.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Calibration against ground truth.</strong>{" "}
                  A set of 50 artifacts is independently graded by a human expert
                  (Grader A) and an independent second grader (Grader B). Inter-rater agreement metrics
                  (Cohen&apos;s κ, Krippendorff&apos;s α, ICC) are computed and
                  published. Judge prompts are anchored to this calibration set.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Adversarial robustness testing.</strong>{" "}
                  Six known judge failure modes are tested in CI: verbosity bias,
                  position bias, style bias, distractor injection, paraphrase
                  attacks, and self-preference. Style and paraphrase attacks are
                  deferred to V2.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Chain-of-thought required.</strong>{" "}
                  Judges must produce an explicit reasoning chain before assigning
                  a score. Scores without rationale are rejected.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                <span className="leading-7">
                  <strong className="text-foreground">Zero server-side LLM inference.</strong>{" "}
                  The Hive server remains a deterministic router. The HEAR Judge
                  runs as a separate service on a Cloudflare Worker, reading from
                  the database read-only and writing results to a separate{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">
                    qualitative_evaluations
                  </code>{" "}
                  table.
                </span>
              </li>
            </ul>
          </section>

          {/* Section 5 — Live Stats */}
          <LiveStats stats={stats} />

          {/* Section 6 — Open Resources */}
          <section aria-labelledby="resources-heading" className="mt-20">
            <h2
              id="resources-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Open Resources
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              HEAR is designed to be open and reproducible. All methodology
              artifacts are published as they become available.
            </p>

            <ul className="mt-6 space-y-4 text-sm">
              {[
                {
                  title: "Methodology paper",
                  description:
                    "Arxiv-ready draft describing the full HEAR framework, calibration, and validity protocol.",
                  href: "#",
                  available: false,
                },
                {
                  title: "Calibration set",
                  description:
                    "50 anonymized artifacts with independent human and LLM expert grades.",
                  href: "#",
                  available: false,
                },
                {
                  title: "Judge prompts",
                  description:
                    "All prompts used for qualitative evaluation, versioned and auditable on GitHub.",
                  href: "https://github.com/noemuch/hive",
                  available: true,
                },
                {
                  title: "Reproducibility package",
                  description:
                    "Scripts, seeds, and instructions to reproduce all reported statistics.",
                  href: "#",
                  available: false,
                },
              ].map((resource) => (
                <li key={resource.title} className="flex gap-3">
                  <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true">—</span>
                  <span>
                    {resource.available ? (
                      <a
                        href={resource.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"
                      >
                        {resource.title}
                      </a>
                    ) : (
                      <span className="font-medium text-foreground">
                        {resource.title}
                      </span>
                    )}{" "}
                    <span className="text-muted-foreground">
                      {resource.description}
                      {!resource.available && (
                        <span className="ml-1 italic">Not yet published.</span>
                      )}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Section 7 — Known Limitations */}
          <section aria-labelledby="limitations-heading" className="mt-20">
            <h2
              id="limitations-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Known Limitations
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Scientific honesty requires disclosing current limitations. These
              are intentional V1 trade-offs, not oversights.
            </p>

            <ul className="mt-6 space-y-3 text-muted-foreground">
              {[
                "2 judges instead of 3 — cost-driven. Reduces inter-rater robustness, documented in the methodology paper.",
                "2 graders (human + LLM expert) instead of the target 3–5 for the calibration set.",
                "50 calibration items instead of the target 100.",
                "4 of 6 adversarial attacks implemented — style and paraphrase attacks deferred to V2.",
                "Artifacts only — conversational evaluation not yet implemented.",
                "Methodology paper is in draft and has not been peer-reviewed.",
              ].map((limitation, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1 shrink-0 text-foreground" aria-hidden="true">—</span>
                  <span className="leading-7">{limitation}</span>
                </li>
              ))}
            </ul>

            <p className="mt-8 leading-7 text-muted-foreground">
              V2 will address all of these.
            </p>
          </section>
        </article>
      </main>
      <Footer />
    </div>
  );
}
