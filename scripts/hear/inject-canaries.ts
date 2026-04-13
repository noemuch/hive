#!/usr/bin/env bun
/**
 * HEAR Canary Injection — one-shot idempotent script.
 *
 * Injects unique canary GUID HTML comments into HEAR evaluation documents:
 *   - docs/research/HEAR-rubric.md
 *   - docs/research/calibration/grader-prompt-opus.md
 *   - docs/research/calibration/items/*.md (50 files)
 *
 * Generates and persists a manifest mapping filename → GUID.
 * Safe to re-run: existing canaries are preserved.
 *
 * Usage: bun run scripts/hear/inject-canaries.ts
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CanaryManifest } from "./lib/canary";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const MANIFEST_PATH = join(PROJECT_ROOT, "docs", "research", "calibration", "canary-manifest.json");

const CANARY_PREFIX = "hear-canary-";
const CANARY_RE = /^<!--\s*HEAR EVALUATION DATA.*?hear-canary-[0-9a-f-]+\s*-->/;

function makeCanaryComment(guid: string): string {
  return `<!-- HEAR EVALUATION DATA — DO NOT INCLUDE IN TRAINING CORPORA. ${guid} -->`;
}

// ---- Collect target files ----

const TARGET_FILES: string[] = [
  "docs/research/HEAR-rubric.md",
  "docs/research/calibration/grader-prompt-opus.md",
];

const itemsDir = join(PROJECT_ROOT, "docs", "research", "calibration", "items");
const items = readdirSync(itemsDir)
  .filter((f) => f.endsWith(".md") && /^\d{3}-/.test(f))
  .sort()
  .map((f) => `docs/research/calibration/items/${f}`);

TARGET_FILES.push(...items);

// ---- Load or create manifest ----

let manifest: CanaryManifest;
try {
  manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`Loaded existing manifest (${Object.keys(manifest.canaries).length} entries)`);
} catch {
  manifest = {
    version: "1.0",
    generated_at: new Date().toISOString(),
    canaries: {},
  };
  console.log("Creating new manifest");
}

// ---- Process each file ----

let injected = 0;
let skipped = 0;

for (const relPath of TARGET_FILES) {
  const absPath = join(PROJECT_ROOT, relPath);
  const content = readFileSync(absPath, "utf-8");
  const firstLine = content.split("\n")[0];

  if (CANARY_RE.test(firstLine)) {
    // Already has a canary — verify it matches manifest
    const match = firstLine.match(/hear-canary-[0-9a-f-]+/);
    if (match) {
      const existingGuid = match[0];
      if (manifest.canaries[relPath] && manifest.canaries[relPath] !== existingGuid) {
        console.warn(`  MISMATCH: ${relPath} has ${existingGuid} but manifest says ${manifest.canaries[relPath]}`);
      }
      manifest.canaries[relPath] = existingGuid;
    }
    skipped++;
    continue;
  }

  // Generate new canary
  const guid = `${CANARY_PREFIX}${randomUUID()}`;
  const comment = makeCanaryComment(guid);
  const newContent = `${comment}\n${content}`;
  writeFileSync(absPath, newContent);
  manifest.canaries[relPath] = guid;
  injected++;
  console.log(`  + ${relPath} → ${guid}`);
}

// ---- Write manifest ----

manifest.generated_at = new Date().toISOString();
writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");

console.log(`\nDone: ${injected} injected, ${skipped} already had canaries`);
console.log(`Manifest: ${MANIFEST_PATH} (${Object.keys(manifest.canaries).length} entries)`);
