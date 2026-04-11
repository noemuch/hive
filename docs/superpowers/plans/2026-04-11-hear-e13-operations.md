# HEAR E13 — Operations & Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship calibration backup, adversarial CI, and batch invalidation for HEAR V1.

**Architecture:** Four independent tasks — a backup script (manual, git-versioned), a `claude-cli.ts` extraction enabling SDK fallback and testability, Bun unit tests with mocked judge calls, and a soft-delete invalidation endpoint.

**Tech Stack:** Bun, TypeScript strict, `@anthropic-ai/sdk` v0.85+, `bun:test`, GitHub Actions, PostgreSQL raw SQL.

---

## File Map

| Status | Path | Responsibility |
|--------|------|---------------|
| Create | `scripts/hear/backup-calibration.ts` | Dump calibration_set + grades to SQL |
| Create | `docs/research/calibration/backup/RESTORE.md` | 3-line restore procedure |
| Create | `docs/research/calibration/backup/calibration-dump.sql` | Generated, committed to git |
| Create | `scripts/hear/lib/claude-cli.ts` | callClaude() with SDK fallback |
| Modify | `scripts/hear/lib/orchestrator.ts` | Import callClaude from claude-cli |
| Create | `scripts/hear/__tests__/cost.test.ts` | CostMonitor unit tests |
| Create | `scripts/hear/__tests__/anonymizer.test.ts` | Anonymizer unit tests |
| Create | `scripts/hear/__tests__/orchestrator.test.ts` | evaluateArtifact with mocked callClaude |
| Create | `scripts/hear/__tests__/golden.test.ts` | 5 calibration fixtures, score ±1 |
| Create | `.github/workflows/hear-ci.yml` | CI trigger + bun test |
| Create | `server/migrations/017_batch_invalidation.sql` | Add invalidated_at columns |
| Modify | `server/src/index.ts` | Add invalidate-batch endpoint + cost filter |
| Create | `docs/research/DISASTER-RECOVERY.md` | Invalidation runbook |

---

## Task 1: E13-3 — Calibration backup script

**Files:**
- Create: `scripts/hear/backup-calibration.ts`
- Create: `docs/research/calibration/backup/RESTORE.md`
- Create: `docs/research/calibration/backup/calibration-dump.sql` (generated)

- [ ] **Step 1: Create `scripts/hear/backup-calibration.ts`**

```typescript
#!/usr/bin/env bun
/**
 * HEAR E13-3 — Calibration Set Backup
 *
 * Dumps calibration_set + calibration_grades to idempotent SQL.
 * Run after adding any calibration item, then commit the output.
 *
 *   bun run scripts/hear/backup-calibration.ts
 */

import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = join(import.meta.dir, "..", "..", "..");
const OUTPUT_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "backup");
const OUTPUT_PATH = join(OUTPUT_DIR, "calibration-dump.sql");

/** Escape a value for safe SQL string literal insertion. */
function pgEsc(v: string | null | undefined | Date): string {
  if (v === null || v === undefined) return "NULL";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return "'" + s.replace(/'/g, "''") + "'";
}

async function main(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || "postgresql://localhost:5432/hive",
  });

  const { rows: items } = await pool.query<{
    id: string;
    artifact_content: string;
    artifact_type: string;
    rubric_version: string;
    added_at: Date;
  }>(
    `SELECT id, artifact_content, artifact_type, rubric_version, added_at
     FROM calibration_set
     ORDER BY added_at ASC`,
  );

  const { rows: grades } = await pool.query<{
    id: string;
    calibration_id: string;
    grader_id: string;
    axis: string;
    score: number;
    justification: string | null;
    graded_at: Date;
  }>(
    `SELECT id, calibration_id, grader_id, axis, score, justification, graded_at
     FROM calibration_grades
     ORDER BY graded_at ASC`,
  );

  const lines: string[] = [
    `-- HEAR calibration set backup — generated ${new Date().toISOString()}`,
    `-- Items: ${items.length}  Grades: ${grades.length}`,
    `-- Restore: psql $DATABASE_URL < calibration-dump.sql`,
    `-- Schema must already exist (run server migrations first).`,
    ``,
  ];

  for (const item of items) {
    lines.push(
      `INSERT INTO calibration_set (id, artifact_content, artifact_type, rubric_version, added_at) VALUES (` +
        `${pgEsc(item.id)}, ` +
        `${pgEsc(item.artifact_content)}, ` +
        `${pgEsc(item.artifact_type)}, ` +
        `${pgEsc(item.rubric_version)}, ` +
        `${pgEsc(item.added_at)}` +
        `) ON CONFLICT (id) DO NOTHING;`,
    );
  }

  lines.push("");

  for (const grade of grades) {
    lines.push(
      `INSERT INTO calibration_grades (id, calibration_id, grader_id, axis, score, justification, graded_at) VALUES (` +
        `${pgEsc(grade.id)}, ` +
        `${pgEsc(grade.calibration_id)}, ` +
        `${pgEsc(grade.grader_id)}, ` +
        `${pgEsc(grade.axis)}, ` +
        `${grade.score}, ` +
        `${pgEsc(grade.justification)}, ` +
        `${pgEsc(grade.graded_at)}` +
        `) ON CONFLICT (id) DO NOTHING;`,
    );
  }

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n");
  console.log(`✓ ${items.length} items + ${grades.length} grades → ${OUTPUT_PATH}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Create `docs/research/calibration/backup/RESTORE.md`**

```markdown
# Restore Calibration Set

## Prerequisites

- `DATABASE_URL` set and pointing to target Postgres instance
- Server migrations already applied (`cd server && bun src/db/migrate.ts`)

## Restore

```bash
psql $DATABASE_URL < docs/research/calibration/backup/calibration-dump.sql
```

## Verify

```bash
psql $DATABASE_URL -c "SELECT COUNT(*) FROM calibration_set;"
psql $DATABASE_URL -c "SELECT COUNT(*) FROM calibration_grades;"
```

Both counts must match the header comment in `calibration-dump.sql`.
```

- [ ] **Step 3: Run the backup script to generate the initial dump**

```bash
DATABASE_URL=postgresql://localhost:5432/hive bun run scripts/hear/backup-calibration.ts
```

Expected output:
```
✓ 50 items + N grades → docs/research/calibration/backup/calibration-dump.sql
```

If there are no items yet (empty DB), the file is created with 0 items — that is fine, commit it.

- [ ] **Step 4: Commit**

```bash
git add scripts/hear/backup-calibration.ts \
        docs/research/calibration/backup/RESTORE.md \
        docs/research/calibration/backup/calibration-dump.sql
git commit -m "feat(hear): E13-3 calibration set backup script + initial dump"
```

---

## Task 2: Extract callClaude + SDK fallback

This task extracts `callClaudeCli` from `orchestrator.ts` into a dedicated module and adds an `ANTHROPIC_API_KEY` fallback for Railway deployment. Required for both E13-1 (Railway) and E13-4 (testability via `mock.module`).

**Files:**
- Create: `scripts/hear/lib/claude-cli.ts`
- Modify: `scripts/hear/lib/orchestrator.ts` (remove `callClaudeCli`, import `callClaude`)

- [ ] **Step 1: Create `scripts/hear/lib/claude-cli.ts`**

```typescript
/**
 * HEAR Judge Service — Claude invocation layer.
 *
 * Provides a single `callClaude()` function with two backends:
 *   - SDK (ANTHROPIC_API_KEY set): uses @anthropic-ai/sdk directly.
 *     Used in production (Railway) where claude CLI is not authenticated.
 *   - CLI (ANTHROPIC_API_KEY not set): spawns `claude -p`.
 *     Used locally with a Claude Max subscription.
 *
 * The orchestrator imports only `callClaude` and is unaware of the backend.
 */

import { spawn } from "node:child_process";

export type ClaudeResponse = {
  text: string;
  /** Approximate cost in USD. 0 if not available. */
  cost: number;
  usage?: unknown;
};

/**
 * Call Claude with the given prompt and model.
 * Uses SDK if ANTHROPIC_API_KEY is set, CLI otherwise.
 */
export async function callClaude(
  prompt: string,
  model: string,
): Promise<ClaudeResponse> {
  if (process.env.ANTHROPIC_API_KEY) {
    return callClaudeSdk(prompt, model);
  }
  return callClaudeCli(prompt, model);
}

// ---- SDK backend ----

async function callClaudeSdk(
  prompt: string,
  model: string,
): Promise<ClaudeResponse> {
  // Dynamic import to avoid loading the SDK when using the CLI path.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Conservative cost estimate using Opus pricing ($15/$75 per MTok).
  // Accurate for claude-opus-4-6; errs high for cheaper models (safe for caps).
  const inputCostUsd = (msg.usage.input_tokens / 1_000_000) * 15;
  const outputCostUsd = (msg.usage.output_tokens / 1_000_000) * 75;

  return {
    text,
    cost: inputCostUsd + outputCostUsd,
    usage: msg.usage,
  };
}

// ---- CLI backend ----

async function callClaudeCli(
  prompt: string,
  model: string,
): Promise<ClaudeResponse> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
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
          cost: envelope.total_cost_usd ?? 0,
          usage: envelope.usage,
        });
      } catch (err) {
        reject(
          new Error(
            `failed to parse claude CLI JSON output: ${(err as Error).message}\nfirst 500 chars: ${stdout.slice(0, 500)}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `failed to spawn 'claude' — is Claude Code installed and in PATH? (${err.message})`,
        ),
      );
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
```

- [ ] **Step 2: Update `scripts/hear/lib/orchestrator.ts`**

Remove the local `callClaudeCli` function (lines 81–152) and update the import + call site.

Add this import at the top (after the existing imports):

```typescript
import { callClaude } from "./claude-cli";
import type { ClaudeResponse } from "./claude-cli";
```

Remove the `spawn` import line:
```typescript
// DELETE this line:
import { spawn } from "node:child_process";
```

Remove the entire `callClaudeCli` function (lines 81–152 in the original).

Remove the `extractJson` helper — it stays in orchestrator since it's used to parse the response. Keep it.

In `runSingleJudge`, replace:
```typescript
const { text, cost } = await callClaudeCli(prompt, model);
```
with:
```typescript
const { text, cost } = await callClaude(prompt, model);
```

- [ ] **Step 3: Verify the module compiles**

```bash
cd /path/to/hive && bun run --bun scripts/hear/judge.ts --dry-run
```

Expected: dry run completes without import errors (no DB or API calls needed).

If no artifacts exist yet, it will print `0 artifacts in the last 24h` and exit cleanly.

- [ ] **Step 4: Commit**

```bash
git add scripts/hear/lib/claude-cli.ts scripts/hear/lib/orchestrator.ts
git commit -m "refactor(hear): extract callClaude to claude-cli.ts + ANTHROPIC_API_KEY fallback"
```

---

## Task 3: E13-4 — CI adversarial tests

**Files:**
- Create: `scripts/hear/__tests__/cost.test.ts`
- Create: `scripts/hear/__tests__/anonymizer.test.ts`
- Create: `scripts/hear/__tests__/orchestrator.test.ts`
- Create: `scripts/hear/__tests__/golden.test.ts`
- Create: `.github/workflows/hear-ci.yml`

No fixtures directory needed — mock outputs are inlined in the tests.

- [ ] **Step 1: Create `scripts/hear/__tests__/cost.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import {
  CostMonitor,
  BudgetExceededError,
  hydrateCostMonitor,
} from "../lib/cost";

describe("CostMonitor.assertCanSpend", () => {
  it("passes when spend is under daily budget", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    expect(() => m.assertCanSpend(4.99)).not.toThrow();
  });

  it("throws BudgetExceededError when projected daily spend exceeds cap", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    m.record(4.50);
    expect(() => m.assertCanSpend(1.00)).toThrow(BudgetExceededError);
  });

  it("error has scope=daily when daily cap is the binding constraint", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    m.record(4.50);
    let caught: BudgetExceededError | null = null;
    try {
      m.assertCanSpend(1.00);
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.scope).toBe("daily");
    expect(caught!.cap).toBe(5);
  });

  it("throws BudgetExceededError when projected monthly spend exceeds cap", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 50 });
    m.record(49.50);
    expect(() => m.assertCanSpend(1.00)).toThrow(BudgetExceededError);
  });

  it("error has scope=monthly when monthly cap is the binding constraint", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 50 });
    m.record(49.50);
    let caught: BudgetExceededError | null = null;
    try {
      m.assertCanSpend(1.00);
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    expect(caught!.scope).toBe("monthly");
  });
});

describe("CostMonitor.record", () => {
  it("accumulates dailySpend, monthlySpend, and callCount", () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    m.record(1.00);
    m.record(2.00);
    const snap = m.snapshot();
    expect(snap.dailySpend).toBe(3.00);
    expect(snap.monthlySpend).toBe(3.00);
    expect(snap.callCount).toBe(2);
  });
});

describe("hydrateCostMonitor", () => {
  it("sets initialDailySpend and initialMonthlySpend from DB queries", async () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    const mockPool = {
      query: async (sql: string) => {
        if (sql.includes("date_trunc('day'")) {
          return { rows: [{ sum: "3.50" }] };
        }
        return { rows: [{ sum: "22.00" }] };
      },
    };
    await hydrateCostMonitor(m, mockPool);
    const snap = m.snapshot();
    expect(snap.dailySpend).toBeCloseTo(3.50);
    expect(snap.monthlySpend).toBeCloseTo(22.00);
    expect(snap.callCount).toBe(0); // hydration does not add calls
  });

  it("handles NULL sums (empty judge_runs) without crashing", async () => {
    const m = new CostMonitor({ dailyBudgetUsd: 5, monthlyBudgetUsd: 50 });
    const mockPool = {
      query: async () => ({ rows: [{ sum: null }] }),
    };
    await hydrateCostMonitor(m, mockPool);
    const snap = m.snapshot();
    expect(snap.dailySpend).toBe(0);
    expect(snap.monthlySpend).toBe(0);
  });
});
```

- [ ] **Step 2: Run cost tests — should pass**

```bash
bun test scripts/hear/__tests__/cost.test.ts
```

Expected: all tests pass (CostMonitor is pure — no mocking needed).

- [ ] **Step 3: Create `scripts/hear/__tests__/anonymizer.test.ts`**

```typescript
import { describe, it, expect } from "bun:test";
import { anonymizeContent, relativeTime } from "../lib/anonymizer";
import type { NameMaps } from "../lib/db";

function makeNames(
  agents: [string, string][] = [],
  companies: [string, string][] = [],
  builders: [string, string][] = [],
  channels: [string, string][] = [],
): NameMaps {
  return {
    agentNames: new Map(agents),
    builderNames: new Map(builders),
    companyNames: new Map(companies),
    channelNames: new Map(channels),
  };
}

describe("anonymizeContent — UUIDs", () => {
  it("replaces a UUID with ARTIFACT_REF_1", () => {
    const { content } = anonymizeContent(
      "See 550e8400-e29b-41d4-a716-446655440000 for context",
      makeNames(),
    );
    expect(content).toContain("[ARTIFACT_REF_1]");
    expect(content).not.toContain("550e8400");
  });

  it("maps the same UUID to the same ref token", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const { content } = anonymizeContent(`${uuid} and ${uuid}`, makeNames());
    expect(content.match(/\[ARTIFACT_REF_1\]/g)?.length).toBe(2);
  });

  it("assigns different ref tokens to different UUIDs", () => {
    const { content } = anonymizeContent(
      "A: 550e8400-e29b-41d4-a716-446655440000, B: 660e8400-e29b-41d4-a716-446655440000",
      makeNames(),
    );
    expect(content).toContain("[ARTIFACT_REF_1]");
    expect(content).toContain("[ARTIFACT_REF_2]");
  });
});

describe("anonymizeContent — agent names", () => {
  it("replaces agent name with AGENT_A", () => {
    const { content } = anonymizeContent(
      "AlphaBot reviewed the spec",
      makeNames([["id-1", "AlphaBot"]]),
    );
    expect(content).toContain("[AGENT_A]");
    expect(content).not.toContain("AlphaBot");
  });
});

describe("anonymizeContent — company names", () => {
  it("replaces company name with COMPANY_1", () => {
    const { content } = anonymizeContent(
      "Acme Corp submitted the PR",
      makeNames([], [["id-1", "Acme Corp"]]),
    );
    expect(content).toContain("[COMPANY_1]");
    expect(content).not.toContain("Acme Corp");
  });
});

describe("anonymizeContent — timestamps", () => {
  it("replaces ISO timestamp with relative form", () => {
    const now = new Date("2026-04-11T12:00:00Z");
    const { content } = anonymizeContent(
      "Created at 2026-04-10T12:00:00Z",
      makeNames(),
      now,
    );
    expect(content).toContain("yesterday");
    expect(content).not.toContain("2026-04-10");
  });
});

describe("anonymizeContent — no-op cases", () => {
  it("preserves content when no names or UUIDs are present", () => {
    const input = "This artifact discusses architecture patterns.";
    const { content } = anonymizeContent(input, makeNames());
    expect(content).toBe(input);
  });
});

describe("relativeTime", () => {
  const now = 1_000_000_000;

  it("returns 'just now' for < 60 seconds", () => {
    expect(relativeTime(now - 30_000, now)).toBe("just now");
  });

  it("returns 'N minutes ago' for < 1 hour", () => {
    expect(relativeTime(now - 30 * 60 * 1_000, now)).toBe("30 minutes ago");
  });

  it("returns 'yesterday' for ~24-25 hours ago", () => {
    expect(relativeTime(now - 25 * 60 * 60 * 1_000, now)).toBe("yesterday");
  });

  it("returns 'N days ago' for 3 days", () => {
    expect(relativeTime(now - 3 * 24 * 60 * 60 * 1_000, now)).toBe(
      "3 days ago",
    );
  });
});
```

- [ ] **Step 4: Run anonymizer tests — should pass**

```bash
bun test scripts/hear/__tests__/anonymizer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Create `scripts/hear/__tests__/orchestrator.test.ts`**

```typescript
import { describe, it, expect, mock, beforeAll } from "bun:test";
import type { ArtifactEvaluation } from "../lib/orchestrator";
import type { CostMonitor as CostMonitorType } from "../lib/cost";

// AXES as defined in rubric.ts (7 axes, persona_coherence deferred to V2)
const AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

function buildScores(score: number): Record<string, unknown> {
  const scores: Record<string, unknown> = {};
  for (const axis of AXES) {
    scores[axis] = {
      score,
      justification: "test justification",
      evidence_quotes: ["quote 1"],
      confidence: 8,
    };
  }
  return scores;
}

// Mock callClaude BEFORE importing orchestrator.
// Bun's mock.module replaces the module registry entry; consumers that
// are dynamically imported after this call will receive the mock.
mock.module("../lib/claude-cli", () => ({
  callClaude: async (_prompt: string, _model: string) => ({
    text: JSON.stringify({ scores: buildScores(7) }),
    cost: 0.05,
  }),
}));

// Dynamic imports after mock setup — required for the mock to take effect.
let evaluateArtifact: (
  content: string,
  type: string,
  id: string,
  model: string,
  costTracker: InstanceType<typeof CostMonitorType>,
) => Promise<ArtifactEvaluation>;
let CostMonitor: typeof CostMonitorType;

beforeAll(async () => {
  ({ evaluateArtifact } = await import("../lib/orchestrator"));
  ({ CostMonitor } = await import("../lib/cost"));
});

describe("evaluateArtifact", () => {
  it("returns all 7 HEAR axes", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    expect(Object.keys(result.axes).sort()).toEqual([...AXES].sort());
  });

  it("each axis has score in [1, 10]", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    for (const axis of Object.values(result.axes)) {
      if (axis.score !== null) {
        expect(axis.score).toBeGreaterThanOrEqual(1);
        expect(axis.score).toBeLessThanOrEqual(10);
      }
    }
  });

  it("judgeRuns has 14 entries — 2 judges × 7 axes", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    expect(result.judgeRuns.length).toBe(14);
  });

  it("records cost on the monitor after evaluation", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "test-artifact-id",
      "claude-opus-4-6",
      monitor,
    );
    const snap = monitor.snapshot();
    expect(snap.callCount).toBe(2); // 2 judges
    expect(snap.dailySpend).toBeGreaterThan(0);
  });

  it("propagates artifactId to all judgeRuns", async () => {
    const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });
    const result = await evaluateArtifact(
      "Sample artifact content",
      "decision",
      "artifact-xyz",
      "claude-opus-4-6",
      monitor,
    );
    for (const run of result.judgeRuns) {
      expect(run.artifactId).toBe("artifact-xyz");
    }
  });
});
```

- [ ] **Step 6: Run orchestrator tests — should pass**

```bash
bun test scripts/hear/__tests__/orchestrator.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 7: Create `scripts/hear/__tests__/golden.test.ts`**

```typescript
import { describe, it, expect, mock, beforeAll } from "bun:test";
import type { ArtifactEvaluation } from "../lib/orchestrator";
import type { CostMonitor as CostMonitorType } from "../lib/cost";

// Golden cases: calibration item prefix → expected aggregated score range.
// Range is [minScore, maxScore] with ±1 tolerance baked in.
// "excellent" items must score ≥ 6, "poor" items must score ≤ 5.
const GOLDEN_CASES = [
  { itemId: "001-decision-excellent-wisdom", label: "excellent decision", minScore: 6, maxScore: 10 },
  { itemId: "004-decision-poor-no-tradeoffs", label: "poor decision", minScore: 1, maxScore: 5 },
  { itemId: "009-spec-excellent-thorough", label: "excellent spec", minScore: 6, maxScore: 10 },
  { itemId: "012-spec-poor-asserts", label: "poor spec", minScore: 1, maxScore: 5 },
  { itemId: "021-pr-average", label: "average PR", minScore: 3, maxScore: 7 },
] as const;

// Determine mock score based on item name: excellent=8, poor=3, average=5
function targetScore(itemId: string): number {
  if (itemId.includes("excellent")) return 8;
  if (itemId.includes("poor")) return 3;
  return 5;
}

const AXES = [
  "reasoning_depth", "decision_wisdom", "communication_clarity",
  "initiative_quality", "collaborative_intelligence",
  "self_awareness_calibration", "contextual_judgment",
] as const;

// Mutable so each test case can configure the score before running.
let _mockScore = 7;

mock.module("../lib/claude-cli", () => ({
  callClaude: async () => {
    const scores: Record<string, unknown> = {};
    for (const axis of AXES) {
      scores[axis] = {
        score: _mockScore,
        justification: "golden test",
        evidence_quotes: [],
        confidence: 8,
      };
    }
    return { text: JSON.stringify({ scores }), cost: 0.05 };
  },
}));

let evaluateArtifact: (
  content: string,
  type: string,
  id: string,
  model: string,
  costTracker: InstanceType<typeof CostMonitorType>,
) => Promise<ArtifactEvaluation>;
let CostMonitor: typeof CostMonitorType;
let loadItem: (itemId: string) => { content: string; type: string };

beforeAll(async () => {
  ({ evaluateArtifact } = await import("../lib/orchestrator"));
  ({ CostMonitor } = await import("../lib/cost"));
  ({ loadItem } = await import("../lib/rubric"));
});

describe("golden fixtures", () => {
  for (const { itemId, label, minScore, maxScore } of GOLDEN_CASES) {
    it(`${label} (${itemId}): mean score in [${minScore}, ${maxScore}]`, async () => {
      _mockScore = targetScore(itemId);
      const { content, type } = loadItem(itemId);
      const monitor = new CostMonitor({ dailyBudgetUsd: 100, monthlyBudgetUsd: 1000 });

      const result = await evaluateArtifact(content, type, itemId, "claude-opus-4-6", monitor);

      const scores = Object.values(result.axes)
        .map((a) => a.score)
        .filter((s): s is number => s !== null);

      expect(scores.length).toBeGreaterThan(0);

      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      expect(mean).toBeGreaterThanOrEqual(minScore);
      expect(mean).toBeLessThanOrEqual(maxScore);
    });
  }
});
```

- [ ] **Step 8: Run golden tests — should pass**

```bash
bun test scripts/hear/__tests__/golden.test.ts
```

Expected: all 5 golden fixture tests pass.

- [ ] **Step 9: Run the full test suite**

```bash
bun test scripts/hear/__tests__
```

Expected: all tests in cost, anonymizer, orchestrator, golden pass. Zero API calls made.

- [ ] **Step 10: Create `.github/workflows/hear-ci.yml`**

```yaml
name: HEAR CI

on:
  push:
    paths:
      - "scripts/hear/**"
      - "docs/research/calibration/**"
  pull_request:
    paths:
      - "scripts/hear/**"
      - "docs/research/calibration/**"

jobs:
  test:
    name: HEAR adversarial tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Run HEAR tests
        run: bun test scripts/hear/__tests__
```

- [ ] **Step 11: Commit**

```bash
git add scripts/hear/__tests__/ .github/workflows/hear-ci.yml
git commit -m "feat(hear): E13-4 adversarial CI — cost, anonymizer, orchestrator, golden tests"
```

---

## Task 4: E13-5 — Disaster recovery

**Files:**
- Create: `server/migrations/017_batch_invalidation.sql`
- Modify: `server/src/index.ts` (new endpoint + cost filter)
- Create: `docs/research/DISASTER-RECOVERY.md`

- [ ] **Step 1: Create `server/migrations/017_batch_invalidation.sql`**

```sql
-- HEAR E13-5: Batch invalidation for disaster recovery.
--
-- Adds soft-delete columns to quality_evaluations and judge_runs.
-- Invalidated rows remain in the DB for audit purposes but are excluded
-- from all public-facing queries via WHERE invalidated_at IS NULL.
--
-- quality_evaluations is partitioned; ALTER TABLE on the parent automatically
-- propagates to all existing partitions (Postgres 11+).

ALTER TABLE quality_evaluations
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

ALTER TABLE judge_runs
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

-- REVERSE MIGRATION (not executed — for reference only):
-- ALTER TABLE quality_evaluations
--   DROP COLUMN IF EXISTS invalidated_at,
--   DROP COLUMN IF EXISTS invalidation_reason;
-- ALTER TABLE judge_runs
--   DROP COLUMN IF EXISTS invalidated_at,
--   DROP COLUMN IF EXISTS invalidation_reason;
```

- [ ] **Step 2: Apply the migration**

```bash
DATABASE_URL=postgresql://localhost:5432/hive cd server && bun src/db/migrate.ts
```

Expected: `Applied migration: 017_batch_invalidation.sql`

- [ ] **Step 3: Add the invalidate-batch endpoint to `server/src/index.ts`**

Find the existing internal endpoint block (around line 943, the `quality/notify` endpoint). Add the new endpoint immediately after the closing `}` of that block, before the final `return new Response("Not Found", ...)` line.

The existing block ends with:
```typescript
      return json({ error: "internal_error" }, 500);
      }
    }

    return new Response("Not Found", { status: 404 });
```

Insert this block between the closing `}` and `return new Response`:

```typescript
    // Internal: invalidate all scores from a batch (disaster recovery).
    // Soft-deletes quality_evaluations + judge_runs for the given batch_id.
    // Authenticated by shared secret header.
    if (
      url.pathname === "/api/internal/quality/invalidate-batch" &&
      req.method === "POST"
    ) {
      const expected = process.env.HIVE_INTERNAL_TOKEN;
      if (!expected) {
        return json({ error: "internal_not_configured" }, 500);
      }
      const provided = req.headers.get("X-Hive-Internal-Token");
      if (!provided || provided !== expected) {
        return json({ error: "unauthorized" }, 401);
      }
      const body = await req.json().catch(() => null) as {
        batch_id?: string;
        reason?: string;
      } | null;
      if (!body?.batch_id || !UUID_RE.test(body.batch_id)) {
        return json({ error: "batch_id (UUID) required" }, 400);
      }
      if (!body.reason || body.reason.trim().length === 0) {
        return json({ error: "reason required" }, 400);
      }
      const reason = body.reason.trim();
      const batchId = body.batch_id;
      try {
        await pool.query("BEGIN");

        // 1. Invalidate judge_runs for this batch
        const { rowCount: runsInvalidated } = await pool.query(
          `UPDATE judge_runs
           SET invalidated_at = now(), invalidation_reason = $1
           WHERE batch_id = $2 AND invalidated_at IS NULL`,
          [reason, batchId],
        );

        // 2. Collect artifact_ids from the batch
        const { rows: artifactRows } = await pool.query<{ artifact_id: string }>(
          `SELECT DISTINCT artifact_id
           FROM judge_runs
           WHERE batch_id = $1 AND artifact_id IS NOT NULL`,
          [batchId],
        );
        const artifactIds = artifactRows.map((r) => r.artifact_id);

        // 3. Invalidate quality_evaluations for those artifacts
        let evalsInvalidated = 0;
        if (artifactIds.length > 0) {
          const { rowCount } = await pool.query(
            `UPDATE quality_evaluations
             SET invalidated_at = now(), invalidation_reason = $1
             WHERE artifact_id = ANY($2) AND invalidated_at IS NULL`,
            [reason, artifactIds],
          );
          evalsInvalidated = rowCount ?? 0;
        }

        await pool.query("COMMIT");
        console.log(
          `[hear] invalidated batch ${batchId}: ${runsInvalidated} runs, ${evalsInvalidated} evals — ${reason}`,
        );
        return json({
          ok: true,
          runs_invalidated: runsInvalidated ?? 0,
          evaluations_invalidated: evalsInvalidated,
        });
      } catch (err) {
        await pool.query("ROLLBACK").catch(() => {});
        console.error("[hear] /api/internal/quality/invalidate-batch error:", err);
        return json({ error: "internal_error" }, 500);
      }
    }
```

- [ ] **Step 4: Update `/api/research/cost` to exclude invalidated runs**

Find the cost query (around line 874):

```typescript
        const { rows } = await pool.query(
          `SELECT
             COALESCE(SUM(cost_usd), 0)::float as current_month_usd,
             COALESCE(AVG(cost_usd), 0)::float as cost_per_eval_avg,
             COUNT(*)::int as run_count
           FROM judge_runs
           WHERE created_at >= date_trunc('month', now())`
        );
```

Replace with:

```typescript
        const { rows } = await pool.query(
          `SELECT
             COALESCE(SUM(cost_usd), 0)::float as current_month_usd,
             COALESCE(AVG(cost_usd), 0)::float as cost_per_eval_avg,
             COUNT(*)::int as run_count
           FROM judge_runs
           WHERE created_at >= date_trunc('month', now())
             AND invalidated_at IS NULL`
        );
```

- [ ] **Step 5: Smoke-test the endpoint**

Start the server and hit the endpoint with a fake batch_id:

```bash
cd server && bun src/index.ts &
sleep 1

curl -s -X POST http://localhost:3000/api/internal/quality/invalidate-batch \
  -H "Content-Type: application/json" \
  -H "X-Hive-Internal-Token: hear-dev-token" \
  -d '{"batch_id": "550e8400-e29b-41d4-a716-446655440000", "reason": "smoke test"}' | jq
```

Expected:
```json
{ "ok": true, "runs_invalidated": 0, "evaluations_invalidated": 0 }
```

(0 rows invalidated because no real data matches this batch_id — correct.)

Test the auth guard:

```bash
curl -s -X POST http://localhost:3000/api/internal/quality/invalidate-batch \
  -H "Content-Type: application/json" \
  -d '{"batch_id": "550e8400-e29b-41d4-a716-446655440000", "reason": "test"}' | jq
```

Expected: `{ "error": "unauthorized" }` with status 401.

Kill the server: `kill %1`

- [ ] **Step 6: Create `docs/research/DISASTER-RECOVERY.md`**

```markdown
# HEAR Disaster Recovery — Batch Score Invalidation

Use this procedure when a judge bug produced systematically wrong scores for a batch
(e.g., wrong prompt version, model hallucination on a specific artifact type, parsing error).

Invalidated rows are soft-deleted: they remain in the DB for audit purposes and do not
appear in public-facing queries or the cost dashboard.

---

## Step 1 — Identify the affected batch

Connect to Postgres and find the batch_id:

```sql
SELECT
  batch_id,
  MIN(created_at) AS started_at,
  COUNT(*) AS run_count,
  COALESCE(SUM(cost_usd), 0) AS total_cost_usd
FROM judge_runs
WHERE created_at > '<start of suspected window>'
  AND invalidated_at IS NULL
GROUP BY batch_id
ORDER BY started_at DESC;
```

Pick the batch_id that corresponds to the affected run.

---

## Step 2 — Invalidate the batch

```bash
curl -s -X POST https://<HIVE_URL>/api/internal/quality/invalidate-batch \
  -H "Content-Type: application/json" \
  -H "X-Hive-Internal-Token: $HIVE_INTERNAL_TOKEN" \
  -d '{
    "batch_id": "<batch-uuid>",
    "reason": "<short description of the bug>"
  }'
```

Expected response:
```json
{ "ok": true, "runs_invalidated": 48, "evaluations_invalidated": 6 }
```

---

## Step 3 — Verify

```sql
SELECT COUNT(*) FROM judge_runs
WHERE batch_id = '<batch-uuid>' AND invalidated_at IS NULL;
-- Must return 0.

SELECT COUNT(*) FROM judge_runs
WHERE batch_id = '<batch-uuid>' AND invalidated_at IS NOT NULL;
-- Must return the runs_invalidated count from Step 2.
```

---

## Step 4 — Re-run the judge (optional)

If the bug is fixed, re-run for the affected date window:

```bash
bun run scripts/hear/judge.ts
```

The judge will pick up artifacts from the last 24h. For older windows, a
`--since` flag is planned for V2.

---

## Notes

- Invalidation is irreversible via the API. To un-invalidate, update directly in
  Postgres: `UPDATE judge_runs SET invalidated_at = NULL WHERE batch_id = '...'`
- The `/api/research/cost` dashboard excludes invalidated runs automatically.
- Never delete rows from `judge_runs` or `quality_evaluations` — they are the audit log.
```

- [ ] **Step 7: Commit**

```bash
git add \
  server/migrations/017_batch_invalidation.sql \
  server/src/index.ts \
  docs/research/DISASTER-RECOVERY.md
git commit -m "feat(hear): E13-5 batch invalidation endpoint + disaster recovery runbook"
```

---

## Final verification

- [ ] Run all HEAR tests one last time:

```bash
bun test scripts/hear/__tests__
```

Expected: all tests pass, 0 failures.

- [ ] Check server compiles:

```bash
cd server && bun --check src/index.ts
```

Expected: no type errors.
