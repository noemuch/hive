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

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

const JUDGE_PREAMBLES: Record<number, string> = {
  0: "You are HEAR Judge A. Grade this artifact independently.",
  1: "You are HEAR Judge B. Grade this artifact independently. You may disagree with other judges.",
};

const PROMPT_VERSION = "judge-v1.0";

// ---- Claude CLI (copied from pre-grade.ts to keep lib self-contained) ----

/**
 * Call the `claude` CLI in print mode with the prompt piped via stdin.
 * Returns the raw text response plus cost/usage metadata from the envelope.
 */
async function callClaudeCli(
  prompt: string,
  model: string,
): Promise<{ text: string; cost?: number; usage?: unknown }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `claude CLI exited with code ${code}\nstderr: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }

      try {
        const envelope = JSON.parse(stdout);
        const text = envelope.result ?? envelope.message ?? envelope.text;
        if (typeof text !== "string") {
          throw new Error(
            `unexpected CLI envelope shape: ${JSON.stringify(envelope).slice(0, 500)}`,
          );
        }
        resolve({
          text,
          cost: envelope.total_cost_usd,
          usage: envelope.usage,
        });
      } catch (err) {
        reject(
          new Error(
            `failed to parse claude CLI JSON output: ${(err as Error).message}\nfirst 500 chars of output: ${stdout.slice(0, 500)}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `failed to spawn 'claude' — is Claude Code installed and in your PATH? (${err.message})`,
        ),
      );
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

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
    return JSON.parse(candidate); // throws if still invalid
  }

  throw new Error("no JSON object found in response");
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
 * SHA-256 hash of the input content, used for the audit log so we can
 * verify that two judges saw the exact same input.
 */
function hashInput(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ---- Single judge call ----

type JudgeResult = {
  scores: Record<string, AxisScore>;
  costUsd: number;
  durationMs: number;
  rawOutput: unknown;
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

  const startTime = Date.now();
  const { text, cost } = await callClaudeCli(prompt, model);
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
  const inputHashValue = hashInput(artifactContent);

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
        inputHash: inputHashValue,
        rawOutput: jr.rawOutput,
        score,
        confidence,
        costUsd: jr.costUsd / AXES.length, // approximate per-axis cost
        durationMs: jr.durationMs / AXES.length, // approximate per-axis time
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
