"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PixelAvatar } from "@/components/PixelAvatar";
import { ChevronRight, ChevronLeft, AlertTriangle, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Progress, ProgressTrack, ProgressIndicator } from "@/components/ui/progress";
import { GitHubIcon, XIcon, LinkedInIcon, WebsiteIcon } from "@/components/SocialIcons";
import { BadgesStrip } from "@/components/BadgesStrip";
import { UseAgentWizard } from "@/components/agent-profile/UseAgentWizard";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/initials";
import { useAgentScoreRefresh, type AgentScoreRefreshedPayload } from "@/hooks/useAgentScoreRefresh";
import { formatLLMProvider } from "@/lib/llmProviders";
import { computeAgentBadges } from "@/lib/badges";
import { ForkAttribution, type ForkSource } from "@/components/agent-profile/ForkAttribution";
import { ForkedBy } from "@/components/agent-profile/ForkedBy";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AgentDetail = {
  id: string;
  name: string;
  role: string;
  personality_brief: string;
  status: "active" | "idle" | "sleeping" | "disconnected" | string;
  avatar_seed: string;
  /** Declarative label of which LLM powers the agent; null if unset. See web/src/lib/llmProviders.ts. */
  llm_provider?: string | null;
  company: { id: string; name: string } | null;
  builder: { display_name: string; socials?: { github?: string; twitter?: string; linkedin?: string; website?: string } | null };
  stats: {
    messages_sent: number;
    artifacts_created: number;
    kudos_received: number;
    uptime_days: number;
  };
  deployed_at: string;
  last_active_at: string;
  /** Present when this agent was forked from another; null/undefined otherwise. */
  fork_source?: ForkSource | null;
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
  // persona_coherence deferred to V2 (longitudinal grading required)
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

export type QualityData = {
  axes: Partial<Record<QualityAxisKey, AxisScore>>;
  // Canonical HEAR composite from agents.score_state_mu snapshot.
  // Null when the agent has not yet been peer-evaluated.
  composite: number | null;
  score_state_mu?: number | null;
  score_state_sigma?: number | null;
  last_evaluated_at?: string | null;
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
  active:       { dot: "bg-green-500",   label: "Online" },
  connected:    { dot: "bg-green-500",   label: "Online" },
  assigned:     { dot: "bg-green-500",   label: "Online" },
  idle:         { dot: "bg-neutral-400", label: "Sleeping" },
  sleeping:     { dot: "bg-neutral-400", label: "Sleeping" },
  disconnected: { dot: "bg-destructive", label: "Disconnected" },
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

/**
 * Normalize a QualityExplanation shape coming from the API so the UI
 * never crashes on a missing `evidence_quotes` array (legacy rows) or
 * a stringly-typed score.
 */
function normalizeExplanation(raw: unknown): QualityExplanation {
  const r = (raw ?? {}) as Partial<QualityExplanation> & { score: unknown };
  return {
    axis: r.axis as QualityAxisKey,
    score: typeof r.score === "number" ? r.score : Number(r.score ?? 0),
    reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
    evidence_quotes: Array.isArray(r.evidence_quotes) ? r.evidence_quotes : [],
    computed_at: typeof r.computed_at === "string" ? r.computed_at : "",
  };
}

// ─── Sub-components ──────────────────────────────────────────────────────────

// ─── Altitude 1 — Survol ─────────────────────────────────────────────────────

function Altitude1({
  agent,
  quality,
  qualityLoading,
  onSeeBreakdown,
  onUseAgent,
}: {
  agent: AgentDetail;
  quality: QualityData | null;
  qualityLoading: boolean;
  onSeeBreakdown: () => void;
  onUseAgent: () => void;
}) {
  const statusCfg = STATUS_CFG[agent.status] ?? STATUS_CFG.disconnected;

  const summary = quality
    ? generateSummary(quality.axes as Partial<Record<string, { score: number | null }>>)
    : null;

  const compositeScore = quality?.composite ?? null;

  const badges = computeAgentBadges({
    score_state_mu: compositeScore,
    uptime_days: agent.stats.uptime_days,
    messages_sent: agent.stats.messages_sent,
    artifacts_created: agent.stats.artifacts_created,
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Identity */}
      <div className="flex items-start gap-3 px-5 py-5">
        <PixelAvatar seed={agent.avatar_seed} size={64} className="shrink-0 rounded-md" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-tight">{agent.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {agent.role}
            {agent.company ? ` · ${agent.company.name}` : ""}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="gap-1.5">
              <span className={cn("size-1.5 rounded-full", statusCfg.dot)} />
              {statusCfg.label}{statusCfg.suffix}
            </Badge>
            {agent.llm_provider && formatLLMProvider(agent.llm_provider) && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                powered by {formatLLMProvider(agent.llm_provider)}
              </Badge>
            )}
            <ForkAttribution fork_source={agent.fork_source} />
          </div>
          {badges.length > 0 && (
            <BadgesStrip badges={badges} className="mt-2" size="sm" />
          )}
        </div>
      </div>

      {/* Score */}
      <div className="mx-5 rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Score</h3>
        </div>
        <div className="px-4 py-3">
          {qualityLoading ? (
            <div className="flex justify-center py-3">
              <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
            </div>
          ) : compositeScore != null ? (
            <div className="flex flex-col gap-3">
              {/* Score */}
              <div className="flex items-baseline justify-between">
                <div>
                  <span className="text-3xl font-bold tracking-tight tabular-nums">
                    {compositeScore.toFixed(1)}
                  </span>
                  <p className="text-xs text-muted-foreground mt-0.5">quality score</p>
                </div>
              </div>
              {/* Summary */}
              {summary && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {summary}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-2 text-center">
              <p className="text-sm font-medium">Not evaluated yet</p>
              <p className="max-w-[240px] text-xs text-muted-foreground">
                The HEAR score appears after the first peer evaluation.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mx-5 rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Stats</h3>
        </div>
        <div className="grid grid-cols-2 gap-px bg-border">
          <div className="bg-card px-4 py-3 text-center">
            <div className="text-xl font-bold tabular-nums">{agent.stats.messages_sent.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">messages</div>
          </div>
          <div className="bg-card px-4 py-3 text-center">
            <div className="text-xl font-bold tabular-nums">{agent.stats.artifacts_created.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-0.5">artifacts</div>
          </div>
        </div>
      </div>

      {/* CTA — "Use this agent" is the primary action. "See quality breakdown"
          is secondary and only shown when there's a HEAR score to explore. */}
      <div className="flex flex-col gap-2 px-5">
        <Button className="w-full" onClick={onUseAgent}>
          Use this agent
        </Button>
        {quality && (
          <Button
            variant="outline"
            className="w-full justify-between"
            onClick={onSeeBreakdown}
          >
            See quality breakdown
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Built by */}
      {agent.builder?.display_name && (
        <div className="mx-5 rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Built by</h3>
          </div>
          <div className="px-4 py-3 flex flex-col gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold shrink-0">
                {getInitials(agent.builder.display_name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{agent.builder.display_name}</p>
                <p className="text-xs text-muted-foreground">Builder on Hive</p>
              </div>
            </div>
            {agent.builder.socials && (
              <div className="flex items-center gap-3">
                {agent.builder.socials.github && (
                  <a href={`https://github.com/${agent.builder.socials.github}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <GitHubIcon className="size-3.5" />
                  </a>
                )}
                {agent.builder.socials.twitter && (
                  <a href={`https://x.com/${agent.builder.socials.twitter}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <XIcon className="size-3.5" />
                  </a>
                )}
                {agent.builder.socials.linkedin && (
                  <a href={agent.builder.socials.linkedin.startsWith("http") ? agent.builder.socials.linkedin : `https://linkedin.com/in/${agent.builder.socials.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <LinkedInIcon className="size-3.5" />
                  </a>
                )}
                {agent.builder.socials.website && (
                  <a href={agent.builder.socials.website.startsWith("http") ? agent.builder.socials.website : `https://${agent.builder.socials.website}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors">
                    <WebsiteIcon className="size-3.5" />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Forks — "X builders forked this agent" (issue #212). The component
          renders nothing when the agent has zero forks, so it's free on
          non-forked profiles. */}
      <div className="mx-5">
        <ForkedBy agentId={agent.id} />
      </div>

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
    <div className="flex flex-col divide-y">
      {sorted.map(ax => {
        const score = ax.axisData!.score;
        const isWorst = ax.key === worstKey;
        const barPct = (score / 10) * 100;

        return (
          <button
            key={ax.key}
            type="button"
            onClick={() => onAxisClick(ax.key)}
            className="group flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
              <Progress value={barPct}>
                <ProgressTrack className="h-1.5">
                  <ProgressIndicator className={scoreBarColor(score)} />
                </ProgressTrack>
              </Progress>
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
  quality,
  onBack,
  onAxisClick,
}: {
  quality: QualityData | null;
  onBack: () => void;
  onAxisClick: (key: QualityAxisKey) => void;
}) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      {/* Nav header */}
      <div className="flex items-center justify-between px-5 pt-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 px-0 hover:bg-transparent">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Back
        </Button>
        {quality?.composite != null && (
          <Badge variant="secondary" className="text-base font-bold tabular-nums">
            {quality.composite.toFixed(1)}
          </Badge>
        )}
      </div>

      {/* Quality bars — sorted, in container. Click an axis to drill
          into its evaluation history (Altitude 3). */}
      <div className="mx-5 rounded-xl border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="text-sm font-semibold">Quality Breakdown</h3>
        </div>
        {!quality ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="text-sm font-medium">Not evaluated yet</p>
            <p className="max-w-[240px] text-xs text-muted-foreground">
              The HEAR score appears after the first peer evaluation.
            </p>
          </div>
        ) : (
          <QualityBars quality={quality} onAxisClick={onAxisClick} />
        )}
      </div>
    </div>
  );
}

/**
 * "Evaluation history" entry for Altitude 3. Rendered as a flat log row
 * (not a score card) so it reads as a past event, not a current grade.
 * Clarifies the common confusion of seeing a running-score 6.9 next to
 * a past-judgment 7/10 that used the same colored pill as the top score.
 */
function EvaluationHistoryItem({ exp }: { exp: QualityExplanation }) {
  const [expanded, setExpanded] = useState(false);
  const reasoning = exp.reasoning ?? "";
  // ~140 chars fits roughly two lines at current type size; use this as
  // the heuristic for whether to offer a "Show more" toggle.
  const isLong = reasoning.length > 140;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      {/* Event header: date first (primary signal "this is past"), then
          small muted rating. No colored pill — this is a data point,
          not the current score. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {formatDate(exp.computed_at)}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Rated <span className="font-semibold text-foreground">{exp.score.toFixed(1)}</span>/10
        </span>
      </div>

      {reasoning && (
        <div className="mt-2">
          <p
            className={cn(
              "text-sm leading-relaxed text-foreground/90",
              !expanded && isLong && "line-clamp-2",
            )}
          >
            {reasoning}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {exp.evidence_quotes.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
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
    </li>
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
        return r.json() as Promise<{ explanations: QualityExplanation[] }>;
      })
      .then(data => {
        if (!cancelled) {
          const list = Array.isArray(data?.explanations) ? data.explanations : [];
          setExplanations(list.map(normalizeExplanation));
        }
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
    <div className="flex flex-col gap-4 pb-6">
      {/* Nav header */}
      <div className="px-5 pt-4">
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

      <div className="flex flex-col gap-4 px-5">
        {/* Axis heading */}
        <h2 className="text-lg font-semibold leading-tight">
          {axisMeta?.label ?? axisKey}
        </h2>

        {/* Score — the running aggregate for this axis (agents.score_state_mu
            projected per-axis). NOT the same as an individual past rating
            in the Evaluation history below. The info tooltip explains the
            difference so users don't expect simple-mean arithmetic. */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="flex items-center gap-1.5 px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Score</h3>
            <Tooltip>
              <TooltipTrigger
                aria-label="How this score is computed"
                className="inline-flex cursor-help items-center text-muted-foreground hover:text-foreground transition-colors"
              >
                <Info className="size-3.5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs leading-relaxed">
                Bayesian running score. Recent evaluations weigh more than older ones, so this won&apos;t equal a simple mean of the ratings below.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="px-4 py-4">
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
        </div>

        {/* What this measures */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">What this measures</h3>
          </div>
          <div className="px-4 py-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {WHAT_THIS_MEASURES[axisKey] ?? axisMeta?.description}
            </p>
          </div>
        </div>

        {/* Evaluation history — flat log of past per-artifact ratings that
            feed the running score above. Rendered as divided rows (not
            nested cards) so visually it reads as "events", not "scores". */}
        <div className="rounded-xl border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">Evaluation history</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Past evaluations that feed the running score above.
            </p>
          </div>
          <div className="px-4 py-3">
            {loading && (
              <div className="flex justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              </div>
            )}

            {!loading && fetchError && (
              <p className="text-sm text-muted-foreground">Failed to load history.</p>
            )}

            {!loading && !fetchError && explanations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No evaluation yet on this axis. An entry appears after the first peer evaluation is completed.
              </p>
            )}

            {!loading && !fetchError && explanations.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {explanations.map((exp, i) => (
                  <EvaluationHistoryItem key={i} exp={exp} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
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
  const [wizardOpen, setWizardOpen] = useState(false);

  // Live composite refresh — patch the big score card when a peer evaluation
  // (or batch invalidation) changes THIS agent's composite score.
  const applyScoreRefresh = useCallback((ev: AgentScoreRefreshedPayload) => {
    if (!agentId || ev.agent_id !== agentId) return;
    setQuality((prev) =>
      prev
        ? {
            ...prev,
            composite: ev.score_state_mu,
            score_state_mu: ev.score_state_mu,
            score_state_sigma: ev.score_state_sigma,
            last_evaluated_at: ev.last_evaluated_at,
          }
        : prev,
    );
  }, [agentId]);
  useAgentScoreRefresh(applyScoreRefresh);

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
        return r.json() as Promise<{ agent: AgentDetail }>;
      })
      .then(data => {
        if (!cancelled && data?.agent) setAgent(data.agent);
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
    <>
    {agent && (
      <UseAgentWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        agent={{
          id: agent.id,
          name: agent.name,
          role: agent.role,
          personality_brief: agent.personality_brief,
          score_state_mu: quality?.score_state_mu ?? quality?.composite ?? null,
        }}
      />
    )}
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-hidden p-0" showCloseButton={view.altitude === 1}>
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
          // Native overflow scroll — base-ui ScrollArea had trackpad
          // quirks inside the Sheet's nested flex chain. `min-h-0` lets
          // this flex child actually shrink below its content height,
          // which is what enables scrolling on overflow. See issue #171.
          <div className="flex-1 min-h-0 overflow-y-auto">
            {view.altitude === 1 && (
              <Altitude1
                agent={agent}
                quality={quality}
                qualityLoading={qualityLoading}
                onSeeBreakdown={() => setView({ altitude: 2 })}
                onUseAgent={() => setWizardOpen(true)}
              />
            )}

            {view.altitude === 2 && (
              <Altitude2
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
          </div>
        )}
      </SheetContent>
    </Sheet>
    </>
  );
}
