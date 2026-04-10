#!/usr/bin/env bun
/**
 * HEAR V1 — Human review CLI
 *
 * Interactive review of Opus pre-grades. For each item and each axis:
 *   [c] confirm Opus's score
 *   [a] adjust (enter new score + justification)
 *   [n] not gradable
 *   [?] help
 *   [q] quit (progress is saved)
 *
 * Writes incrementally to docs/research/calibration/grades/noe.json.
 * Resumable: re-running picks up where you left off.
 *
 * Usage:
 *   bun run scripts/hear/review.ts
 *   bun run scripts/hear/review.ts --grader alice    # override grader name
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AXES, AXIS_LABELS, listItemIds, loadItem, type Axis } from "./lib/rubric";
import {
  emptyGradesFile,
  type AxisScore,
  type GradesFile,
  type ItemGrade,
} from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const OPUS_GRADES_PATH = join(
  PROJECT_ROOT,
  "docs",
  "research",
  "calibration",
  "grades",
  "opus.json",
);

const args = process.argv.slice(2);
const graderName = args.includes("--grader")
  ? args[args.indexOf("--grader") + 1]
  : "noe";
const NOE_GRADES_PATH = join(
  PROJECT_ROOT,
  "docs",
  "research",
  "calibration",
  "grades",
  `${graderName}.json`,
);

// ---------- ANSI colors ----------

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function c(color: keyof typeof C, text: string): string {
  return `${C[color]}${text}${C.reset}`;
}

// ---------- State ----------

function loadOpusGrades(): GradesFile {
  if (!existsSync(OPUS_GRADES_PATH)) {
    console.error(c("red", `ERROR: Opus grades not found at ${OPUS_GRADES_PATH}`));
    console.error("Run pre-grade.ts first: bun run scripts/hear/pre-grade.ts");
    process.exit(1);
  }
  return JSON.parse(readFileSync(OPUS_GRADES_PATH, "utf-8"));
}

function loadOrCreateNoeGrades(): GradesFile {
  if (existsSync(NOE_GRADES_PATH)) {
    return JSON.parse(readFileSync(NOE_GRADES_PATH, "utf-8"));
  }
  return emptyGradesFile(graderName, `Human expert grader: ${graderName}`);
}

function saveNoeGrades(grades: GradesFile): void {
  grades.updated_at = new Date().toISOString();
  writeFileSync(NOE_GRADES_PATH, JSON.stringify(grades, null, 2));
}

// ---------- Stdin helpers ----------

async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    return decoder.decode(chunk).trim();
  }
  return "";
}

async function readChar(validChars: string): Promise<string> {
  while (true) {
    const input = await prompt("> ");
    const ch = input.toLowerCase().charAt(0);
    if (validChars.includes(ch)) return ch;
    console.log(c("red", `Invalid. Expected one of: ${validChars.split("").join(" ")}`));
  }
}

// ---------- Display ----------

function printHeader(itemId: string, itemIndex: number, totalItems: number): void {
  console.log("");
  console.log(c("cyan", "═".repeat(80)));
  console.log(
    c("bold", `Item ${itemIndex + 1}/${totalItems}: ${c("cyan", itemId)}`),
  );
  console.log(c("cyan", "═".repeat(80)));
  console.log("");
}

function printItemContent(itemId: string): void {
  const { content, type } = loadItem(itemId);
  console.log(c("dim", `─── Artifact type: ${type} ───`));
  console.log("");
  console.log(content);
  console.log("");
  console.log(c("dim", "─── End of artifact ───"));
  console.log("");
}

function printAxisPanel(axis: Axis, opusScore: AxisScore): void {
  console.log(c("bold", `[${AXIS_LABELS[axis]}]`));
  const scoreStr =
    opusScore.score === null ? "null (not gradable)" : String(opusScore.score);
  console.log(`  ${c("blue", "Opus score")}: ${scoreStr}  ${c("gray", `(confidence ${opusScore.confidence}/10)`)}`);
  console.log(`  ${c("blue", "Justification")}: ${opusScore.justification}`);
  if (opusScore.evidence_quotes.length > 0) {
    console.log(c("blue", "  Evidence:"));
    for (const quote of opusScore.evidence_quotes) {
      const display = quote.length > 120 ? quote.slice(0, 117) + "..." : quote;
      console.log(c("gray", `    "${display}"`));
    }
  }
  console.log("");
}

function printHelp(): void {
  console.log("");
  console.log(c("bold", "Commands:"));
  console.log("  " + c("green", "c") + " confirm Opus's score (fast path)");
  console.log("  " + c("yellow", "a") + " adjust — enter your own score and justification");
  console.log("  " + c("gray", "n") + " not gradable from this artifact");
  console.log("  " + c("cyan", "?") + " show this help");
  console.log("  " + c("red", "q") + " quit (progress saved)");
  console.log("");
}

// ---------- Interaction ----------

async function gradeAxis(
  axis: Axis,
  opusScore: AxisScore,
): Promise<AxisScore | null> {
  printAxisPanel(axis, opusScore);
  const action = await readChar("canq?");

  if (action === "q") return null;

  if (action === "?") {
    printHelp();
    return gradeAxis(axis, opusScore);
  }

  if (action === "c") {
    return {
      score: opusScore.score,
      justification: opusScore.justification,
      evidence_quotes: opusScore.evidence_quotes,
      confidence: 10, // confirmed
    };
  }

  if (action === "n") {
    const reason = await prompt("  Reason: ");
    return {
      score: null,
      justification: reason || "Not gradable from single artifact",
      evidence_quotes: [],
      confidence: 10,
    };
  }

  // Adjust
  const scoreStr = await prompt(c("yellow", "  New score (1-10): "));
  const score = Number.parseInt(scoreStr, 10);
  if (!Number.isFinite(score) || score < 1 || score > 10) {
    console.log(c("red", "  Invalid score, try again."));
    return gradeAxis(axis, opusScore);
  }
  const justification = await prompt(c("yellow", "  New justification: "));
  if (!justification) {
    console.log(c("red", "  Justification required, try again."));
    return gradeAxis(axis, opusScore);
  }
  return {
    score,
    justification,
    evidence_quotes: opusScore.evidence_quotes, // reuse Opus evidence
    confidence: 10,
  };
}

async function gradeItem(
  itemId: string,
  itemIndex: number,
  totalItems: number,
  opusGrade: ItemGrade,
): Promise<ItemGrade | null> {
  printHeader(itemId, itemIndex, totalItems);
  printItemContent(itemId);

  const scores: Partial<Record<Axis, AxisScore>> = {};
  for (const axis of AXES) {
    const opusAxisScore = opusGrade.scores[axis];
    const result = await gradeAxis(axis, opusAxisScore);
    if (result === null) return null; // quit
    scores[axis] = result;
  }

  return {
    item_id: itemId,
    grader: graderName,
    rubric_version: "1.0",
    graded_at: new Date().toISOString(),
    scores: scores as Record<Axis, AxisScore>,
  };
}

// ---------- Main ----------

async function main() {
  console.log(c("bold", "HEAR V1 — Human review session"));
  console.log(c("gray", `Grader: ${graderName}`));
  console.log(c("gray", `Rubric version: 1.0`));
  console.log("");

  const opusGrades = loadOpusGrades();
  const noeGrades = loadOrCreateNoeGrades();
  const alreadyGraded = new Set(noeGrades.items.map((i) => i.item_id));

  const allItemIds = listItemIds();
  const opusItemMap = new Map(opusGrades.items.map((i) => [i.item_id, i]));

  const toGrade = allItemIds.filter(
    (id) => !alreadyGraded.has(id) && opusItemMap.has(id),
  );

  console.log(`Total items: ${allItemIds.length}`);
  console.log(`Already graded by ${graderName}: ${alreadyGraded.size}`);
  console.log(`Remaining: ${toGrade.length}`);
  console.log("");

  if (toGrade.length === 0) {
    console.log(c("green", "All items graded. Nothing to do."));
    return;
  }

  console.log(c("yellow", "Reminder: grade no more than 10 items per session."));
  console.log(c("yellow", "Press ? at any score prompt for help. Press q to save and quit."));
  console.log("");

  for (let i = 0; i < toGrade.length; i++) {
    const itemId = toGrade[i];
    const opusGrade = opusItemMap.get(itemId)!;

    const grade = await gradeItem(itemId, i, toGrade.length, opusGrade);
    if (grade === null) {
      console.log(c("yellow", "\nQuitting. Progress saved."));
      break;
    }

    noeGrades.items.push(grade);
    saveNoeGrades(noeGrades);
    console.log(c("green", `✓ Saved ${itemId}`));
  }

  console.log("");
  console.log(c("bold", "Session complete."));
  console.log(`Grades written to: ${NOE_GRADES_PATH}`);
}

main().catch((err) => {
  console.error(c("red", `FATAL: ${err.message}`));
  process.exit(1);
});
