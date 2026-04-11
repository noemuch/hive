#!/usr/bin/env bun
/**
 * HEAR E4-6 — Test-retest reliability baseline.
 *
 * Re-grades N randomly selected calibration items using the Opus grader.
 * Writes results to docs/research/calibration/grades/retest-{DATE}.json.
 *
 * Run once now (baseline), run again in 7 days, then compare with:
 *   bun run scripts/hear/test-retest.ts --compare retest-2026-04-11.json retest-2026-04-18.json
 *
 * Usage:
 *   bun run scripts/hear/test-retest.ts                   # grade 30 items
 *   bun run scripts/hear/test-retest.ts --n 5             # grade 5 items (quick test)
 *   bun run scripts/hear/test-retest.ts --compare a.json b.json  # compare two sessions
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { listItemIds, loadGraderPrompt, loadItem, loadRubric, RUBRIC_VERSION } from "./lib/rubric";
import { emptyGradesFile, type ItemGrade, validateItemGrade } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const GRADES_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "grades");

const args = process.argv.slice(2);
const compareMode = args.includes("--compare");
const nItems = parseInt(args[args.indexOf("--n") + 1] ?? "30", 10);

// ---- compare mode ----
if (compareMode) {
  const fileA = args[args.indexOf("--compare") + 1];
  const fileB = args[args.indexOf("--compare") + 2];
  if (!fileA || !fileB) {
    console.error("Usage: --compare <file-a.json> <file-b.json>");
    process.exit(1);
  }
  compareFiles(join(GRADES_DIR, fileA), join(GRADES_DIR, fileB));
  process.exit(0);
}

function compareFiles(pathA: string, pathB: string) {
  const a = JSON.parse(readFileSync(pathA, "utf-8"));
  const b = JSON.parse(readFileSync(pathB, "utf-8"));
  const aMap = new Map(a.items.map((i: ItemGrade) => [i.item_id, i]));
  const bMap = new Map(b.items.map((i: ItemGrade) => [i.item_id, i]));
  const common = [...aMap.keys()].filter((id) => bMap.has(id));

  console.log(`Comparing ${common.length} common items`);

  const AXES = [
    "reasoning_depth", "decision_wisdom", "communication_clarity",
    "initiative_quality", "collaborative_intelligence",
    "self_awareness_calibration", "contextual_judgment",
  ] as const;

  let totalR = 0;
  let nAxes = 0;
  for (const axis of AXES) {
    const pairs: [number, number][] = [];
    for (const id of common) {
      const itemA = aMap.get(id) as ItemGrade;
      const itemB = bMap.get(id) as ItemGrade;
      const sa = itemA.scores[axis as keyof typeof itemA.scores]?.score;
      const sb = itemB.scores[axis as keyof typeof itemB.scores]?.score;
      if (sa != null && sb != null) pairs.push([sa as number, sb as number]);
    }
    if (pairs.length < 5) continue;
    const meanA = pairs.reduce((s, [a]) => s + a, 0) / pairs.length;
    const meanB = pairs.reduce((s, [, b]) => s + b, 0) / pairs.length;
    let num = 0, d1 = 0, d2 = 0;
    for (const [a, b] of pairs) {
      num += (a - meanA) * (b - meanB);
      d1 += (a - meanA) ** 2;
      d2 += (b - meanB) ** 2;
    }
    const r = d1 * d2 > 0 ? num / Math.sqrt(d1 * d2) : 0;
    const mad = pairs.reduce((s, [a, b]) => s + Math.abs(a - b), 0) / pairs.length;
    const pass = r >= 0.8 ? "PASS" : r >= 0.7 ? "MARGINAL" : "FAIL";
    console.log(`  ${axis}: r=${r.toFixed(3)}, MAD=${mad.toFixed(2)} [${pass}]`);
    totalR += r;
    nAxes++;
  }
  if (nAxes > 0) {
    console.log(`\n  Mean Pearson r: ${(totalR / nAxes).toFixed(3)} (>0.8 = stable, >0.7 = marginal)`);
  }
}

// ---- grading mode ----
async function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", "claude-opus-4-6"],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exit ${code}`));
      try {
        resolve(JSON.parse(out).result ?? "");
      } catch {
        reject(new Error(`parse fail: ${out.slice(0, 200)}`));
      }
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function buildPrompt(itemId: string, content: string, type: string): string {
  const rubric = loadRubric();
  const graderDoc = loadGraderPrompt();
  const match = graderDoc.match(/## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("cannot extract prompt template from grader-prompt-opus.md");
  return match[1]
    .replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric)
    .replace("{{ARTIFACT_TYPE}}", type)
    .replace("{{ARTIFACT_CONTENT}}", content)
    .replace("{{ITEM_ID}}", itemId)
    .replace("{{ISO_TIMESTAMP}}", new Date().toISOString());
}

function extractJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (m) try { return JSON.parse(m[1]); } catch { /* fall through */ }
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
  throw new Error("no JSON object found in response");
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(GRADES_DIR, `retest-${today}.json`);

  if (existsSync(outPath)) {
    console.log(`Output file already exists: ${outPath}`);
    console.log("Delete it to re-run, or use --compare to compare two sessions.");
    process.exit(0);
  }

  const allIds = listItemIds();
  // Shuffle and pick N items
  const shuffled = [...allIds].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(nItems, allIds.length));

  console.log(`Test-retest baseline: grading ${selected.length} items with claude-opus-4-6`);
  console.log(`Output: ${outPath}\n`);

  const gradesFile = emptyGradesFile(
    "claude-opus-4-6",
    "test-retest baseline — compare with a second run 7 days later",
  );
  gradesFile.items = [];

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < selected.length; i++) {
    const itemId = selected[i];
    console.log(`[${i + 1}/${selected.length}] ${itemId}`);
    try {
      const { content, type } = loadItem(itemId);
      const prompt = buildPrompt(itemId, content, type);
      const text = await callClaude(prompt);
      const parsed = extractJson(text) as { scores?: ItemGrade["scores"] };
      if (!parsed.scores) throw new Error("no scores field in response");
      const grade: ItemGrade = {
        item_id: itemId,
        grader: "claude-opus-4-6",
        rubric_version: RUBRIC_VERSION,
        prompt_version: "retest-v1",
        graded_at: new Date().toISOString(),
        scores: parsed.scores,
      };
      validateItemGrade(grade);
      gradesFile.items.push(grade);
      writeFileSync(outPath, JSON.stringify(gradesFile, null, 2));
      successCount++;
      console.log(`  OK`);
    } catch (err) {
      failureCount++;
      console.error(`  FAIL ${(err as Error).message}`);
    }
    if (i < selected.length - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone. Success: ${successCount}, Failures: ${failureCount}`);
  console.log(`Written to: ${outPath}`);
  console.log(`\nRun again in 7 days (${new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)}), then compare:`);
  console.log(`  bun run scripts/hear/test-retest.ts --compare retest-${today}.json retest-<date+7>.json`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
