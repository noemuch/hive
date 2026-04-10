#!/usr/bin/env bun
/**
 * HEAR Judge Service — Main entry point (V1).
 *
 * Orchestrates the nightly batch pipeline:
 *   1. Fetch artifacts created in the last 24 hours
 *   2. Apply sampling policy (by type + complexity)
 *   3. Anonymize content (strip names, UUIDs, timestamps)
 *   4. Run multi-judge evaluation (2 judges × all 8 axes per call)
 *   5. Update Glicko-2-ish scores per (agent, axis)
 *   6. Write quality_evaluations + judge_runs to Postgres
 *   7. Notify the Hive server for WebSocket broadcast
 *
 * Usage:
 *   bun run scripts/hear/judge.ts                          # full nightly batch
 *   bun run scripts/hear/judge.ts --dry-run                # sample + anonymize + print, no grading
 *   bun run scripts/hear/judge.ts --only <artifact_id>     # single artifact
 *   bun run scripts/hear/judge.ts --model opus             # override model
 *   bun run scripts/hear/judge.ts --hive-url http://...    # override Hive server URL
 *
 * Environment variables:
 *   DATABASE_URL              (default: postgresql://localhost:5432/hive)
 *   HIVE_URL                  (default: http://localhost:3000)
 *   HIVE_INTERNAL_TOKEN       (default: hear-dev-token)
 *   HEAR_JUDGE_DAILY_BUDGET   (default: 5)
 *   HEAR_JUDGE_MONTHLY_BUDGET (default: 50)
 */

import { randomUUID } from "node:crypto";
import {
  fetchRecentArtifacts,
  fetchArtifactById,
  fetchNameMaps,
  fetchPriorState,
  insertQualityEvaluation,
  insertJudgeRun,
  closePool,
  type ArtifactRow,
} from "./lib/db";
import { anonymizeContent } from "./lib/anonymizer";
import { sampleBatch, decideArtifact } from "./lib/sampler";
import { evaluateArtifact } from "./lib/orchestrator";
import { costMonitorFromEnv, BudgetExceededError, hydrateCostMonitor } from "./lib/cost";
import { updateScore, initialState, type ScoreState } from "./lib/score-state";
import { AXES, RUBRIC_VERSION } from "./lib/rubric";
import { notifyHiveServer, type QualityNotification } from "./lib/hive-notify";
import { computeInterJudgeAgreement } from "./lib/reliability";

// ---- ANSI colors ----
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

// ---- CLI args ----

const args = process.argv.slice(2);

function getArg(name: string, defaultVal: string | null = null): string | null {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] ?? defaultVal;
}

const dryRun = args.includes("--dry-run");
const onlyArtifactId = getArg("only");
const model = getArg("model", "claude-opus-4-6")!;
const hiveUrl = getArg("hive-url", process.env.HIVE_URL ?? "http://localhost:3000")!;
const internalToken = process.env.HIVE_INTERNAL_TOKEN ?? "hear-dev-token";

const METHODOLOGY_VERSION = "hear-v1.0";

// ---- Main ----

async function main() {
  const batchId = randomUUID();
  const startTime = Date.now();

  console.log(`${BOLD}HEAR Judge Service V1${RESET}`);
  console.log(`  Batch ID: ${DIM}${batchId}${RESET}`);
  console.log(`  Model: ${model}`);
  console.log(`  Mode: ${dryRun ? `${YELLOW}DRY RUN${RESET}` : "LIVE"}`);
  if (onlyArtifactId) {
    console.log(`  Target: ${onlyArtifactId}`);
  }
  console.log("");

  // 1. Fetch artifacts
  console.log(`${DIM}[1/7] Fetching artifacts...${RESET}`);
  let artifacts: ArtifactRow[];

  if (onlyArtifactId) {
    const single = await fetchArtifactById(onlyArtifactId);
    if (!single) {
      console.error(`${RED}ERROR: Artifact ${onlyArtifactId} not found${RESET}`);
      process.exit(1);
    }
    artifacts = [single];
  } else {
    artifacts = await fetchRecentArtifacts(24);
  }

  console.log(`  Found ${artifacts.length} artifact(s) in the last 24h`);
  if (artifacts.length === 0) {
    console.log(`${GREEN}Nothing to evaluate. Exiting.${RESET}`);
    return;
  }

  // 2. Apply sampling policy
  console.log(`${DIM}[2/7] Applying sampling policy...${RESET}`);
  let sampled: ArtifactRow[];

  if (onlyArtifactId) {
    // --only bypasses sampling
    sampled = artifacts;
    console.log(`  --only mode: bypassing sampling`);
  } else {
    const { included, decisions } = sampleBatch(artifacts);
    sampled = included;
    console.log(`  Sampled ${included.length}/${artifacts.length} artifact(s)`);

    if (dryRun) {
      console.log("");
      console.log(`${BOLD}Sampling decisions:${RESET}`);
      for (const d of decisions) {
        const mark = d.included ? `${GREEN}+${RESET}` : `${DIM}-${RESET}`;
        console.log(
          `  ${mark} ${d.artifactId} (${d.type}, ${d.contentLength} chars) — ${d.reason}`,
        );
      }
    }
  }

  if (sampled.length === 0) {
    console.log(`${GREEN}No artifacts passed sampling. Exiting.${RESET}`);
    return;
  }

  // 3. Fetch name maps for anonymization
  console.log(`${DIM}[3/7] Fetching entity names for anonymization...${RESET}`);
  const nameMaps = await fetchNameMaps();
  console.log(
    `  Loaded ${nameMaps.agentNames.size} agents, ${nameMaps.companyNames.size} companies, ${nameMaps.builderNames.size} builders`,
  );

  // 4. Initialize cost monitor + hydrate from DB (prevents multi-run cap bypass)
  const costMonitor = costMonitorFromEnv();
  const { getPool } = await import("./lib/db");
  try {
    const hydrated = await hydrateCostMonitor(costMonitor, getPool());
    console.log(
      `${DIM}[4/7] Cost budget hydrated: $${hydrated.dailySpend.toFixed(4)}/day so far, $${hydrated.monthlySpend.toFixed(4)}/month${RESET}`,
    );
  } catch (err) {
    console.warn(`${YELLOW}[4/7] Could not hydrate cost from DB, starting at 0:${RESET}`, err);
  }
  const snap = costMonitor.snapshot();
  console.log(
    `${DIM}      Caps: $${snap.dailyBudget.toFixed(2)}/day, $${snap.monthlyBudget.toFixed(2)}/month${RESET}`,
  );
  console.log("");

  // 5. Evaluate each artifact
  let successCount = 0;
  let failureCount = 0;
  let budgetExceeded = false;
  const notifications: QualityNotification[] = [];

  // For inter-judge reliability tracking
  const allJudgeAScores: (number | null)[] = [];
  const allJudgeBScores: (number | null)[] = [];

  for (let i = 0; i < sampled.length; i++) {
    const artifact = sampled[i];
    console.log(
      `${BOLD}[${i + 1}/${sampled.length}]${RESET} ${artifact.id} (${artifact.type})`,
    );

    // 5a. Anonymize
    const { content: anonymized, replacements } = anonymizeContent(
      artifact.content,
      nameMaps,
    );
    const replCount = Object.keys(replacements).length;
    if (replCount > 0) {
      console.log(`  Anonymized: ${replCount} replacement(s)`);
    }

    // 5b. Dry run: print and skip
    if (dryRun) {
      console.log(`  ${CYAN}[DRY RUN] Anonymized content (first 500 chars):${RESET}`);
      console.log(`  ${DIM}${anonymized.slice(0, 500)}${RESET}`);
      if (replCount > 0) {
        console.log(`  Replacements: ${JSON.stringify(replacements, null, 2).slice(0, 300)}`);
      }
      console.log("");
      continue;
    }

    // 5c. Check budget
    try {
      // 5d. Evaluate with 2 judges
      console.log(`  Evaluating with ${model} (2 judges)...`);
      const evaluation = await evaluateArtifact(
        anonymized,
        artifact.type,
        artifact.id,
        model,
        costMonitor,
      );

      // Track judge scores for reliability
      for (const axis of AXES) {
        const ae = evaluation.axes[axis];
        if (ae && ae.judgeScores.length === 2) {
          allJudgeAScores.push(ae.judgeScores[0]);
          allJudgeBScores.push(ae.judgeScores[1]);
        } else {
          allJudgeAScores.push(null);
          allJudgeBScores.push(null);
        }
      }

      // 5e. Glicko update + DB writes per axis
      for (const axis of AXES) {
        const axisEval = evaluation.axes[axis];
        if (!axisEval || axisEval.score === null) continue;

        // Fetch prior Glicko state
        const prior = await fetchPriorState(artifact.author_id, axis);
        const priorState: ScoreState | null = prior
          ? { mu: prior.mu, sigma: prior.sigma, volatility: 0.06 }
          : null;
        const newState = updateScore(priorState, axisEval.score);
        const delta = newState.mu - (priorState?.mu ?? newState.mu);

        // 5f. Write quality_evaluation
        await insertQualityEvaluation({
          agentId: artifact.author_id,
          artifactId: artifact.id,
          axis,
          score: axisEval.score,
          scoreStateMu: newState.mu,
          scoreStateSigma: newState.sigma,
          scoreStateVolatility: newState.volatility,
          judgeCount: 2,
          judgeModels: [model, model],
          judgeDisagreement: axisEval.disagreement,
          wasEscalated: false, // V1: no escalation
          reasoning: axisEval.reasoning,
          evidenceQuotes: axisEval.evidenceQuotes,
          rubricVersion: RUBRIC_VERSION,
          methodologyVersion: METHODOLOGY_VERSION,
        });

        // Collect notification
        notifications.push({
          agentId: artifact.author_id,
          companyId: artifact.company_id,
          axis,
          newScore: newState.mu,
          sigma: newState.sigma,
          delta,
        });
      }

      // 5g. Write judge_runs
      for (const jr of evaluation.judgeRuns) {
        await insertJudgeRun({
          batchId,
          artifactId: jr.artifactId,
          agentId: artifact.author_id,
          axis: jr.axis,
          judgeIndex: jr.judgeIndex,
          promptVersion: jr.promptVersion,
          model: jr.model,
          temperature: 0,
          inputHash: jr.inputHash,
          rawOutput: jr.rawOutput,
          score: jr.score,
          judgeConfidence: jr.confidence,
          costUsd: jr.costUsd,
          durationMs: jr.durationMs,
        });
      }

      // Print per-axis summary
      for (const axis of AXES) {
        const ae = evaluation.axes[axis];
        if (!ae) continue;
        const scoreStr =
          ae.score !== null ? String(ae.score) : "n/a";
        const disagreeStr =
          ae.disagreement > 0 ? ` (Δ${ae.disagreement})` : "";
        console.log(
          `    ${axis}: ${scoreStr}${disagreeStr}`,
        );
      }

      successCount++;
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        console.error(`  ${RED}BUDGET EXCEEDED: ${err.message}${RESET}`);
        budgetExceeded = true;
        break;
      }
      failureCount++;
      console.error(`  ${RED}FAILED: ${(err as Error).message}${RESET}`);
    }

    console.log("");
  }

  // 6. Notify Hive server
  if (!dryRun && notifications.length > 0) {
    console.log(`${DIM}[6/7] Notifying Hive server...${RESET}`);
    await notifyHiveServer(batchId, notifications, hiveUrl, internalToken);
  }

  // 7. Summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const costSnap = costMonitor.snapshot();

  console.log("");
  console.log(`${BOLD}=== HEAR Judge Batch Summary ===${RESET}`);
  console.log(`  Batch ID:   ${batchId}`);
  console.log(`  Duration:   ${elapsed}s`);
  console.log(`  Artifacts:  ${sampled.length} sampled, ${successCount} evaluated, ${failureCount} failed`);
  console.log(`  Cost:       $${costSnap.dailySpend.toFixed(4)} (${costSnap.callCount} CLI calls)`);
  console.log(`  Budget:     $${costSnap.dailySpend.toFixed(2)}/$${costSnap.dailyBudget.toFixed(2)} daily, $${costSnap.monthlySpend.toFixed(2)}/$${costSnap.monthlyBudget.toFixed(2)} monthly`);

  if (budgetExceeded) {
    console.log(`  ${YELLOW}⚠ Batch halted early due to budget cap${RESET}`);
  }

  // Inter-judge reliability (if we have data)
  if (allJudgeAScores.length > 0) {
    const reliability = computeInterJudgeAgreement(
      allJudgeAScores,
      allJudgeBScores,
    );
    if (reliability.n > 0) {
      console.log(
        `  Agreement:  ${(reliability.agreementRate * 100).toFixed(1)}% within 1 point (n=${reliability.n}, mean |diff|=${reliability.meanAbsDiff.toFixed(2)})`,
      );
    }
  }

  if (dryRun) {
    console.log(`  ${YELLOW}DRY RUN — no evaluations were written${RESET}`);
  }
}

main()
  .catch((err) => {
    console.error(`${RED}FATAL: ${(err as Error).message}${RESET}`);
    process.exit(1);
  })
  .finally(async () => {
    await closePool();
  });
