"use client";

import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export const QUALITY_AXES = [
  {
    key: "reasoning_depth",
    label: "Reasoning Depth",
    description: "Quality of explicit deliberative cognition — are premises stated, alternatives considered, conclusions derived?",
  },
  {
    key: "decision_wisdom",
    label: "Decision Wisdom",
    description: "Quality of choices: trade-offs acknowledged, second-order consequences anticipated, reversibility considered.",
  },
  {
    key: "communication_clarity",
    label: "Communication Clarity",
    description: "How effectively the agent transmits information — precision, structure, appropriate density for the audience.",
  },
  {
    key: "initiative_quality",
    label: "Initiative Quality",
    description: "Value created by unprompted actions — proactive identification of problems, opportunities, and improvements.",
  },
  {
    key: "collaborative_intelligence",
    label: "Collaborative Intelligence",
    description: "How the agent enhances group cognition — building on others' ideas, surfacing conflict productively.",
  },
  {
    key: "self_awareness_calibration",
    label: "Self-Awareness",
    description: "Accuracy of the agent's model of its own capabilities, knowledge limits, and blind spots.",
  },
  {
    key: "persona_coherence",
    label: "Persona Coherence",
    description: "Consistency of identity, values, and communication style across contexts and over time.",
  },
  {
    key: "contextual_judgment",
    label: "Contextual Judgment",
    description: "Appropriate calibration of response to situational demands — urgency, stakes, audience, and context.",
  },
] as const;

export type QualityAxisKey = (typeof QUALITY_AXES)[number]["key"];

export type QualityExplanation = {
  axis: QualityAxisKey;
  score: number;
  reasoning: string;
  evidence_quotes: string[];
  computed_at: string;
};

function scoreBadgeClass(score: number): string {
  if (score >= 7) return "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20";
  if (score >= 4) return "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20";
  return "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20";
}

function confidenceLabel(sigma: number): { label: string; className: string } {
  if (sigma < 0.5) return { label: "Calibrated", className: "text-green-600 dark:text-green-400" };
  if (sigma < 1.5) return { label: "Provisional", className: "text-yellow-600 dark:text-yellow-400" };
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

export function QualityDrilldown({
  agentId,
  axisKey,
  score,
  sigma,
  open,
  onClose,
}: {
  agentId: string;
  axisKey: QualityAxisKey | null;
  score: number;
  sigma: number;
  open: boolean;
  onClose: () => void;
}) {
  const [explanations, setExplanations] = useState<QualityExplanation[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const axisMeta = QUALITY_AXES.find(a => a.key === axisKey);
  const confidence = confidenceLabel(sigma);

  useEffect(() => {
    if (!open || !agentId || !axisKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExplanations([]);
      setFetchError(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    fetch(`${API_URL}/api/agents/${agentId}/quality/explanations?axis=${axisKey}&limit=5`)
      .then(r => { if (!r.ok) throw new Error(r.statusText); return r.json() as Promise<QualityExplanation[]>; })
      .then(data => { if (!cancelled) setExplanations(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, agentId, axisKey]);

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose(); }}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-3 pr-8">
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-base">
                {axisMeta?.label ?? axisKey}
              </SheetTitle>
              <SheetDescription className="mt-1 text-xs leading-relaxed">
                {axisMeta?.description}
              </SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className={cn("font-mono text-3xl font-bold", scoreBadgeClass(score).split(" ").filter(c => c.startsWith("text-")).join(" "))}>
              {score.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/10</span>
            <span className={cn("ml-2 text-xs font-medium", confidence.className)}>
              {confidence.label}
            </span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              σ {sigma.toFixed(2)}
            </span>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-6 px-6 py-6">
            {loading && (
              <div className="flex justify-center py-8">
                <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-foreground" />
              </div>
            )}

            {!loading && fetchError && (
              <p className="text-sm text-muted-foreground">Failed to load explanations.</p>
            )}

            {!loading && !fetchError && explanations.length === 0 && (
              <p className="text-sm text-muted-foreground">No explanations available yet.</p>
            )}

            {!loading && !fetchError && explanations.map((exp, i) => (
              <div key={i} className={cn("flex flex-col gap-3 rounded-lg bg-muted/40 p-4", i > 0 && "border-t border-border/40 pt-4 rounded-none bg-transparent")}>
                <div className="flex items-center gap-2">
                  <span className={cn("inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-xs font-semibold", scoreBadgeClass(exp.score))}>
                    {exp.score.toFixed(0)}/10
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatDate(exp.computed_at)}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">{exp.reasoning}</p>
                {exp.evidence_quotes.length > 0 && (
                  <div className="mt-2 flex flex-col gap-2.5">
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
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
