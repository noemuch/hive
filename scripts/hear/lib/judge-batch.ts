/**
 * HEAR Judge Service — Batch API evaluation path (hive#174).
 *
 * Alternate to the synchronous 2-call-per-artifact loop in `orchestrator.ts`.
 * Collects every (artifact × judgeA/B) pair into a single Anthropic Messages
 * Batch, polls for completion (default every 15s, 24h ceiling), then parses
 * the results back into the same `ArtifactEvaluation` shape the rest of the
 * judge pipeline consumes.
 *
 * Invoked from `judge.ts` when `LLM_BATCH_MODE=true`. Any batch-level failure
 * bubbles up so the caller can fall back to the per-call path.
 *
 * Cost rationale: Anthropic applies a flat 50% per-token discount on
 * completed batch requests. The judge runs nightly and can tolerate minutes-
 * to-hours of latency; swapping from sync to batch halves the $ spent on
 * quality evaluation with zero UX impact.
 */

import { createHash } from "node:crypto";
import { runBatch } from "../../../agents/lib/llm-batch";
import type { BatchRequest, BatchResult } from "../../../agents/lib/llm-batch";
import { AXES } from "./rubric";
import type { AxisScore } from "./schema";
import type { ArtifactEvaluation, JudgeRunRecord } from "./orchestrator";

export type BatchArtifactInput = {
  artifactId: string;
  artifactType: string;
  /** Pre-built prompts for Judge A (index 0) and Judge B (index 1). */
  prompts: [string, string];
};

export type BatchJudgeResult = {
  evaluations: ArtifactEvaluation[];
  /** Number of batch requests that returned an error (vs. succeeded). */
  errorCount: number;
  /** Ids of artifacts that had at least one failed judge call. */
  failedArtifactIds: string[];
};

export type BatchJudgeOptions = {
  model: string;
  apiKey: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  maxTokens?: number;
  onProgress?: (status: string) => void;
};

const PROMPT_VERSION = "judge-v1.1-batch";

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Format: `art_<id>::judge_<index>`. Parsed back out of batch results to
 * route each succeeded message to the right artifact + judge slot.
 */
function buildCustomId(artifactId: string, judgeIndex: number): string {
  return `art_${artifactId}::judge_${judgeIndex}`;
}

function parseCustomId(
  customId: string,
): { artifactId: string; judgeIndex: number } | null {
  const match = customId.match(/^art_(.+)::judge_(\d+)$/);
  if (!match) return null;
  return { artifactId: match[1], judgeIndex: Number(match[2]) };
}

function extractJson(text: string): { scores?: Record<string, AxisScore> } {
  try {
    return JSON.parse(text);
  } catch {
    /* fall through */
  }
  const codeBlock = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1]);
    } catch {
      /* fall through */
    }
  }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1));
    } catch {
      /* fall through */
    }
  }
  return {};
}

/**
 * Submit all artifact × judge pairs as a single Anthropic batch, then
 * reconstruct per-artifact `ArtifactEvaluation` records.
 */
export async function evaluateArtifactsBatch(
  inputs: BatchArtifactInput[],
  opts: BatchJudgeOptions,
): Promise<BatchJudgeResult> {
  if (inputs.length === 0) {
    return { evaluations: [], errorCount: 0, failedArtifactIds: [] };
  }

  // 1. Build batch requests — 2 per artifact (Judge A + Judge B).
  const requests: BatchRequest[] = [];
  for (const art of inputs) {
    for (let judgeIndex = 0; judgeIndex < 2; judgeIndex++) {
      requests.push({
        customId: buildCustomId(art.artifactId, judgeIndex),
        model: opts.model,
        userContent: art.prompts[judgeIndex],
        maxTokens: opts.maxTokens ?? 4096,
        temperature: 0,
      });
    }
  }

  // 2. Submit + poll to completion. runBatch handles the poll loop.
  const results = await runBatch(requests, {
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    pollIntervalMs: opts.pollIntervalMs,
    maxWaitMs: opts.maxWaitMs,
    onProgress: (s) => opts.onProgress?.(s),
  });

  // 3. Group results by artifactId.
  type PerArtifact = {
    results: Array<BatchResult | undefined>;
    prompts: [string, string];
    artifactType: string;
  };
  const byArtifact = new Map<string, PerArtifact>();
  for (const art of inputs) {
    byArtifact.set(art.artifactId, {
      results: [undefined, undefined],
      prompts: art.prompts,
      artifactType: art.artifactType,
    });
  }
  let errorCount = 0;
  for (const r of results) {
    const parsed = parseCustomId(r.customId);
    if (!parsed) {
      errorCount++;
      continue;
    }
    const bucket = byArtifact.get(parsed.artifactId);
    if (!bucket) {
      errorCount++;
      continue;
    }
    bucket.results[parsed.judgeIndex] = r;
    if (r.error || !r.text) errorCount++;
  }

  // 4. Reconstruct per-artifact evaluations. Any artifact missing BOTH
  // judge results is marked as failed; partial (1-of-2) is still accepted
  // but the axis disagreement field is 0.
  const evaluations: ArtifactEvaluation[] = [];
  const failedArtifactIds: string[] = [];

  for (const [artifactId, bucket] of byArtifact.entries()) {
    const judgeOutputs: Array<{ scores: Record<string, AxisScore> } | null> = [
      null,
      null,
    ];
    for (let i = 0; i < 2; i++) {
      const r = bucket.results[i];
      if (!r || r.error || !r.text) continue;
      const parsed = extractJson(r.text);
      if (parsed.scores) judgeOutputs[i] = { scores: parsed.scores };
    }

    const validOutputs = judgeOutputs.filter((o): o is { scores: Record<string, AxisScore> } => o !== null);
    if (validOutputs.length === 0) {
      failedArtifactIds.push(artifactId);
      continue;
    }

    const axes: ArtifactEvaluation["axes"] = {};
    const judgeRuns: JudgeRunRecord[] = [];

    for (const axis of AXES) {
      const scoresFromJudges: (number | null)[] = [];
      const confidences: number[] = [];

      for (let judgeIndex = 0; judgeIndex < judgeOutputs.length; judgeIndex++) {
        const jo = judgeOutputs[judgeIndex];
        const score = jo?.scores[axis]?.score ?? null;
        const confidence = jo?.scores[axis]?.confidence ?? 5;
        scoresFromJudges.push(score);
        confidences.push(confidence);

        // Only emit a judge run record for judges that actually produced
        // output — a null bucket means the batch returned no text for that
        // slot (which we've already counted in `errorCount`).
        if (jo) {
          const rawText = bucket.results[judgeIndex]?.text ?? "";
          judgeRuns.push({
            artifactId,
            axis,
            judgeIndex,
            promptVersion: PROMPT_VERSION,
            model: opts.model,
            inputHash: hashContent(bucket.prompts[judgeIndex]),
            rawOutput: jo,
            score,
            confidence,
            // Batch path: per-call cost tracking is handled at the batch
            // level (50% of sync rate). Per-axis cost = 0 here; the caller
            // logs aggregate batch cost from provider usage.
            costUsd: 0,
            durationMs: 0,
          });
        }
      }

      const validScores = scoresFromJudges.filter((s): s is number => s !== null);
      const aggregated =
        validScores.length > 0
          ? validScores.reduce((a, b) => a + b, 0) / validScores.length
          : null;
      const disagreement =
        validScores.length === 2 ? Math.abs(validScores[0] - validScores[1]) : 0;

      const primary = judgeOutputs.find((o): o is { scores: Record<string, AxisScore> } => o !== null);
      const primaryAxis = primary?.scores[axis];

      axes[axis] = {
        score: aggregated !== null ? Math.round(aggregated) : null,
        reasoning: primaryAxis?.thinking ?? primaryAxis?.justification ?? "",
        evidenceQuotes: primaryAxis?.evidence_quotes ?? [],
        judgeScores: validScores,
        disagreement,
      };
    }

    evaluations.push({ artifactId, axes, judgeRuns });
  }

  return { evaluations, errorCount, failedArtifactIds };
}
