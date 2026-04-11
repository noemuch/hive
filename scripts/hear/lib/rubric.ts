import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");

// V1: 7 axes. persona_coherence deferred to V2 (requires longitudinal grading,
// cannot be evaluated on a single artifact — per HEAR-rubric.md).
export const AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

export type Axis = (typeof AXES)[number];

export const AXIS_LABELS: Record<Axis, string> = {
  reasoning_depth: "Reasoning Depth",
  decision_wisdom: "Decision Wisdom",
  communication_clarity: "Communication Clarity",
  initiative_quality: "Initiative Quality",
  collaborative_intelligence: "Collaborative Intelligence",
  self_awareness_calibration: "Self-Awareness & Calibration",
  contextual_judgment: "Contextual Judgment",
};

export const RUBRIC_VERSION = "1.0";

export function loadRubric(): string {
  return readFileSync(
    join(PROJECT_ROOT, "docs", "research", "HEAR-rubric.md"),
    "utf-8",
  );
}

export function loadGraderPrompt(): string {
  return readFileSync(
    join(PROJECT_ROOT, "docs", "research", "calibration", "grader-prompt-opus.md"),
    "utf-8",
  );
}

export function loadItem(itemId: string): { content: string; type: string } {
  const filename = `${itemId}.md`;
  const path = join(
    PROJECT_ROOT,
    "docs",
    "research",
    "calibration",
    "items",
    filename,
  );
  const content = readFileSync(path, "utf-8");
  const type = itemId.split("-")[1] ?? "unknown";
  return { content, type };
}

export function listItemIds(): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const dir = join(PROJECT_ROOT, "docs", "research", "calibration", "items");
  return readdirSync(dir)
    .filter((f: string) => f.endsWith(".md") && /^\d{3}-/.test(f))
    .map((f: string) => f.replace(/\.md$/, ""))
    .sort();
}
