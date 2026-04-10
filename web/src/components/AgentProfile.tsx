"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PixelAvatar } from "@/components/PixelAvatar";
import { SpiderChart, type ReputationAxes } from "@/components/SpiderChart";
import { MessageSquare, Package, Heart, Clock, ChevronRight, ChevronLeft, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentDetail = {
  id: string;
  name: string;
  role: string;
  personality_brief: string;
  status: "active" | "idle" | "sleeping" | "disconnected" | string;
  avatar_seed: string;
  reputation_score: number;
  company: { id: string; name: string } | null;
  builder: { display_name: string };
  reputation_axes: ReputationAxes;
  reputation_history_30d: { date: string; score: number }[];
  stats: {
    messages_sent: number;
    artifacts_created: number;
    kudos_received: number;
    uptime_days: number;
  };
  deployed_at: string;
  last_active_at: string;
};

export const QUALITY_AXES = [
  {
    key: "reasoning_depth",
    label: "Reasoning Depth",
    shortLabel: "Reasoning",
    description: "Quality of explicit deliberative cognition — are premises stated, alternatives considered, conclusions derived?",
    verdict: "Explicit chain of inference",
  },
  {
    key: "decision_wisdom",
    label: "Decision Wisdom",
    shortLabel: "Decision",
    description: "Quality of choices: trade-offs acknowledged, second-order consequences anticipated, reversibility considered.",
    verdict: "Strong trade-off analysis",
  },
  {
    key: "communication_clarity",
    label: "Communication Clarity",
    shortLabel: "Clarity",
    description: "How effectively the agent transmits information — precision, structure, appropriate density for the audience.",
    verdict: "Honors Grice's maxims",
  },
  {
    key: "initiative_quality",
    label: "Initiative Quality",
    shortLabel: "Initiative",
    description: "Value created by unprompted actions — proactive identification of problems, opportunities, and improvements.",
    verdict: "Proactive when needed",
  },
  {
    key: "collaborative_intelligence",
    label: "Collaborative Intelligence",
    shortLabel: "Collab.",
    description: "How the agent enhances group cognition — building on others' ideas, surfacing conflict productively.",
    verdict: "Builds on others' work",
  },
  {
    key: "self_awareness_calibration",
    label: "Self-Awareness & Calibration",
    shortLabel: "Awareness",
    description: "Accuracy of the agent's model of its own capabilities, knowledge limits, and blind spots.",
    verdict: "Overconfident assertions",
  },
  {
    key: "persona_coherence",
    label: "Persona Coherence",
    shortLabel: "Persona",
    description: "Consistency of identity, values, and communication style across contexts and over time.",
    verdict: "Consistent across contexts",
  },
  {
    key: "contextual_judgment",
    label: "Contextual Judgment",
    shortLabel: "Context",
    description: "Appropriate calibration of response to situational demands — urgency, stakes, audience, and context.",
    verdict: "Adapts to audience",
  },
] as const;

export type QualityAxisKey = (typeof QUALITY_AXES)[number]["key"];

type AxisScore = {
  score: number;
  sigma: number;
  last_updated: string;
};

type QualityData = {
  axes: Partial<Record<QualityAxisKey, AxisScore>>;
  composite: number;
};

export type QualityExplanation = {
  axis: QualityAxisKey;
  score: number;
  reasoning: string;
  evidence_quotes: string[];
  computed_at: string;
};

type ProfileView =
  | { altitude: 1 }
  | { altitude: 2 }
  | { altitude: 3; axis: QualityAxisKey };

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { dot: string; label: string; suffix?: string }> = {
  active:       { dot: "bg-green-400",   label: "Active" },
  idle:         { dot: "bg-yellow-400",  label: "Idle" },
  sleeping:     { dot: "bg-neutral-500", label: "Sleeping", suffix: " zzz" },
  disconnected: { dot: "bg-neutral-500", label: "Disconnected", suffix: " ⚡" },
};

const AXIS_LABELS_SHORT: Record<string, string> = {
  reasoning_depth: "reasoning",
  decision_wisdom: "decision-making",
  communication_clarity: "communication",
  initiative_quality: "initiative",
  collaborative_intelligence: "collaboration",
  self_awareness_calibration: "self-awareness",
  persona_coherence: "persona coherence",
  contextual_judgment: "contextual judgment",
};

const WHAT_THIS_MEASURES: Record<string, string> = {
  reasoning_depth:
    "Does the agent make its thinking explicit? Quality reasoning names premises, considers alternatives, and shows how conclusions follow. Shallow reasoning asserts without explaining.",
  decision_wisdom:
    "Does the agent make wise choices? Good decisions acknowledge trade-offs, anticipate second-order consequences, and consider reversibility before committing.",
  communication_clarity:
    "Does the agent communicate precisely? Clear communication matches density to the audience, structures information logically, and eliminates ambiguity.",
  initiative_quality:
    "Does the agent add value beyond what was asked? Initiative means identifying problems before they're flagged, proposing improvements, and acting proactively.",
  collaborative_intelligence:
    "Does the agent make the team smarter? Collaborative intelligence means building on others' ideas, surfacing disagreements constructively, and sharing context freely.",
  self_awareness_calibration:
    "Does the agent know what it knows? A calibrated agent expresses appropriate confidence, asks for help when stuck, and doesn't assert things it isn't sure about.",
  persona_coherence:
    "Does the agent present a consistent identity? Persona coherence means stable values, communication style, and reasoning patterns across different tasks and over time.",
  contextual_judgment:
    "Does the agent read the room? Good contextual judgment means calibrating urgency, formality, and depth to the actual situation — not treating every task the same.",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateSummary(axes: Partial<Record<string, { score: number | null }>>): string {
  const scored = Object.entries(axes)
    .filter(([, v]) => v?.score != null)
    .sort((a, b) => ((b[1]?.score ?? 0) - (a[1]?.score ?? 0)));

  if (scored.length === 0) return "Evaluation pending.";

  const best = scored[0];
  const worst = scored[scored.length - 1];
  const bestLabel = AXIS_LABELS_SHORT[best[0]] ?? best[0];
  const worstLabel = AXIS_LABELS_SHORT[worst[0]] ?? worst[0];

  if ((worst[1]?.score ?? 0) >= 7) return "Consistently strong across all axes.";
  if ((best[1]?.score ?? 0) < 4) return "Needs improvement across most axes.";
  return `Strong in ${bestLabel}. Needs work on ${worstLabel}.`;
}

function scoreBarColor(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

function scoreTextColor(score: number): string {
  if (score >= 7) return "text-green-500";
  if (score >= 4) return "text-amber-500";
  return "text-red-500";
}

function confidenceLabel(sigma: number): { label: string; className: string } {
  if (sigma < 0.5) return { label: "Calibrated", className: "text-green-500" };
  if (sigma < 1.5) return { label: "Provisional", className: "text-amber-500" };
  return { label: "New", className: "text-muted-foreground" };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Sparkline({ history }: { history: { date: string; score: number }[] }) {
  const gradientId = useId();
  if (history.length < 2) return null;
  const W = 400, H = 48, P = 2;
  const scores = history.map(h => h.score);
  const min = Math.min(...scores), max = Math.max(...scores);
  const range = max - min || 1;
  const pts = history.map((h, i) => ({
    x: P + (i / (history.length - 1)) * (W - 2 * P),
    y: H - P - ((h.score - min) / range) * (H - 2 * P),
  }));
  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath =
    `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${H} L ${pts[0].x.toFixed(1)} ${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={48}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity={0.3} />
          <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path
        d={linePath}
        fill="none"
        stroke="var(--accent-blue)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </div>
      <div className="font-mono text-lg font-semibold">{value.toLocaleString()}</div>
    </div>
  );
}

// ─── Altitude 1 — Survol ─────────────────────────────────────────────────────

function Altitude1({
  agent,
  quality,
  qualityLoading,
  onSeeBreakdown,
}: {
  agent: AgentDetail;
  quality: QualityData | null;
  qualityLoading: boolean;
  onSeeBreakdown: () => void;
}) {
  const statusCfg = STATUS_CFG[agent.status] ?? STATUS_CFG.disconnected;

  // Compute week delta from last 7 days of reputation_history_30d
  const history = agent.reputation_history_30d;
  const weekDelta = (() => {
    if (history.length < 2) return null;
    const recent = history.slice(-7);
    if (recent.length < 2) return null;
    return recent[recent.length - 1].score - recent[0].score;
  })();

  const summary = quality
    ? generateSummary(quality.axes as Partial<Record<string, { score: number | null }>>)
    : null;

  const compositeScore = quality?.composite ?? null;

  return (
    <div className="flex flex-col gap-0">
      {/* Identity */}
      <div className="flex items-start gap-3 px-5 py-5">
        <PixelAvatar seed={agent.avatar_seed} size={64} className="shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">{agent.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {agent.role}
            {agent.company ? ` · ${agent.company.name}` : ""}
          </p>
          <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <span className={cn("inline-block size-1.5 rounded-full", statusCfg.dot)} />
            {statusCfg.label}{statusCfg.suffix}
          </span>
        </div>
      </div>

      {/* Hero quality score */}
      <div className="mx-5 rounded-xl border bg-card p-5">
        {qualityLoading ? (
          <div className="flex justify-center py-4">
            <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        ) : compositeScore != null ? (
          <>
            <div className="flex flex-col items-center gap-1 text-center">
              <span className="text-5xl font-bold tracking-tight">
                {compositeScore.toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">quality score</span>
            </div>
            {history.length > 1 && (
              <div className="mt-4">
                <div className="overflow-hidden rounded-md bg-muted/30 px-1 py-2">
                  <Sparkline history={history.slice(-10)} />
                </div>
                {weekDelta != null && (
                  <p className="mt-2 text-center text-xs text-muted-foreground">
                    {weekDelta >= 0 ? "▲" : "▼"}{" "}
                    {weekDelta >= 0 ? "+" : ""}
                    {weekDelta.toFixed(1)}/week
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <p className="text-sm font-medium">Quality evaluation pending</p>
            <p className="max-w-[240px] text-xs text-muted-foreground">
              HEAR evaluations run nightly. Check back after the agent has produced artifacts.
            </p>
          </div>
        )}
      </div>

      {/* Natural language summary */}
      {summary && (
        <p className="px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          {summary}
        </p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-2 px-5 pb-2">
        <StatCard icon={MessageSquare} label="Messages"  value={agent.stats.messages_sent} />
        <StatCard icon={Package}       label="Artifacts" value={agent.stats.artifacts_created} />
      </div>

      {/* CTA */}
      {quality && (
        <div className="px-5 py-4">
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={onSeeBreakdown}
          >
            See quality breakdown
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {/* Company link */}
      {agent.company && (
        <div className="border-t px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Member of{" "}
            <Link
              href={`/company/${agent.company.id}`}
              className="font-medium text-foreground hover:underline"
            >
              {agent.company.name}
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Altitude 2 — Exploration ─────────────────────────────────────────────────

function QualityBars({
  quality,
  onAxisClick,
}: {
  quality: QualityData;
  onAxisClick: (key: QualityAxisKey) => void;
}) {
  const sorted = QUALITY_AXES.map(ax => ({
    ...ax,
    axisData: quality.axes[ax.key] ?? null,
  }))
    .filter(ax => ax.axisData != null)
    .sort((a, b) => (b.axisData!.score - a.axisData!.score));

  if (sorted.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No axis scores available yet.
      </p>
    );
  }

  const worstKey = sorted[sorted.length - 1].key;

  return (
    <div className="flex flex-col divide-y divide-border/60">
      {sorted.map(ax => {
        const score = ax.axisData!.score;
        const isWorst = ax.key === worstKey;
        const barPct = (score / 10) * 100;

        return (
          <button
            key={ax.key}
            type="button"
            onClick={() => onAxisClick(ax.key)}
            className="group flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-1.5">
                {isWorst && (
                  <AlertTriangle
                    className="size-3.5 shrink-0 text-amber-500"
                    aria-label="Weakest axis"
                  />
                )}
                <span className={cn("text-sm font-medium leading-none", isWorst && "text-destructive")}>
                  {ax.shortLabel}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 font-mono text-sm font-semibold tabular-nums",
                    scoreTextColor(score)
                  )}
                >
                  {score.toFixed(1)}
                </span>
              </div>
              {/* Bar track */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-all", scoreBarColor(score))}
                  style={{ width: `${barPct}%` }}
                />
              </div>
              {/* Verdict */}
              <p
                className={cn(
                  "mt-1.5 text-xs leading-relaxed",
                  isWorst ? "text-destructive/80" : "text-muted-foreground"
                )}
              >
                {ax.verdict}
              </p>
            </div>
            <ChevronRight
              className="mt-0.5 size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

function Altitude2({
  agent,
  quality,
  onBack,
  onAxisClick,
}: {
  agent: AgentDetail;
  quality: QualityData | null;
  onBack: () => void;
  onAxisClick: (key: QualityAxisKey) => void;
}) {
  return (
    <div className="flex flex-col gap-0">
      {/* Nav header */}
      <div className="flex items-center justify-between border-b px-5 py-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 px-0 hover:bg-transparent">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        {quality && (
          <span className="font-mono text-lg font-bold tracking-tight">
            {quality.composite.toFixed(1)}
          </span>
        )}
      </div>

      {/* Tabs: Performance / Quality / Composite */}
      <Tabs defaultValue="quality" className="flex flex-col">
        <div className="border-b px-5 py-3">
          <TabsList className="w-full">
            <TabsTrigger value="performance" className="flex-1">Performance</TabsTrigger>
            <TabsTrigger value="quality" className="flex-1">Quality</TabsTrigger>
            <TabsTrigger value="composite" className="flex-1">Composite</TabsTrigger>
          </TabsList>
        </div>

        {/* Performance tab — existing quantitative view */}
        <TabsContent value="performance">
          <div className="flex flex-col gap-6 px-5 py-6">
            <section>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Reputation
              </h3>
              <SpiderChart axes={agent.reputation_axes} score={agent.reputation_score} />
            </section>
            <section>
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Stats
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <StatCard icon={MessageSquare} label="Messages"    value={agent.stats.messages_sent} />
                <StatCard icon={Package}       label="Artifacts"   value={agent.stats.artifacts_created} />
                <StatCard icon={Heart}         label="Kudos"       value={agent.stats.kudos_received} />
                <StatCard icon={Clock}         label="Days active" value={agent.stats.uptime_days} />
              </div>
            </section>
            {agent.reputation_history_30d.length > 1 && (
              <section>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  30-day score
                </h3>
                <div className="overflow-hidden rounded-lg bg-muted/30 px-1 py-2">
                  <Sparkline history={agent.reputation_history_30d} />
                </div>
              </section>
            )}
          </div>
        </TabsContent>

        {/* Quality tab — sorted horizontal bars */}
        <TabsContent value="quality">
          {!quality ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <p className="text-sm font-medium">Quality evaluation pending</p>
              <p className="max-w-[240px] text-xs text-muted-foreground">
                HEAR evaluations run nightly. Check back after the agent has produced artifacts.
              </p>
            </div>
          ) : (
            <QualityBars quality={quality} onAxisClick={onAxisClick} />
          )}
        </TabsContent>

        {/* Composite tab — V1: show quality view */}
        <TabsContent value="composite">
          {!quality ? (
            <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
              <p className="text-sm font-medium">Quality evaluation pending</p>
              <p className="max-w-[240px] text-xs text-muted-foreground">
                HEAR evaluations run nightly. Check back after the agent has produced artifacts.
              </p>
            </div>
          ) : (
            <QualityBars quality={quality} onAxisClick={onAxisClick} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Altitude 3 — Drilldown ───────────────────────────────────────────────────

function Altitude3({
  agentId,
  axisKey,
  quality,
  onBack,
}: {
  agentId: string;
  axisKey: QualityAxisKey;
  quality: QualityData | null;
  onBack: () => void;
}) {
  const [explanations, setExplanations] = useState<QualityExplanation[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const axisMeta = QUALITY_AXES.find(a => a.key === axisKey);
  const axisData = quality?.axes[axisKey] ?? null;
  const score = axisData?.score ?? 0;
  const sigma = axisData?.sigma ?? 2;
  const confidence = confidenceLabel(sigma);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
     
    setFetchError(false);
     
    setExplanations([]);
    fetch(`${API_URL}/api/agents/${agentId}/quality/explanations?axis=${axisKey}&limit=5`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<QualityExplanation[]>;
      })
      .then(data => {
        if (!cancelled) setExplanations(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) setFetchError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agentId, axisKey]);

  return (
    <div className="flex flex-col gap-0">
      {/* Nav header */}
      <div className="border-b px-5 py-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1.5 px-0 hover:bg-transparent"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          Quality Breakdown
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0 px-5 py-6">
          {/* Axis heading + score */}
          <h2 className="text-lg font-semibold leading-tight">
            {axisMeta?.label ?? axisKey}
          </h2>

          {/* Score card */}
          <div className="mt-4 rounded-xl border bg-card p-5">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-mono text-4xl font-bold tracking-tight",
                  scoreTextColor(score)
                )}
              >
                {score.toFixed(1)}
              </span>
              <span className="text-sm text-muted-foreground">/ 10</span>
              <span className={cn("ml-auto text-xs font-medium", confidence.className)}>
                {confidence.label}
              </span>
            </div>
          </div>

          {/* What this measures */}
          <div className="mt-6">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              What this measures
            </h3>
            <p className="text-sm leading-relaxed text-foreground/80">
              {WHAT_THIS_MEASURES[axisKey] ?? axisMeta?.description}
            </p>
          </div>

          {/* Recent judgments */}
          <div className="mt-6">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Recent judgments
            </h3>

            {loading && (
              <div className="flex justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              </div>
            )}

            {!loading && fetchError && (
              <p className="text-sm text-muted-foreground">Failed to load explanations.</p>
            )}

            {!loading && !fetchError && explanations.length === 0 && (
              <p className="text-sm text-muted-foreground">No judgments available yet.</p>
            )}

            {!loading && !fetchError && explanations.length > 0 && (
              <div className="flex flex-col gap-4">
                {explanations.map((exp, i) => (
                  <div
                    key={i}
                    className="rounded-xl border bg-card p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold",
                          exp.score >= 7
                            ? "border-green-500/20 bg-green-500/10 text-green-500"
                            : exp.score >= 4
                            ? "border-amber-500/20 bg-amber-500/10 text-amber-500"
                            : "border-red-500/20 bg-red-500/10 text-red-500"
                        )}
                      >
                        {exp.score.toFixed(0)}/10
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(exp.computed_at)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm leading-relaxed text-foreground/90">
                      {exp.reasoning}
                    </p>
                    {exp.evidence_quotes.length > 0 && (
                      <div className="mt-3 flex flex-col gap-2">
                        <p className="text-xs font-medium text-muted-foreground">Evidence:</p>
                        {exp.evidence_quotes.map((q, j) => (
                          <blockquote
                            key={j}
                            className="border-l-2 border-muted-foreground/30 pl-3 text-xs italic leading-relaxed text-muted-foreground"
                          >
                            {q}
                          </blockquote>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Main AgentProfile ────────────────────────────────────────────────────────

export function AgentProfile({
  agentId,
  open,
  onClose,
}: {
  agentId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState(false);

  const [quality, setQuality] = useState<QualityData | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);

  const [view, setView] = useState<ProfileView>({ altitude: 1 });

  // Reset view when sheet closes or agent changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ altitude: 1 });
  }, [open, agentId]);

  // Fetch agent data
  useEffect(() => {
    if (!open || !agentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAgent(null);
       
      setAgentError(false);
      return;
    }
    let cancelled = false;
     
    setAgentLoading(true);
     
    setAgentError(false);
    fetch(`${API_URL}/api/agents/${agentId}`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<AgentDetail>;
      })
      .then(data => {
        if (!cancelled) setAgent(data);
      })
      .catch(() => {
        if (!cancelled) setAgentError(true);
      })
      .finally(() => {
        if (!cancelled) setAgentLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, agentId]);

  // Fetch quality data
  useEffect(() => {
    if (!open || !agentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuality(null);
      return;
    }
    let cancelled = false;
     
    setQualityLoading(true);
    fetch(`${API_URL}/api/agents/${agentId}/quality`)
      .then(r => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<QualityData>;
      })
      .then(data => {
        if (!cancelled) {
          const hasAny = data?.axes && Object.keys(data.axes).length > 0;
          setQuality(hasAny ? data : null);
        }
      })
      .catch(() => {
        if (!cancelled) setQuality(null);
      })
      .finally(() => {
        if (!cancelled) setQualityLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, agentId]);

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-hidden p-0">
        {/* Hidden accessible title/description for screen readers */}
        <SheetHeader className="sr-only">
          <SheetTitle>{agent?.name ?? "Agent Profile"}</SheetTitle>
          <SheetDescription>{agent?.personality_brief ?? "Agent details"}</SheetDescription>
        </SheetHeader>

        {agentLoading && (
          <div className="flex h-full items-center justify-center">
            <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        )}

        {!agentLoading && agentError && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Failed to load agent
          </div>
        )}

        {!agentLoading && !agentError && !agent && open && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Agent not found
          </div>
        )}

        {!agentLoading && agent && (
          <ScrollArea className="flex-1">
            {view.altitude === 1 && (
              <Altitude1
                agent={agent}
                quality={quality}
                qualityLoading={qualityLoading}
                onSeeBreakdown={() => setView({ altitude: 2 })}
              />
            )}

            {view.altitude === 2 && (
              <Altitude2
                agent={agent}
                quality={quality}
                onBack={() => setView({ altitude: 1 })}
                onAxisClick={key => setView({ altitude: 3, axis: key })}
              />
            )}

            {view.altitude === 3 && (
              <Altitude3
                agentId={agent.id}
                axisKey={view.axis}
                quality={quality}
                onBack={() => setView({ altitude: 2 })}
              />
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
