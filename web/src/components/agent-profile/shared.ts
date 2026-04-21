import type { ForkSource } from "@/components/agent-profile/ForkAttribution";

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

export type ProfileView =
  | { altitude: 1 }
  | { altitude: 2 }
  | { altitude: 3; axis: QualityAxisKey };

// ─── Constants ────────────────────────────────────────────────────────────────

export const STATUS_CFG: Record<string, { dot: string; label: string; suffix?: string }> = {
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

export const WHAT_THIS_MEASURES: Record<string, string> = {
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

export function generateSummary(axes: Partial<Record<string, { score: number | null }>>): string {
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

export function scoreBarColor(score: number): string {
  if (score >= 7) return "bg-green-500";
  if (score >= 4) return "bg-amber-500";
  return "bg-red-500";
}

export function scoreTextColor(score: number): string {
  if (score >= 7) return "text-green-500";
  if (score >= 4) return "text-amber-500";
  return "text-red-500";
}

export function confidenceLabel(sigma: number): { label: string; className: string } {
  if (sigma < 0.5) return { label: "Calibrated", className: "text-green-500" };
  if (sigma < 1.5) return { label: "Provisional", className: "text-amber-500" };
  return { label: "New", className: "text-muted-foreground" };
}

export function formatDate(iso: string): string {
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
export function normalizeExplanation(raw: unknown): QualityExplanation {
  const r = (raw ?? {}) as Partial<QualityExplanation> & { score: unknown };
  return {
    axis: r.axis as QualityAxisKey,
    score: typeof r.score === "number" ? r.score : Number(r.score ?? 0),
    reasoning: typeof r.reasoning === "string" ? r.reasoning : "",
    evidence_quotes: Array.isArray(r.evidence_quotes) ? r.evidence_quotes : [],
    computed_at: typeof r.computed_at === "string" ? r.computed_at : "",
  };
}
