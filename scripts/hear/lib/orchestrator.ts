/**
 * HEAR Judge Service — Multi-judge orchestration.
 *
 * For each artifact, runs two independent judge variants (A and B) using
 * the Claude CLI, then aggregates results:
 *   - Each judge grades all 8 HEAR axes in a single call
 *   - Scores are combined via median (for 2 judges: arithmetic mean)
 *   - Disagreement is tracked per axis (absolute difference)
 *   - All raw outputs are preserved in JudgeRunRecord for the audit log
 *
 * V1 scope:
 *   - 2 judge calls per artifact (not per axis — same as pre-grade.ts)
 *   - Both variants use the same grader prompt template but with
 *     a different system preamble to encourage independent judgment
 *   - Claude CLI (`claude -p`) routed through Claude Max subscription
 *
 * V2 will:
 *   - Support N judges with configurable variant prompts
 *   - Use the raw Anthropic API for better cost tracking
 *   - Add escalation logic when disagreement exceeds threshold
 */

import { createHash } from "node:crypto";
import { callClaude } from "./claude-cli";
import type { ClaudeResponse } from "./claude-cli";
import { loadRubric, loadGraderPrompt, AXES, RUBRIC_VERSION } from "./rubric";
import type { AxisScore } from "./schema";
import type { CostMonitor } from "./cost";
import { ESTIMATED_COST_PER_CALL_USD } from "./cost";

// ---- Types ----

export type AxisEvaluation = {
  score: number | null;
  reasoning: string;
  evidenceQuotes: string[];
  judgeScores: number[];
  disagreement: number;
};

export type ArtifactEvaluation = {
  artifactId: string;
  axes: Record<string, AxisEvaluation>;
  judgeRuns: JudgeRunRecord[];
};

export type JudgeRunRecord = {
  artifactId: string;
  axis: string;
  judgeIndex: number;
  promptVersion: string;
  model: string;
  inputHash: string;
  rawOutput: unknown;
  score: number | null;
  confidence: number;
  costUsd: number;
  durationMs: number;
};

// ---- Judge variant preambles ----
//
// V1: two judges share the same model but approach the artifact from distinct
// analytical lenses. This is NOT a replacement for independent judges — see
// HEAR-methodology.md "Inter-judge independence — V1 limitations" for the
// honest caveat. V2 will add temperature jitter and/or a second model family.
const JUDGE_PREAMBLES: Record<number, string> = {
  0:
    "You are HEAR Judge A — a careful, structural reader. Focus on what the " +
    "artifact explicitly says: stated reasoning, cited evidence, tradeoffs " +
    "that are on the page. Be strict with weak claims, generous with clear " +
    "thinking. Grade independently.",
  1:
    "You are HEAR Judge B — a skeptical, second-order reader. Focus on what " +
    "the artifact omits: unstated assumptions, missing alternatives, " +
    "consequences not anticipated. Be willing to disagree with a surface-level " +
    "reading. Grade independently and do not anchor to other judges.",
};

const PROMPT_VERSION = "judge-v1.1";

/**
 * Extract JSON from Claude's response. The grader prompt requests raw JSON,
 * but Claude sometimes wraps it in a code block or adds surrounding text.
 */
function extractJson(text: string): unknown {
  // Strategy 1: direct parse
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }

  // Strategy 2: markdown code block
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {
      // fall through
    }
  }

  // Strategy 3: first { ... } block at top level
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (err) {
      // Provide forensic context: which strategy failed, what we parsed,
      // and the first 500 chars of the original response.
      throw new Error(
        `extractJson strategy 3 failed: ${(err as Error).message}\n` +
        `candidate (first 500 chars): ${candidate.slice(0, 500)}\n` +
        `original response (first 500 chars): ${text.slice(0, 500)}`,
      );
    }
  }

  throw new Error(
    `no JSON object found in response (first 500 chars): ${text.slice(0, 500)}`,
  );
}

// ---- Prompt assembly ----

function buildJudgePrompt(
  artifactContent: string,
  artifactType: string,
  artifactId: string,
  judgeIndex: number,
): string {
  const rubric = loadRubric();
  const graderPromptDoc = loadGraderPrompt();

  // Extract the prompt template from grader-prompt-opus.md
  const match = graderPromptDoc.match(
    /## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/,
  );
  if (!match) {
    throw new Error(
      "could not extract prompt template from grader-prompt-opus.md",
    );
  }

  const preamble = JUDGE_PREAMBLES[judgeIndex] ?? JUDGE_PREAMBLES[0];

  let template = match[1];
  template = template.replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric);
  template = template.replace("{{ARTIFACT_TYPE}}", artifactType);
  template = template.replace("{{ARTIFACT_CONTENT}}", artifactContent);
  template = template.replace("{{ITEM_ID}}", artifactId);
  template = template.replace("{{ISO_TIMESTAMP}}", new Date().toISOString());

  // Prepend the judge variant preamble before the <role> section
  return `${preamble}\n\n${template}`;
}

/**
 * SHA-256 hash of arbitrary content. Used to hash the fully-assembled prompt
 * (preamble + rubric + template + artifact) so the audit log can detect
 * prompt drift. A reviewer comparing two `judge_runs` rows with different
 * `input_hash` values knows the prompt changed between calls.
 */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---- Single judge call ----

type JudgeResult = {
  scores: Record<string, AxisScore>;
  costUsd: number;
  durationMs: number;
  rawOutput: unknown;
  /** SHA-256 of the fully-assembled prompt this judge received. */
  promptHash: string;
};

async function runSingleJudge(
  artifactContent: string,
  artifactType: string,
  artifactId: string,
  judgeIndex: number,
  model: string,
): Promise<JudgeResult> {
  const prompt = buildJudgePrompt(
    artifactContent,
    artifactType,
    artifactId,
    judgeIndex,
  );
  const promptHash = hashContent(prompt);

  const startTime = Date.now();
  const { text, cost } = await callClaude(prompt, model);
  const durationMs = Date.now() - startTime;

  const parsed = extractJson(text) as { scores?: Record<string, AxisScore> };
  if (!parsed.scores) {
    throw new Error(
      `Judge ${judgeIndex} response has no 'scores' field (artifact ${artifactId})`,
    );
  }

  return {
    scores: parsed.scores,
    costUsd: cost ?? 0,
    durationMs,
    rawOutput: parsed,
    promptHash,
  };
}

// ---- Main orchestration ----

/**
 * Evaluate a single artifact with 2 independent judge variants.
 *
 * For each of the 8 HEAR axes:
 *   - Collects both judges' scores
 *   - Computes the median (mean for 2 judges)
 *   - Records disagreement (absolute difference)
 *   - Uses judge A's reasoning/evidence (the "primary" judge)
 *
 * Returns the aggregated evaluation plus raw JudgeRunRecords for the audit log.
 */
export async function evaluateArtifact(
  artifactContent: string,
  artifactType: string,
  artifactId: string,
  model: string,
  costTracker: CostMonitor,
): Promise<ArtifactEvaluation> {
  // Pre-flight cost check: 2 calls per artifact
  costTracker.assertCanSpend(ESTIMATED_COST_PER_CALL_USD * 2);

  // Run both judges sequentially (V1: sequential to stay within CLI concurrency)
  const judgeResults: JudgeResult[] = [];
  for (let judgeIndex = 0; judgeIndex < 2; judgeIndex++) {
    const label = judgeIndex === 0 ? "A" : "B";
    console.log(`    Judge ${label}: calling ${model}...`);

    const result = await runSingleJudge(
      artifactContent,
      artifactType,
      artifactId,
      judgeIndex,
      model,
    );

    costTracker.record(result.costUsd);

    const costStr =
      result.costUsd > 0 ? ` $${result.costUsd.toFixed(4)}` : "";
    console.log(
      `    Judge ${label}: done in ${(result.durationMs / 1000).toFixed(1)}s${costStr}`,
    );

    judgeResults.push(result);
  }

  // Aggregate across judges per axis
  const axes: Record<string, AxisEvaluation> = {};
  const judgeRuns: JudgeRunRecord[] = [];

  for (const axis of AXES) {
    const scoresFromJudges: (number | null)[] = [];
    const confidences: number[] = [];

    for (let judgeIndex = 0; judgeIndex < judgeResults.length; judgeIndex++) {
      const jr = judgeResults[judgeIndex];
      const axisResult = jr.scores[axis];
      const score = axisResult?.score ?? null;
      const confidence = axisResult?.confidence ?? 5;

      scoresFromJudges.push(score);
      confidences.push(confidence);

      judgeRuns.push({
        artifactId,
        axis,
        judgeIndex,
        promptVersion: PROMPT_VERSION,
        model,
        // Hash of the fully-assembled prompt this judge saw (preamble +
        // rubric + template + artifact). Per-judge so a preamble change
        // produces different hashes for Judge A vs Judge B.
        inputHash: jr.promptHash,
        rawOutput: jr.rawOutput,
        score,
        confidence,
        costUsd: jr.costUsd / AXES.length, // approximate per-axis cost (column is NUMERIC, float OK)
        durationMs: Math.round(jr.durationMs / AXES.length), // column is INT, must round
      });
    }

    // Compute aggregated score: mean of non-null scores
    const validScores = scoresFromJudges.filter(
      (s): s is number => s !== null,
    );
    const aggregatedScore =
      validScores.length > 0
        ? validScores.reduce((a, b) => a + b, 0) / validScores.length
        : null;

    // Disagreement: absolute difference (0 if only one score)
    const disagreement =
      validScores.length === 2
        ? Math.abs(validScores[0] - validScores[1])
        : 0;

    // Use Judge A's reasoning and evidence (the primary judge)
    const primaryResult = judgeResults[0].scores[axis];

    axes[axis] = {
      score: aggregatedScore !== null ? Math.round(aggregatedScore) : null,
      reasoning:
        primaryResult?.thinking ?? primaryResult?.justification ?? "",
      evidenceQuotes: primaryResult?.evidence_quotes ?? [],
      judgeScores: scoresFromJudges.filter((s): s is number => s !== null),
      disagreement,
    };
  }

  return { artifactId, axes, judgeRuns };
}
