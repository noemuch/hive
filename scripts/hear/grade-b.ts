#!/usr/bin/env bun
/**
 * HEAR V1 — Independent Grader B.
 *
 * Same rubric as Grader A (pre-grade.ts), but uses a DIFFERENT analytical
 * lens: "skeptical second-order reader" vs Grader A's "structural reader".
 * This creates genuine independence for inter-rater reliability.
 *
 * Output: docs/research/calibration/grades/grader-b.json
 *
 * Usage:
 *   bun run scripts/hear/grade-b.ts
 *   bun run scripts/hear/grade-b.ts --resume     # skip already-graded items
 *   bun run scripts/hear/grade-b.ts --only 001   # single item
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { listItemIds, loadItem, loadRubric, loadGraderPrompt, RUBRIC_VERSION } from "./lib/rubric";
import { callClaude, extractJson } from "./lib/claude";
import { type ItemGrade, type GradesFile, validateItemGrade, emptyGradesFile } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const OUTPUT_PATH = join(PROJECT_ROOT, "docs", "research", "calibration", "grades", "grader-b.json");

const args = process.argv.slice(2);
const resume = args.includes("--resume");
const onlyIdx = args.indexOf("--only");
const onlyId = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

// Grader B preamble: skeptical second-order reader (different from Grader A's structural reader)
const GRADER_B_PREAMBLE = `You are HEAR Grader B — a skeptical, second-order reader. Focus on what the artifact OMITS: unstated assumptions, missing alternatives, consequences not anticipated, second-order effects not considered. Be willing to disagree with a surface-level reading. Grade independently and do not anchor to other graders. If the artifact looks polished on the surface, dig deeper — what's missing beneath the rhetoric?

`;

function buildPrompt(itemId: string, content: string, type: string): string {
  const rubric = loadRubric();
  const graderDoc = loadGraderPrompt();
  const match = graderDoc.match(/## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("cannot extract prompt template from grader-prompt-opus.md");
  const base = match[1]
    .replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric)
    .replace("{{ARTIFACT_TYPE}}", type)
    .replace("{{ARTIFACT_CONTENT}}", content)
    .replace("{{ITEM_ID}}", itemId)
    .replace("{{ISO_TIMESTAMP}}", new Date().toISOString());
  // Prepend the skeptical reader preamble
  return GRADER_B_PREAMBLE + base;
}

async function main() {
  const allIds = onlyId ? [onlyId] : listItemIds();

  // Load or create grades file
  let grades: GradesFile;
  if (resume && existsSync(OUTPUT_PATH)) {
    grades = JSON.parse(readFileSync(OUTPUT_PATH, "utf-8"));
    console.log(`Resuming: ${grades.items.length}/${allIds.length} already graded`);
  } else {
    grades = emptyGradesFile("claude-opus-4-6-grader-b", "Skeptical second-order reader — focuses on omissions, unstated assumptions, missing alternatives");
  }

  const gradedIds = new Set(grades.items.map((i) => i.item_id));
  const toGrade = allIds.filter((id) => !gradedIds.has(id));

  console.log(`HEAR Grader B — ${toGrade.length} items to grade`);
  console.log(`  Prompt: skeptical second-order reader`);
  console.log(`  Output: ${OUTPUT_PATH}`);
  console.log("");

  let count = 0;
  for (const itemId of toGrade) {
    count++;
    const { content, type } = loadItem(itemId);
    console.log(`[${count}/${toGrade.length}] ${itemId} (${type})`);

    try {
      const prompt = buildPrompt(itemId, content, type);
      const text = await callClaude(prompt);
      const parsed = extractJson(text) as { scores?: ItemGrade["scores"] };

      if (!parsed.scores) {
        console.error(`  ERROR: no scores field in response`);
        continue;
      }

      const grade: ItemGrade = {
        item_id: itemId,
        grader: "claude-opus-4-6-grader-b",
        rubric_version: RUBRIC_VERSION,
        prompt_version: "grader-b-v1.0",
        graded_at: new Date().toISOString(),
        scores: parsed.scores,
      };

      validateItemGrade(grade);
      grades.items.push(grade);
      grades.updated_at = new Date().toISOString();

      // Save incrementally
      writeFileSync(OUTPUT_PATH, JSON.stringify(grades, null, 2));

      // Print summary
      const axes = Object.entries(grade.scores)
        .filter(([, v]) => v.score !== null)
        .map(([k, v]) => `${k.slice(0, 4)}:${v.score}`)
        .join(" ");
      console.log(`  ✓ ${axes}`);

      // Rate limit: 800ms between calls
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
    }
  }

  console.log(`\nDone: ${grades.items.length}/${allIds.length} items graded`);
  console.log(`Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
