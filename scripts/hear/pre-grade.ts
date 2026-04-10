#!/usr/bin/env bun
/**
 * HEAR V1 — Opus pre-grading script
 *
 * Runs Claude Opus 4.6 against every calibration item to produce initial grades.
 * Output: docs/research/calibration/grades/opus.json
 *
 * Usage:
 *   bun run scripts/hear/pre-grade.ts
 *   bun run scripts/hear/pre-grade.ts --only 001-decision-excellent-wisdom
 *   bun run scripts/hear/pre-grade.ts --resume
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  AXES,
  listItemIds,
  loadGraderPrompt,
  loadItem,
  loadRubric,
  RUBRIC_VERSION,
} from "./lib/rubric";
import {
  emptyGradesFile,
  type GradesFile,
  type ItemGrade,
  validateItemGrade,
} from "./lib/schema";

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = "claude-opus-4-6";
const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const GRADES_PATH = join(
  PROJECT_ROOT,
  "docs",
  "research",
  "calibration",
  "grades",
  "opus.json",
);
const PROMPT_VERSION = "grader-opus-1.0";

if (!API_KEY) {
  console.error("ERROR: ANTHROPIC_API_KEY environment variable is required.");
  process.exit(1);
}

const args = process.argv.slice(2);
const onlyItem = args.includes("--only")
  ? args[args.indexOf("--only") + 1]
  : null;
const resume = args.includes("--resume");

function loadOrCreateGradesFile(): GradesFile {
  if (existsSync(GRADES_PATH) && resume) {
    const raw = readFileSync(GRADES_PATH, "utf-8");
    return JSON.parse(raw);
  }
  return emptyGradesFile(
    "claude-opus-4-6",
    "Claude Opus 4.6 with HEAR grader prompt v1.0",
  );
}

function saveGradesFile(grades: GradesFile): void {
  grades.updated_at = new Date().toISOString();
  writeFileSync(GRADES_PATH, JSON.stringify(grades, null, 2));
}

function buildPrompt(itemId: string, artifactContent: string, artifactType: string): string {
  const rubric = loadRubric();
  const graderPromptDoc = loadGraderPrompt();

  // Extract the prompt template from the doc (between ``` fences inside ## The prompt section)
  const match = graderPromptDoc.match(/## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error("could not extract prompt template from grader-prompt-opus.md");
  }
  let template = match[1];

  template = template.replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric);
  template = template.replace("{{ARTIFACT_TYPE}}", artifactType);
  template = template.replace("{{ARTIFACT_CONTENT}}", artifactContent);
  template = template.replace("{{ITEM_ID}}", itemId);
  template = template.replace("{{ISO_TIMESTAMP}}", new Date().toISOString());

  return template;
}

async function callAnthropic(prompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text;
  if (typeof content !== "string") {
    throw new Error("unexpected API response structure");
  }
  return content;
}

function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code block
    const match = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
    if (match) {
      return JSON.parse(match[1]);
    }
    // Try to find the first { ... } block
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      return JSON.parse(braceMatch[0]);
    }
    throw new Error("could not extract JSON from response");
  }
}

async function gradeItem(itemId: string): Promise<ItemGrade> {
  const { content, type } = loadItem(itemId);
  const prompt = buildPrompt(itemId, content, type);

  console.log(`  → calling Opus for ${itemId}...`);
  const startTime = Date.now();
  const responseText = await callAnthropic(prompt);
  const durationMs = Date.now() - startTime;
  console.log(`  ✓ received response in ${durationMs}ms`);

  const parsed = extractJson(responseText);
  const grade: ItemGrade = {
    item_id: itemId,
    grader: "claude-opus-4-6",
    rubric_version: RUBRIC_VERSION,
    prompt_version: PROMPT_VERSION,
    graded_at: new Date().toISOString(),
    scores: (parsed as { scores: ItemGrade["scores"] }).scores,
  };

  validateItemGrade(grade);
  return grade;
}

async function main() {
  const grades = loadOrCreateGradesFile();
  const alreadyGraded = new Set(grades.items.map((i) => i.item_id));

  let itemIds = listItemIds();
  if (onlyItem) {
    itemIds = itemIds.filter((id) => id === onlyItem);
    if (itemIds.length === 0) {
      console.error(`ERROR: item ${onlyItem} not found`);
      process.exit(1);
    }
  }

  const toGrade = itemIds.filter((id) => !alreadyGraded.has(id));
  console.log(`HEAR Opus pre-grading`);
  console.log(`Model: ${MODEL}`);
  console.log(`Rubric version: ${RUBRIC_VERSION}`);
  console.log(`Prompt version: ${PROMPT_VERSION}`);
  console.log(`Total items: ${itemIds.length}`);
  console.log(`Already graded: ${alreadyGraded.size}`);
  console.log(`To grade: ${toGrade.length}`);
  console.log("");

  let successCount = 0;
  let failureCount = 0;

  for (const itemId of toGrade) {
    console.log(`[${successCount + failureCount + 1}/${toGrade.length}] ${itemId}`);
    try {
      const grade = await gradeItem(itemId);
      grades.items.push(grade);
      saveGradesFile(grades);
      successCount++;
      console.log(`  ✓ saved`);
    } catch (err) {
      failureCount++;
      console.error(`  ✗ FAILED: ${(err as Error).message}`);
      // Continue with next item
    }
    console.log("");
  }

  console.log(`Done. Success: ${successCount}, Failures: ${failureCount}`);
  console.log(`Grades written to: ${GRADES_PATH}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
