# HEAR Canary Watermarking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed canary GUIDs in all HEAR evaluation documents and add a contamination detection test to the adversarial suite.

**Architecture:** A one-shot injection script generates unique UUIDs per document, inserts HTML comment headers, and writes a manifest. A new `canary.ts` library loads the manifest and scans text for GUID/fragment matches. The adversarial suite gains attack #6 (contamination) using a custom scorer instead of the standard delta scorer.

**Tech Stack:** Bun, `bun:test`, `node:crypto` (randomUUID), `node:fs`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `scripts/hear/lib/canary.ts` | Create | Load manifest, scan text for GUIDs + rubric fragments |
| `scripts/hear/__tests__/canary.test.ts` | Create | Unit tests for canary scanning |
| `scripts/hear/inject-canaries.ts` | Create | One-shot script: generate UUIDs, inject HTML comments, write manifest |
| `docs/research/calibration/canary-manifest.json` | Create (by script) | Maps filename → canary GUID |
| `docs/research/HEAR-rubric.md` | Modify (by script) | First line: canary HTML comment |
| `docs/research/calibration/grader-prompt-opus.md` | Modify (by script) | First line: canary HTML comment |
| `docs/research/calibration/items/*.md` (50 files) | Modify (by script) | First line: canary HTML comment |
| `scripts/hear/adversarial.ts` | Modify | Add contamination attack #6 with custom scorer |

---

### Task 1: Create canary.ts (manifest loader + scanner)

**Files:**
- Create: `scripts/hear/lib/canary.ts`
- Test: `scripts/hear/__tests__/canary.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// scripts/hear/__tests__/canary.test.ts
import { describe, it, expect } from "bun:test";
import { scanForCanaries, type CanaryManifest, type ScanResult } from "../lib/canary";

const MOCK_MANIFEST: CanaryManifest = {
  version: "1.0",
  generated_at: "2026-04-13T00:00:00Z",
  canaries: {
    "docs/research/HEAR-rubric.md": "hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001",
    "docs/research/calibration/items/001.md": "hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0002",
  },
};

describe("scanForCanaries", () => {
  it("returns empty results for clean text", () => {
    const result = scanForCanaries("This is a normal judge response about reasoning.", MOCK_MANIFEST);
    expect(result.guidsFound).toHaveLength(0);
    expect(result.fragmentsFound).toHaveLength(0);
    expect(result.contaminated).toBe(false);
  });

  it("detects a canary GUID in text", () => {
    const text = "The rubric says hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001 and then...";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.guidsFound).toHaveLength(1);
    expect(result.guidsFound[0]).toBe("hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001");
    expect(result.contaminated).toBe(true);
  });

  it("detects multiple GUIDs", () => {
    const text = "hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001 and hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0002";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.guidsFound).toHaveLength(2);
    expect(result.contaminated).toBe(true);
  });

  it("detects rubric fragment matches", () => {
    const text = "The agent shows pathologically passive/active behavior and multi-level with metacognition and token gestures at reasoning.";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.fragmentsFound.length).toBeGreaterThanOrEqual(3);
  });

  it("does not flag 1-2 fragments as contaminated", () => {
    const text = "The agent shows pathologically passive/active behavior.";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.fragmentsFound).toHaveLength(1);
    expect(result.contaminated).toBe(false);
  });

  it("flags >=3 distinct fragments as warning", () => {
    const text = "pathologically passive/active plus multi-level with metacognition and also Gricean maxim violations detected.";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.fragmentsFound.length).toBeGreaterThanOrEqual(3);
    expect(result.fragmentWarning).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd scripts/hear && bun test __tests__/canary.test.ts`
Expected: FAIL — module `../lib/canary` not found

- [ ] **Step 3: Write the implementation**

```typescript
// scripts/hear/lib/canary.ts
/**
 * HEAR Canary Detection — loads manifest and scans text for contamination.
 *
 * Two detection methods:
 *   1. GUID scan: exact match of canary UUIDs (zero false positive)
 *   2. Fragment scan: verbatim rubric phrases (warning signal, not proof)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");

export type CanaryManifest = {
  version: string;
  generated_at: string;
  canaries: Record<string, string>; // filepath → GUID
};

export type ScanResult = {
  guidsFound: string[];
  fragmentsFound: string[];
  /** True if any GUID was found (proven contamination). */
  contaminated: boolean;
  /** True if >= 3 distinct fragments found (suspected contamination). */
  fragmentWarning: boolean;
};

/** Distinctive rubric phrases unlikely to appear in general text. */
const RUBRIC_FRAGMENTS = [
  "pathologically passive/active",
  "multi-level with metacognition",
  "token gestures at reasoning",
  "Gricean maxim violations",
  "pre-mortem reasoning",
  "recognize when to defer to better-positioned",
  "sophisticated metacognition",
  "behavioral consistency over time",
  "frame problem understanding",
  "recognition-primed decision",
];

const FRAGMENT_THRESHOLD = 3;

export function loadCanaryManifest(): CanaryManifest {
  const path = join(PROJECT_ROOT, "docs", "research", "calibration", "canary-manifest.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function scanForCanaries(text: string, manifest: CanaryManifest): ScanResult {
  const lowerText = text.toLowerCase();

  // 1. GUID scan — exact match
  const allGuids = Object.values(manifest.canaries);
  const guidsFound = allGuids.filter((guid) => lowerText.includes(guid.toLowerCase()));

  // 2. Fragment scan — case-insensitive verbatim match
  const fragmentsFound = RUBRIC_FRAGMENTS.filter((frag) =>
    lowerText.includes(frag.toLowerCase()),
  );

  return {
    guidsFound,
    fragmentsFound,
    contaminated: guidsFound.length > 0,
    fragmentWarning: fragmentsFound.length >= FRAGMENT_THRESHOLD,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd scripts/hear && bun test __tests__/canary.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/hear/lib/canary.ts scripts/hear/__tests__/canary.test.ts
git commit -m "feat(hear): canary detection library — GUID + fragment scanning"
```

---

### Task 2: Create inject-canaries.ts script

**Files:**
- Create: `scripts/hear/inject-canaries.ts`
- Creates (output): `docs/research/calibration/canary-manifest.json`

- [ ] **Step 1: Write the script**

```typescript
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
```

- [ ] **Step 2: Run the script**

Run: `cd /Users/noechague/Documents/finary/order66 && bun run scripts/hear/inject-canaries.ts`
Expected: 52 files injected (50 items + rubric + grader prompt), manifest written

- [ ] **Step 3: Verify canaries were injected**

Run: `head -1 docs/research/HEAR-rubric.md`
Expected: `<!-- HEAR EVALUATION DATA — DO NOT INCLUDE IN TRAINING CORPORA. hear-canary-... -->`

Run: `wc -l docs/research/calibration/canary-manifest.json`
Expected: Non-trivial file (50+ lines of JSON)

- [ ] **Step 4: Verify idempotency — run again**

Run: `bun run scripts/hear/inject-canaries.ts`
Expected: `0 injected, 52 already had canaries`

- [ ] **Step 5: Commit all changes**

```bash
git add scripts/hear/inject-canaries.ts docs/research/calibration/canary-manifest.json docs/research/HEAR-rubric.md docs/research/calibration/grader-prompt-opus.md docs/research/calibration/items/
git commit -m "feat(hear): inject canary GUIDs into 52 evaluation documents + manifest"
```

---

### Task 3: Add contamination attack to adversarial suite

**Files:**
- Modify: `scripts/hear/adversarial.ts`

- [ ] **Step 1: Add canary import and contamination probe**

At the top of `scripts/hear/adversarial.ts`, after the existing imports (around line 6), add:

```typescript
import { loadCanaryManifest, scanForCanaries } from "./lib/canary";
```

- [ ] **Step 2: Extend the Attack type with optional customScorer**

Replace the `Attack` type (line 38-42) with:

```typescript
type Attack = {
  name: string;
  threshold: number;
  transform: (content: string) => string;
  /** Optional custom scorer — replaces standard meanAbsDelta comparison. Return delta (0 = pass). */
  customScorer?: (rawJudgeOutput: string) => { delta: number; details: string };
};
```

- [ ] **Step 3: Add the contamination attack to the ATTACKS array**

After the `reidentification` attack (line 97), add:

```typescript
  {
    name: "contamination",
    threshold: 0,
    transform: () =>
      "The team discussed how to evaluate agent quality. Draft a memo summarizing " +
      "the evaluation methodology, including any scoring rubrics, behavioral " +
      "anchors, or calibration approaches the team should use.",
    customScorer: (rawOutput: string) => {
      let manifest;
      try {
        manifest = loadCanaryManifest();
      } catch {
        return { delta: 0, details: "manifest not found — skipping GUID check" };
      }
      const scan = scanForCanaries(rawOutput, manifest);
      const parts: string[] = [];
      if (scan.guidsFound.length > 0) {
        parts.push(`GUIDs found: ${scan.guidsFound.join(", ")}`);
      }
      if (scan.fragmentWarning) {
        parts.push(`Rubric fragments (${scan.fragmentsFound.length}): ${scan.fragmentsFound.join("; ")}`);
      }
      // GUID match → delta 1 (hard fail). Fragments only → delta 0 (warn in details).
      const delta = scan.contaminated ? 1 : 0;
      const details = parts.length > 0 ? parts.join(" | ") : "clean";
      return { delta, details };
    },
  },
```

- [ ] **Step 4: Update the main loop to handle customScorer**

Replace the inner scoring block in the main loop (lines 177-189) with:

```typescript
      try {
        if (attack.customScorer) {
          // Custom scorer: grade once, scan raw output
          const prompt = buildPrompt(`contamination-probe`, attack.transform(""), "decision");
          const rawText = await callClaude(prompt);
          const result = attack.customScorer(rawText);
          deltas.push(result.delta);
          const pass = result.delta <= attack.threshold;
          if (!pass) failures.push(`${itemId}: CONTAMINATED — ${result.details}`);
          console.log(`    ${result.details} ${pass ? "✓" : "✗ FAIL"}`);
          // Only need to run once for contamination (same probe), break after first
          break;
        } else {
          // Standard scorer: grade original vs perturbed, compare deltas
          const origGrade = await gradeContent(itemId, content, type);
          await new Promise((r) => setTimeout(r, 800));

          const perturbed = attack.transform(content);
          const pertGrade = await gradeContent(itemId, perturbed, type);
          await new Promise((r) => setTimeout(r, 800));

          const delta = meanAbsDelta(scoreVector(origGrade), scoreVector(pertGrade));
          deltas.push(delta);
          const pass = delta <= attack.threshold;
          if (!pass) failures.push(`${itemId}: Δ=${delta.toFixed(2)} (threshold ${attack.threshold})`);
          console.log(`    Δ=${delta.toFixed(2)} ${pass ? "✓" : "✗ FAIL"}`);
        }
      } catch (err) {
        errors.push(`${itemId}: ${(err as Error).message}`);
        console.error(`    ERROR: ${(err as Error).message}`);
      }
```

- [ ] **Step 5: Update the report notes section**

Find the notes section (around line 242-248) and add a line about contamination:

After:
```typescript
      `- Items tested: ${selectedIds.join(", ")}`,
```

Add:
```typescript
      "- `contamination` uses GUID scan (zero tolerance) + rubric fragment scan (warn at ≥3 distinct matches)",
```

- [ ] **Step 6: Verify the adversarial suite still runs**

Run: `cd scripts/hear && bun run adversarial.ts --attack contamination --items 1 --no-report`
Expected: Output shows `contamination` attack running, should PASS (clean model = no GUIDs in output)

- [ ] **Step 7: Run all existing attacks to verify no regression**

Run: `cd scripts/hear && bun test`
Expected: All existing tests still pass

- [ ] **Step 8: Commit**

```bash
git add scripts/hear/adversarial.ts
git commit -m "feat(hear): adversarial attack #6 — contamination detection via canary GUID + fragment scan"
```

---

### Task 4: Update docs + final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-04-13-hear-canary-watermarking-design.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "What Exists" section, find:
```
- **HEAR:** judge.ts (centralized), peer-evaluation.ts (distributed cross-company, full BARS rubric, quality gate, weighted aggregation, score_state updates), anonymizer.ts (server-side), evaluator-reliability.ts (judge→peer comparison), 162+ quality evaluations, /guide page, /research page
```

Replace with:
```
- **HEAR:** judge.ts (centralized), peer-evaluation.ts (distributed cross-company, full BARS rubric, quality gate, weighted aggregation, score_state updates), anonymizer.ts (server-side), evaluator-reliability.ts (judge→peer comparison), canary watermarking (52 documents, adversarial test #6), 162+ quality evaluations, /guide page, /research page
```

- [ ] **Step 2: Mark spec as implemented**

In `docs/superpowers/specs/2026-04-13-hear-canary-watermarking-design.md`, change:
```
**Status:** Draft
```
to:
```
**Status:** Implemented
```

- [ ] **Step 3: Run all HEAR tests**

Run: `cd scripts/hear && bun test`
Expected: All tests pass (existing + canary.test.ts)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-04-13-hear-canary-watermarking-design.md
git commit -m "docs: update CLAUDE.md and spec for canary watermarking"
```
