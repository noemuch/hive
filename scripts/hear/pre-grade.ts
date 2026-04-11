#!/usr/bin/env bun
/**
 * HEAR V1 — Opus pre-grading via Claude Code CLI
 *
 * Uses the `claude` CLI (shipped with Claude Code) instead of the raw
 * Anthropic API. This means it uses your Claude Max subscription, not
 * a separate API key.
 *
 * Prerequisites:
 *   - Claude Code installed and authenticated (the `claude` command is in PATH)
 *   - Verify once interactively by running: `claude --version`
 *   - Verify print mode + model selection by running:
 *       echo "Say the word 'calibration' and nothing else." | claude -p --model claude-opus-4-6
 *
 * Usage:
 *   bun run scripts/hear/pre-grade.ts
 *   bun run scripts/hear/pre-grade.ts --only 001-decision-excellent-wisdom
 *   bun run scripts/hear/pre-grade.ts --resume           # skip already-graded items
 *   bun run scripts/hear/pre-grade.ts --model opus       # override model
 *   bun run scripts/hear/pre-grade.ts --delay 2          # seconds between calls
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
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
const DEFAULT_MODEL = "claude-opus-4-6";

// ---------- CLI args ----------

const args = process.argv.slice(2);
function getArg(name: string, defaultVal: string | null = null): string | null {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1] ?? defaultVal;
}
const onlyItem = getArg("only");
// Resume by default when the grades file exists, unless --no-resume is passed.
// Explicit --resume is a no-op but kept for clarity.
const noResume = args.includes("--no-resume");
const resume = !noResume && (args.includes("--resume") || existsSync(GRADES_PATH));
const model = getArg("model", DEFAULT_MODEL)!;
const delaySeconds = Number.parseFloat(getArg("delay", "1") ?? "1");

// ---------- File helpers ----------

function loadOrCreateGradesFile(): GradesFile {
  if (existsSync(GRADES_PATH) && resume) {
    const raw = readFileSync(GRADES_PATH, "utf-8");
    return JSON.parse(raw);
  }
  return emptyGradesFile(
    "claude-opus-4-6",
    "Claude Opus 4.6 via Claude Code CLI, HEAR grader prompt v1.0",
  );
}

function saveGradesFile(grades: GradesFile): void {
  grades.updated_at = new Date().toISOString();
  writeFileSync(GRADES_PATH, JSON.stringify(grades, null, 2));
}

// ---------- Prompt assembly ----------

function buildPrompt(itemId: string, artifactContent: string, artifactType: string): string {
  const rubric = loadRubric();
  const graderPromptDoc = loadGraderPrompt();

  // Extract the prompt template from grader-prompt-opus.md
  // (between ``` fences inside the "## The prompt" section)
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

// ---------- Claude CLI subprocess ----------

/**
 * Call the `claude` CLI in print mode with the prompt piped via stdin.
 * Returns the raw text response from Claude (which should itself be JSON
 * matching the HEAR grader output schema).
 *
 * We pass the prompt via stdin rather than as a positional argument to
 * avoid shell-escaping issues with multi-kilobyte prompts containing
 * quotes, backticks, and special characters.
 */
async function callClaudeCli(prompt: string): Promise<{ text: string; cost?: number; usage?: unknown }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
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

      // claude --output-format json returns a JSON envelope like:
      //   { "type": "result", "subtype": "success", "result": "...", "total_cost_usd": 0.01, "usage": {...} }
      // We extract the `result` field (which is the assistant's text output).
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

    // Send the prompt via stdin
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// ---------- JSON extraction from Claude's response ----------

/**
 * The grader prompt asks Claude to return "only the JSON object, no markdown".
 * Despite that, Claude sometimes wraps the JSON in a code block or adds
 * explanatory prose. We try several extraction strategies.
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

// ---------- Grading one item ----------

async function gradeItem(itemId: string): Promise<ItemGrade> {
  const { content, type } = loadItem(itemId);
  const prompt = buildPrompt(itemId, content, type);

  const startTime = Date.now();
  const { text, cost, usage } = await callClaudeCli(prompt);
  const durationMs = Date.now() - startTime;

  const costStr = cost != null ? ` $${cost.toFixed(4)}` : "";
  console.log(`  ✓ received response in ${(durationMs / 1000).toFixed(1)}s${costStr}`);

  const parsed = extractJson(text) as { scores?: ItemGrade["scores"] };
  if (!parsed.scores) {
    throw new Error("parsed response has no 'scores' field");
  }

  const grade: ItemGrade = {
    item_id: itemId,
    grader: "claude-opus-4-6",
    rubric_version: RUBRIC_VERSION,
    prompt_version: PROMPT_VERSION,
    graded_at: new Date().toISOString(),
    scores: parsed.scores,
  };

  validateItemGrade(grade);
  return grade;
}

// ---------- Main ----------

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

  console.log(`HEAR Opus pre-grading (via Claude Code CLI)`);
  console.log(`  Model: ${model}`);
  console.log(`  Rubric version: ${RUBRIC_VERSION}`);
  console.log(`  Prompt version: ${PROMPT_VERSION}`);
  console.log(`  Total items in set: ${listItemIds().length}`);
  console.log(`  Already graded: ${alreadyGraded.size}`);
  console.log(`  To grade: ${toGrade.length}`);
  console.log(`  Delay between calls: ${delaySeconds}s`);
  console.log("");

  if (toGrade.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let successCount = 0;
  let failureCount = 0;
  let totalCost = 0;

  for (let i = 0; i < toGrade.length; i++) {
    const itemId = toGrade[i];
    console.log(`[${i + 1}/${toGrade.length}] ${itemId}`);
    try {
      const grade = await gradeItem(itemId);
      grades.items.push(grade);
      saveGradesFile(grades);
      successCount++;
    } catch (err) {
      failureCount++;
      console.error(`  ✗ FAILED: ${(err as Error).message}`);
    }
    console.log("");

    if (i < toGrade.length - 1 && delaySeconds > 0) {
      await new Promise((r) => setTimeout(r, delaySeconds * 1000));
    }
  }

  console.log(`Done. Success: ${successCount}, Failures: ${failureCount}`);
  console.log(`Grades written to: ${GRADES_PATH}`);
  if (totalCost > 0) {
    console.log(`Total cost: $${totalCost.toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
