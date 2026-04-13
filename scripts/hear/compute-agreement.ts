#!/usr/bin/env bun
/**
 * HEAR V1 — Inter-rater agreement computation
 *
 * Reads grader-a.json and grader-b.json, computes:
 *   - Cohen's κ per axis (weighted quadratic for ordinal data)
 *   - ICC per axis (two-way mixed, single-rater, consistency)
 *   - Pearson r per axis
 *   - Mean absolute difference per axis
 *   - Distribution of action: confirm / adjust / not gradable
 *
 * Writes a markdown report to docs/research/calibration/analysis/v1-inter-rater.md
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AXES, AXIS_LABELS, type Axis } from "./lib/rubric";
import type { GradesFile, ItemGrade } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const OPUS_PATH = join(
  PROJECT_ROOT,
  "docs",
  "research",
  "calibration",
  "grades",
  "grader-a.json",
);
const NOE_PATH = join(
  PROJECT_ROOT,
  "docs",
  "research",
  "calibration",
  "grades",
  "grader-b.json",
);
const OUTPUT_PATH = join(
  PROJECT_ROOT,
  "docs",
  "research",
  "calibration",
  "analysis",
  "v1-inter-rater.md",
);

// ---------- Statistics ----------

/**
 * Cohen's quadratic weighted kappa for ordinal scores.
 * Treats pairs where both scores are null as "not applicable" (excluded).
 */
function cohenKappaQuadratic(
  ratings1: (number | null)[],
  ratings2: (number | null)[],
): number | null {
  const pairs = ratings1
    .map((a, i) => [a, ratings2[i]] as const)
    .filter(([a, b]) => a !== null && b !== null) as [number, number][];

  if (pairs.length < 2) return null;

  const minVal = 1;
  const maxVal = 10;
  const k = maxVal - minVal + 1;

  // Observed matrix
  const observed: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  const m1 = new Array(k).fill(0);
  const m2 = new Array(k).fill(0);
  for (const [a, b] of pairs) {
    const i = a - minVal;
    const j = b - minVal;
    observed[i][j]++;
    m1[i]++;
    m2[j]++;
  }

  const n = pairs.length;

  // Weights (quadratic)
  const w: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => 1 - ((i - j) * (i - j)) / ((k - 1) * (k - 1))),
  );

  // Expected matrix
  const expected: number[][] = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => (m1[i] * m2[j]) / n),
  );

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      numerator += w[i][j] * observed[i][j];
      denominator += w[i][j] * expected[i][j];
    }
  }

  const poSum = numerator;
  const peSum = denominator;
  // Po and Pe should be divided by n, but for the kappa formula the n cancels
  const kappa = (poSum / n - peSum / n) / (1 - peSum / n);
  return kappa;
}

function pearsonCorrelation(
  ratings1: (number | null)[],
  ratings2: (number | null)[],
): number | null {
  const pairs = ratings1
    .map((a, i) => [a, ratings2[i]] as const)
    .filter(([a, b]) => a !== null && b !== null) as [number, number][];

  if (pairs.length < 2) return null;

  const n = pairs.length;
  const mean1 = pairs.reduce((s, [a]) => s + a, 0) / n;
  const mean2 = pairs.reduce((s, [, b]) => s + b, 0) / n;

  let num = 0;
  let d1 = 0;
  let d2 = 0;
  for (const [a, b] of pairs) {
    const da = a - mean1;
    const db = b - mean2;
    num += da * db;
    d1 += da * da;
    d2 += db * db;
  }

  if (d1 === 0 || d2 === 0) return null;
  return num / Math.sqrt(d1 * d2);
}

function meanAbsoluteDifference(
  ratings1: (number | null)[],
  ratings2: (number | null)[],
): number | null {
  const pairs = ratings1
    .map((a, i) => [a, ratings2[i]] as const)
    .filter(([a, b]) => a !== null && b !== null) as [number, number][];
  if (pairs.length === 0) return null;
  return pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / pairs.length;
}

/**
 * ICC(3,1): two-way mixed effects, single rater, consistency.
 * Simplified implementation for 2 raters × n items.
 */
function icc(
  ratings1: (number | null)[],
  ratings2: (number | null)[],
): number | null {
  const pairs = ratings1
    .map((a, i) => [a, ratings2[i]] as const)
    .filter(([a, b]) => a !== null && b !== null) as [number, number][];

  const n = pairs.length;
  if (n < 2) return null;

  const k = 2; // 2 raters
  const grandMean =
    pairs.reduce((s, [a, b]) => s + a + b, 0) / (n * k);
  const rowMeans = pairs.map(([a, b]) => (a + b) / 2);
  const colMeans = [
    pairs.reduce((s, [a]) => s + a, 0) / n,
    pairs.reduce((s, [, b]) => s + b, 0) / n,
  ];

  let msr = 0;
  for (const rm of rowMeans) {
    msr += (rm - grandMean) ** 2;
  }
  msr = (msr * k) / (n - 1);

  let mse = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < k; j++) {
      const val = j === 0 ? pairs[i][0] : pairs[i][1];
      mse +=
        (val - rowMeans[i] - colMeans[j] + grandMean) ** 2;
    }
  }
  mse /= (n - 1) * (k - 1);

  if (msr + (k - 1) * mse === 0) return null;
  return (msr - mse) / (msr + (k - 1) * mse);
}

// ---------- Data loading ----------

function loadGrades(path: string): ItemGrade[] {
  if (!existsSync(path)) {
    console.error(`ERROR: ${path} not found`);
    process.exit(1);
  }
  const file = JSON.parse(readFileSync(path, "utf-8")) as GradesFile;
  return file.items;
}

// ---------- Action analysis ----------

type Action = "confirm" | "adjust" | "not_gradable";

function classifyAction(opusScore: number | null, noeScore: number | null): Action {
  if (noeScore === null) return "not_gradable";
  if (opusScore === noeScore) return "confirm";
  return "adjust";
}

// ---------- Main ----------

function fmt(value: number | null, digits = 3): string {
  if (value === null) return "N/A";
  return value.toFixed(digits);
}

function main() {
  const opusItems = loadGrades(OPUS_PATH);
  const noeItems = loadGrades(NOE_PATH);

  const opusMap = new Map(opusItems.map((i) => [i.item_id, i]));
  const noeMap = new Map(noeItems.map((i) => [i.item_id, i]));

  const commonIds = [...opusMap.keys()]
    .filter((id) => noeMap.has(id))
    .sort();

  console.log(`Opus grades: ${opusItems.length}`);
  console.log(`Grader B items: ${noeItems.length}`);
  console.log(`Common items: ${commonIds.length}`);
  console.log("");

  const report: string[] = [];
  report.push("# HEAR V1 — Inter-rater reliability report");
  report.push("");
  report.push(`**Computed at**: ${new Date().toISOString()}`);
  report.push(`**Rubric version**: 1.0`);
  report.push(`**Opus items graded**: ${opusItems.length}`);
  report.push(`**Human items graded**: ${noeItems.length}`);
  report.push(`**Common items**: ${commonIds.length}`);
  report.push("");
  report.push("## Per-axis statistics");
  report.push("");
  report.push("| Axis | N valid | Cohen's κ | Pearson r | ICC | Mean abs diff | Confirm | Adjust | Not gradable |");
  report.push("|---|---|---|---|---|---|---|---|---|");

  for (const axis of AXES) {
    const opusScores: (number | null)[] = [];
    const noeScores: (number | null)[] = [];
    const actions: Record<Action, number> = {
      confirm: 0,
      adjust: 0,
      not_gradable: 0,
    };

    for (const id of commonIds) {
      const opusItem = opusMap.get(id)!;
      const noeItem = noeMap.get(id)!;
      const opusS = opusItem.scores[axis].score;
      const noeS = noeItem.scores[axis].score;
      opusScores.push(opusS);
      noeScores.push(noeS);
      actions[classifyAction(opusS, noeS)]++;
    }

    const nValid = opusScores.filter((v, i) => v !== null && noeScores[i] !== null).length;
    const kappa = cohenKappaQuadratic(opusScores, noeScores);
    const r = pearsonCorrelation(opusScores, noeScores);
    const iccVal = icc(opusScores, noeScores);
    const mad = meanAbsoluteDifference(opusScores, noeScores);

    report.push(
      `| ${AXIS_LABELS[axis]} | ${nValid} | ${fmt(kappa)} | ${fmt(r)} | ${fmt(iccVal)} | ${fmt(mad, 2)} | ${actions.confirm} | ${actions.adjust} | ${actions.not_gradable} |`,
    );
  }

  report.push("");
  report.push("## Interpretation guide");
  report.push("");
  report.push("- **Cohen's κ** (quadratic weighted): > 0.8 excellent, 0.6-0.8 substantial, 0.4-0.6 moderate, < 0.4 poor");
  report.push("- **Pearson r**: continuous correlation, > 0.7 strong, 0.4-0.7 moderate, < 0.4 weak");
  report.push("- **ICC** (two-way mixed, consistency): > 0.75 good, 0.5-0.75 moderate, < 0.5 poor");
  report.push("- **Mean abs diff**: average gap between Opus and Grader B scores on the 1-10 scale");
  report.push("");
  report.push("Per the pre-registration document, Cohen's κ ≥ 0.6 on at least 5 of 8 axes is the V1 success threshold.");
  report.push("");
  report.push("## Notes");
  report.push("");
  report.push("- Persona Coherence is expected to be N/A on all items (requires longitudinal data)");
  report.push("- Initiative Quality is expected to be N/A on most items (requires behavior windows)");
  report.push("- Items with null scores on both sides are excluded from the axis-level computation");

  // Ensure output dir exists
  const outDir = join(PROJECT_ROOT, "docs", "research", "calibration", "analysis");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  writeFileSync(OUTPUT_PATH, report.join("\n"));
  console.log(`Report written to: ${OUTPUT_PATH}`);
  console.log("");
  console.log("Console summary:");
  report.slice(7, 20).forEach((line) => console.log(line));
}

main();
