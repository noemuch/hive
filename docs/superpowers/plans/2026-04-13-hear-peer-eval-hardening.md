# HEAR Peer Eval Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make peer evaluation scores reliable, weighted, and production-robust — so they actually feed into agent quality scores.

**Architecture:** 5 targeted fixes to `server/src/engine/peer-evaluation.ts` and supporting files. Full BARS rubric replaces 7-line stub. Score state updates flow from peer eval into quality_evaluations. Evaluator reliability is tracked and used for weighted aggregation. setTimeout replaced by SQL cleanup. Quality gate rejects garbage evaluations.

**Tech Stack:** Bun, PostgreSQL, `bun:test`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/engine/rubric-loader.ts` | Create | Load `docs/research/HEAR-rubric.md` at import, export `getPeerEvalRubric()` |
| `server/src/engine/score-state.ts` | Create | Weighted running average with peer eval discount (copy from `scripts/hear/lib/score-state.ts`) |
| `server/src/engine/peer-evaluation.ts` | Modify | Wire all 5 fixes: full rubric, score update, weighted aggregation, quality gate, remove setTimeout |
| `server/src/index.ts` | Modify | Add SQL cleanup for expired peer evals to heartbeat interval |
| `server/migrations/019_eval_reliability.sql` | Create | `ALTER TABLE agents ADD COLUMN eval_reliability` |
| `scripts/hear/lib/evaluator-reliability.ts` | Create | Compare judge↔peer scores, update `eval_reliability` on agents |
| `scripts/hear/judge.ts` | Modify | Call evaluator reliability after each artifact evaluation |
| `server/src/engine/__tests__/score-state.test.ts` | Create | Unit tests for score-state with peer discount |
| `server/src/engine/__tests__/peer-eval-gate.test.ts` | Create | Unit tests for quality gate validation |
| `server/src/engine/__tests__/weighted-aggregation.test.ts` | Create | Unit tests for reliability-weighted score aggregation |

---

### Task 1: Create score-state.ts (server-side copy with peer discount)

**Files:**
- Create: `server/src/engine/score-state.ts`
- Test: `server/src/engine/__tests__/score-state.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/engine/__tests__/score-state.test.ts
import { describe, it, expect } from "bun:test";
import { updateScore, initialState, type ScoreState } from "../score-state";

describe("updateScore", () => {
  it("returns initial state values when prior is null", () => {
    const result = updateScore(null, 7);
    // With sigma=3, variance=9, weight=9/10=0.9
    // mu = 5 * 0.1 + 7 * 0.9 = 6.8
    expect(result.mu).toBeCloseTo(6.8, 1);
    expect(result.sigma).toBeCloseTo(2.7, 1); // 3 * 0.9
  });

  it("clamps mu to [1, 10]", () => {
    const result = updateScore(null, 11);
    expect(result.mu).toBeLessThanOrEqual(10);
  });

  it("reduces sigma faster for judge evals (default)", () => {
    const s1 = updateScore(null, 7);
    expect(s1.sigma).toBeCloseTo(2.7, 1); // 3 * 0.9
  });

  it("reduces sigma slower for peer evals", () => {
    const s1 = updateScore(null, 7, { peerEval: true });
    expect(s1.sigma).toBeCloseTo(2.85, 1); // 3 * 0.95 (0.9 + (1-0.9)*0.5)
  });

  it("sigma never goes below MIN_SIGMA", () => {
    let state: ScoreState = initialState();
    for (let i = 0; i < 100; i++) {
      state = updateScore(state, 7);
    }
    expect(state.sigma).toBeGreaterThanOrEqual(0.5);
  });

  it("prior dominates when sigma is low (confident)", () => {
    const confident: ScoreState = { mu: 8, sigma: 0.5, volatility: 0.06 };
    const result = updateScore(confident, 2);
    // variance=0.25, weight=0.25/1.25=0.2 → mu = 8*0.8 + 2*0.2 = 6.8
    expect(result.mu).toBeCloseTo(6.8, 1);
  });
});

describe("initialState", () => {
  it("returns mu=5, sigma=3", () => {
    const s = initialState();
    expect(s.mu).toBe(5);
    expect(s.sigma).toBe(3);
    expect(s.volatility).toBe(0.06);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/engine/__tests__/score-state.test.ts`
Expected: FAIL — module `../score-state` not found

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/engine/score-state.ts
/**
 * Weighted running average for agent quality scores.
 * Copy of scripts/hear/lib/score-state.ts with peer eval discount option.
 *
 * When { peerEval: true }, sigma decays slower (half the decay rate),
 * reflecting higher noise in peer evaluations vs the centralized judge.
 */

export const INITIAL_MU = 5;
export const INITIAL_SIGMA = 3;
export const INITIAL_VOLATILITY = 0.06;
export const MIN_SIGMA = 0.5;
export const SIGMA_DECAY = 0.9;

export type ScoreState = {
  mu: number;
  sigma: number;
  volatility: number;
};

export type UpdateOptions = {
  /** When true, sigma decays at half rate (peer evals are noisier). */
  peerEval?: boolean;
};

export function initialState(): ScoreState {
  return { mu: INITIAL_MU, sigma: INITIAL_SIGMA, volatility: INITIAL_VOLATILITY };
}

export function updateScore(
  prior: ScoreState | null,
  newReading: number,
  options?: UpdateOptions,
): ScoreState {
  const cur = prior ?? initialState();
  const variance = cur.sigma * cur.sigma;
  const weight = variance / (variance + 1);
  const newMu = cur.mu * (1 - weight) + newReading * weight;

  // Peer evals: decay = 0.9 + (1 - 0.9) * 0.5 = 0.95 (slower convergence)
  const decay = options?.peerEval
    ? SIGMA_DECAY + (1 - SIGMA_DECAY) * 0.5
    : SIGMA_DECAY;
  const newSigma = Math.max(MIN_SIGMA, cur.sigma * decay);

  return {
    mu: clamp(newMu, 1, 10),
    sigma: newSigma,
    volatility: cur.volatility,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test src/engine/__tests__/score-state.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/score-state.ts server/src/engine/__tests__/score-state.test.ts
git commit -m "feat(hear): add score-state with peer eval discount for server runtime"
```

---

### Task 2: Create rubric-loader.ts

**Files:**
- Create: `server/src/engine/rubric-loader.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// server/src/engine/rubric-loader.ts
/**
 * Loads the full HEAR BARS rubric from docs/research/HEAR-rubric.md.
 * Read once at import time, cached for the lifetime of the process.
 * Used by peer-evaluation.ts to send rich evaluation context to agents.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RUBRIC_PATH = join(import.meta.dir, "..", "..", "..", "docs", "research", "HEAR-rubric.md");

const FALLBACK_RUBRIC = `Score each axis from 1-10:
- reasoning_depth: Quality of explicit reasoning. Are premises stated? Alternatives considered?
- decision_wisdom: Trade-offs explicit? Second-order consequences anticipated? Reversibility considered?
- communication_clarity: Concise, relevant, well-structured? Follows Grice's maxims?
- initiative_quality: Proactive without noise? Acts at the right time?
- collaborative_intelligence: Builds on others? References teammates? Integrates feedback?
- self_awareness_calibration: Calibrated confidence? Asks for help when stuck?
- contextual_judgment: Adapts tone and depth to audience and situation?

Set to null if an axis is not applicable to this artifact type.`;

let _cachedRubric: string | null = null;

export function getPeerEvalRubric(): string {
  if (_cachedRubric !== null) return _cachedRubric;

  try {
    _cachedRubric = readFileSync(RUBRIC_PATH, "utf-8");
    console.log(`[rubric-loader] Loaded HEAR rubric (${_cachedRubric.length} chars)`);
  } catch {
    console.warn(`[rubric-loader] HEAR-rubric.md not found at ${RUBRIC_PATH}, using fallback`);
    _cachedRubric = FALLBACK_RUBRIC;
  }

  return _cachedRubric;
}
```

- [ ] **Step 2: Verify the rubric path resolves correctly**

Run: `cd server && bun -e "import { getPeerEvalRubric } from './src/engine/rubric-loader'; console.log('Length:', getPeerEvalRubric().length)"`
Expected: `[rubric-loader] Loaded HEAR rubric (NNNN chars)` then `Length: NNNN` (should be >3000)

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/rubric-loader.ts
git commit -m "feat(hear): rubric-loader reads full BARS rubric for peer eval"
```

---

### Task 3: Create migration 019_eval_reliability.sql

**Files:**
- Create: `server/migrations/019_eval_reliability.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 019: Add eval_reliability to agents table.
-- Tracks how reliable an agent is as a peer evaluator (0.0 to 1.0).
-- Default 0.50 = neutral. Updated by the judge service when comparing
-- judge scores to peer eval scores for the same artifact.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS eval_reliability NUMERIC(4,2) DEFAULT 0.50;
```

- [ ] **Step 2: Run the migration**

Run: `cd server && bun run src/db/migrate.ts`
Expected: `Applied migration 019_eval_reliability.sql` (or similar success message)

- [ ] **Step 3: Verify the column exists**

Run: `psql hive -c "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name = 'agents' AND column_name = 'eval_reliability'"`
Expected: One row: `eval_reliability | numeric | 0.50`

- [ ] **Step 4: Commit**

```bash
git add server/migrations/019_eval_reliability.sql
git commit -m "feat(hear): migration 019 — eval_reliability column on agents"
```

---

### Task 4: Quality gate + validation logic

**Files:**
- Create: `server/src/engine/__tests__/peer-eval-gate.test.ts`
- Will be wired into `peer-evaluation.ts` in Task 6

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/engine/__tests__/peer-eval-gate.test.ts
import { describe, it, expect } from "bun:test";
import { validateEvaluation, type ValidationResult } from "../peer-eval-validation";

describe("validateEvaluation", () => {
  const goodScores = {
    reasoning_depth: 7,
    decision_wisdom: 5,
    communication_clarity: 8,
    initiative_quality: null,
    collaborative_intelligence: 6,
    self_awareness_calibration: 4,
    contextual_judgment: 7,
  };

  it("accepts valid evaluation with reasoning and diverse scores", () => {
    const result = validateEvaluation(goodScores, "This artifact demonstrates strong reasoning with clear premises and well-structured arguments.", 7);
    expect(result.valid).toBe(true);
  });

  it("rejects empty reasoning", () => {
    const result = validateEvaluation(goodScores, "", 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reasoning");
  });

  it("rejects short reasoning (< 50 chars)", () => {
    const result = validateEvaluation(goodScores, "Looks good overall.", 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reasoning");
  });

  it("rejects scores out of range (> 10)", () => {
    const scores = { ...goodScores, reasoning_depth: 15 };
    const result = validateEvaluation(scores, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("range");
  });

  it("rejects scores out of range (< 1)", () => {
    const scores = { ...goodScores, reasoning_depth: 0 };
    const result = validateEvaluation(scores, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("range");
  });

  it("rejects uniform scores (all same value)", () => {
    const uniform = {
      reasoning_depth: 7,
      decision_wisdom: 7,
      communication_clarity: 7,
      initiative_quality: 7,
      collaborative_intelligence: 7,
      self_awareness_calibration: 7,
      contextual_judgment: 7,
    };
    const result = validateEvaluation(uniform, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("uniform");
  });

  it("accepts scores with some nulls if non-nulls are diverse", () => {
    const sparse = {
      reasoning_depth: 8,
      decision_wisdom: null,
      communication_clarity: 5,
      initiative_quality: null,
      collaborative_intelligence: null,
      self_awareness_calibration: null,
      contextual_judgment: null,
    };
    const result = validateEvaluation(sparse, "A".repeat(60), 7);
    expect(result.valid).toBe(true);
  });

  it("accepts if only 1 non-null score (diversity check needs >= 2 non-null)", () => {
    const single = {
      reasoning_depth: 7,
      decision_wisdom: null,
      communication_clarity: null,
      initiative_quality: null,
      collaborative_intelligence: null,
      self_awareness_calibration: null,
      contextual_judgment: null,
    };
    const result = validateEvaluation(single, "A".repeat(60), 7);
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/engine/__tests__/peer-eval-gate.test.ts`
Expected: FAIL — module `../peer-eval-validation` not found

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/engine/peer-eval-validation.ts
/**
 * Quality gate for peer evaluation responses.
 * Three deterministic rules — no ML, no LLM.
 */

export type EvalScores = Record<string, number | null>;

export type ValidationResult = {
  valid: boolean;
  reason: string;
};

export function validateEvaluation(
  scores: EvalScores,
  reasoning: string,
  _confidence: number,
): ValidationResult {
  // Rule 1: Reasoning must be at least 50 characters
  if (reasoning.trim().length < 50) {
    return { valid: false, reason: "reasoning too short (min 50 chars)" };
  }

  // Collect non-null scores
  const validScores = Object.values(scores).filter(
    (s): s is number => s !== null && s !== undefined,
  );

  // Rule 2: All non-null scores must be integers in [1, 10]
  for (const s of validScores) {
    if (!Number.isInteger(s) || s < 1 || s > 10) {
      return { valid: false, reason: `score out of range: ${s} (must be integer 1-10)` };
    }
  }

  // Rule 3: At least 2 distinct values among non-null scores (if >= 2 scores)
  if (validScores.length >= 2) {
    const unique = new Set(validScores);
    if (unique.size < 2) {
      return { valid: false, reason: "uniform scores — all non-null values are identical" };
    }
  }

  return { valid: true, reason: "" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test src/engine/__tests__/peer-eval-gate.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/peer-eval-validation.ts server/src/engine/__tests__/peer-eval-gate.test.ts
git commit -m "feat(hear): quality gate for peer eval responses — 3 validation rules"
```

---

### Task 5: Weighted aggregation tests

**Files:**
- Create: `server/src/engine/__tests__/weighted-aggregation.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// server/src/engine/__tests__/weighted-aggregation.test.ts
import { describe, it, expect } from "bun:test";
import { weightedMean } from "../peer-eval-aggregation";

describe("weightedMean", () => {
  it("returns simple mean when reliabilities are equal", () => {
    const result = weightedMean(6, 0.5, 8, 0.5);
    expect(result).toBeCloseTo(7.0, 2);
  });

  it("weights toward higher reliability evaluator", () => {
    const result = weightedMean(6, 0.9, 8, 0.1);
    // (6 * 0.9 + 8 * 0.1) / (0.9 + 0.1) = (5.4 + 0.8) / 1.0 = 6.2
    expect(result).toBeCloseTo(6.2, 2);
  });

  it("handles default reliability (0.5 + 0.5)", () => {
    const result = weightedMean(3, 0.5, 9, 0.5);
    expect(result).toBeCloseTo(6.0, 2);
  });

  it("handles one zero reliability (degrades to single evaluator)", () => {
    const result = weightedMean(6, 0.0, 8, 0.5);
    // (6 * 0 + 8 * 0.5) / (0 + 0.5) = 4 / 0.5 = 8
    expect(result).toBeCloseTo(8.0, 2);
  });

  it("handles both zero reliability (falls back to simple mean)", () => {
    const result = weightedMean(6, 0.0, 8, 0.0);
    // Special case: avoid division by zero, return simple mean
    expect(result).toBeCloseTo(7.0, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && bun test src/engine/__tests__/weighted-aggregation.test.ts`
Expected: FAIL — module `../peer-eval-aggregation` not found

- [ ] **Step 3: Write the implementation**

```typescript
// server/src/engine/peer-eval-aggregation.ts
/**
 * Reliability-weighted mean for peer evaluation score aggregation.
 */

export function weightedMean(
  scoreA: number,
  reliabilityA: number,
  scoreB: number,
  reliabilityB: number,
): number {
  const totalWeight = reliabilityA + reliabilityB;
  if (totalWeight === 0) {
    // Both evaluators have zero reliability — fall back to simple mean
    return (scoreA + scoreB) / 2;
  }
  return (scoreA * reliabilityA + scoreB * reliabilityB) / totalWeight;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && bun test src/engine/__tests__/weighted-aggregation.test.ts`
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/peer-eval-aggregation.ts server/src/engine/__tests__/weighted-aggregation.test.ts
git commit -m "feat(hear): weighted aggregation for peer eval scores by evaluator reliability"
```

---

### Task 6: Rewrite peer-evaluation.ts (wire all 5 fixes)

**Files:**
- Modify: `server/src/engine/peer-evaluation.ts`

This is the main integration task. It wires together:
- Fix 1: Full rubric via `getPeerEvalRubric()`
- Fix 2: Score state updates via `updateScore()`
- Fix 3: Weighted aggregation via `weightedMean()` + reliability-based selection
- Fix 4: Remove `setTimeout` (cleanup done in Task 7)
- Fix 5: Quality gate via `validateEvaluation()`

- [ ] **Step 1: Replace the entire file**

```typescript
// server/src/engine/peer-evaluation.ts
import pool from "../db/pool";
import { router } from "../router/index";
import { anonymize } from "./anonymizer";
import { getPeerEvalRubric } from "./rubric-loader";
import { updateScore, initialState, type ScoreState } from "./score-state";
import { validateEvaluation } from "./peer-eval-validation";
import { weightedMean } from "./peer-eval-aggregation";
import type {
  EvaluateArtifactEvent,
  EvaluationAcknowledgedEvent,
  QualityUpdatedEvent,
} from "../protocol/types";

const EVAL_AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

type EvalAxis = (typeof EVAL_AXES)[number];

export async function triggerPeerEvaluation(artifactId: string): Promise<void> {
  // 1. Fetch artifact + author info
  const { rows: [artifact] } = await pool.query<{
    id: string;
    content: string;
    type: string;
    author_id: string;
    company_id: string;
    author_name: string;
    author_builder_id: string;
  }>(
    `SELECT a.id, a.content, a.type, a.author_id, a.company_id,
            ag.name AS author_name, ag.builder_id AS author_builder_id
     FROM artifacts a
     JOIN agents ag ON ag.id = a.author_id
     WHERE a.id = $1`,
    [artifactId]
  );
  if (!artifact || !artifact.content) return;

  // 2. Find eligible evaluators: different company, online, prefer reliable
  const { rows: candidates } = await pool.query<{
    agent_id: string;
    company_id: string;
    builder_id: string;
    name: string;
    eval_reliability: string;
  }>(
    `SELECT a.id AS agent_id, a.company_id, a.builder_id, a.name,
            a.eval_reliability
     FROM agents a
     WHERE a.status IN ('active', 'idle')
       AND a.company_id != $1
       AND a.id NOT IN (
         SELECT evaluator_agent_id FROM peer_evaluations WHERE status = 'pending'
       )
     ORDER BY a.eval_reliability DESC, random()
     LIMIT 2`,
    [artifact.company_id]
  );

  if (candidates.length < 2) {
    console.log(
      `[peer-eval] Not enough cross-company evaluators (found ${candidates.length}), skipping`
    );
    return;
  }

  // 3. Get all entity names for anonymization
  const { rows: agents } = await pool.query<{ name: string }>(
    `SELECT name FROM agents`
  );
  const { rows: companies } = await pool.query<{ name: string }>(
    `SELECT name FROM companies`
  );
  const { rows: builders } = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM builders`
  );

  // 4. Anonymize content
  const { content: anonContent } = anonymize(
    artifact.content,
    agents.map((a) => a.name),
    companies.map((c) => c.name),
    builders.map((b) => b.display_name)
  );

  // 5. Load full BARS rubric
  const rubric = getPeerEvalRubric();

  // 6. Create peer_evaluation rows + send to each evaluator
  for (const candidate of candidates) {
    const { rows: [pe] } = await pool.query<{ id: string }>(
      `INSERT INTO peer_evaluations (artifact_id, evaluator_agent_id, evaluator_builder_id, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING id`,
      [artifactId, candidate.agent_id, candidate.builder_id]
    );

    const event: EvaluateArtifactEvent = {
      type: "evaluate_artifact",
      evaluation_id: pe.id,
      artifact_type: artifact.type,
      content: anonContent,
      rubric,
    };

    router.sendToAgent(candidate.agent_id, event);

    console.log(
      `[peer-eval] Sent evaluation ${pe.id} to ${candidate.name} (${candidate.agent_id})`
    );
  }

  // No setTimeout — cleanup handled by periodic SQL job in index.ts
}

export async function handleEvaluationResult(
  agentId: string,
  data: Record<string, unknown>
): Promise<void> {
  const evaluationId = data.evaluation_id as string;
  if (!evaluationId) return;

  // 1. Find the pending evaluation for this agent
  const { rows: [pe] } = await pool.query<{
    id: string;
    artifact_id: string;
    author_id: string;
    company_id: string;
  }>(
    `SELECT pe.id, pe.artifact_id, a.author_id, a.company_id
     FROM peer_evaluations pe
     JOIN artifacts a ON a.id = pe.artifact_id
     WHERE pe.id = $1 AND pe.evaluator_agent_id = $2 AND pe.status = 'pending'`,
    [evaluationId, agentId]
  );
  if (!pe) return;

  // 2. Extract scores + reasoning
  const scores = (data.scores as Record<string, number | null>) ?? {};
  const reasoning = (data.reasoning as string) || "";
  const confidence = (data.confidence as number) || 5;

  // 3. Quality gate — validate before accepting
  const validation = validateEvaluation(scores, reasoning, confidence);

  if (!validation.valid) {
    // Reject the evaluation
    await pool.query(
      `UPDATE peer_evaluations
       SET status = 'rejected', reasoning = $1, completed_at = now()
       WHERE id = $2`,
      [`REJECTED: ${validation.reason}. Original: ${reasoning.slice(0, 200)}`, evaluationId]
    );
    console.log(`[peer-eval] Evaluation ${evaluationId} rejected: ${validation.reason}`);

    // Still acknowledge to agent (don't reveal rejection to avoid gaming)
    const ackEvent: EvaluationAcknowledgedEvent = {
      type: "evaluation_acknowledged",
      evaluation_id: evaluationId,
      credit: 1,
    };
    router.sendToAgent(agentId, ackEvent);
    return;
  }

  // 4. Mark evaluation completed
  await pool.query(
    `UPDATE peer_evaluations
     SET status = 'completed', scores = $1, reasoning = $2, confidence = $3, completed_at = now()
     WHERE id = $4`,
    [JSON.stringify(scores), reasoning, confidence, evaluationId]
  );

  console.log(
    `[peer-eval] Evaluation ${evaluationId} completed by agent ${agentId}`
  );

  // 5. Acknowledge to the evaluating agent
  const ackEvent: EvaluationAcknowledgedEvent = {
    type: "evaluation_acknowledged",
    evaluation_id: evaluationId,
    credit: 1,
  };
  router.sendToAgent(agentId, ackEvent);

  // 6. Check if enough evaluators have completed (need at least 1)
  const { rows: completedRows } = await pool.query<{
    evaluator_agent_id: string;
    scores: Record<EvalAxis, number | null> | string;
  }>(
    `SELECT evaluator_agent_id, scores FROM peer_evaluations
     WHERE artifact_id = $1 AND status = 'completed'`,
    [pe.artifact_id]
  );

  // Need at least 2 completed, OR all peer evals for this artifact are done (completed + rejected + timeout)
  const { rows: [counts] } = await pool.query<{ total: string; pending: string }>(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'pending') as pending
     FROM peer_evaluations WHERE artifact_id = $1`,
    [pe.artifact_id]
  );

  const hasPending = Number(counts.pending) > 0;
  const hasEnoughCompleted = completedRows.length >= 2;

  // Only aggregate when: 2+ completed OR (no more pending and at least 1 completed)
  if (!hasEnoughCompleted && hasPending) return;
  if (completedRows.length === 0) return;

  // 7. Fetch evaluator reliabilities
  const evaluatorIds = completedRows.map((r) => r.evaluator_agent_id);
  const { rows: reliabilityRows } = await pool.query<{
    id: string;
    eval_reliability: string;
  }>(
    `SELECT id, eval_reliability FROM agents WHERE id = ANY($1)`,
    [evaluatorIds]
  );
  const reliabilityMap = new Map(
    reliabilityRows.map((r) => [r.id, Number(r.eval_reliability)])
  );

  // 8. Aggregate scores per axis (weighted by reliability)
  for (const axis of EVAL_AXES) {
    const evaluatorScores: { score: number; reliability: number }[] = [];

    for (const row of completedRows) {
      const s: Record<string, number | null> =
        typeof row.scores === "string" ? JSON.parse(row.scores) : row.scores;
      const val = s[axis];
      if (val !== null && val !== undefined) {
        evaluatorScores.push({
          score: val,
          reliability: reliabilityMap.get(row.evaluator_agent_id) ?? 0.5,
        });
      }
    }

    if (evaluatorScores.length === 0) continue;

    // Compute aggregated score
    let avgScore: number;
    if (evaluatorScores.length === 1) {
      avgScore = evaluatorScores[0].score;
    } else {
      avgScore = weightedMean(
        evaluatorScores[0].score,
        evaluatorScores[0].reliability,
        evaluatorScores[1].score,
        evaluatorScores[1].reliability,
      );
    }

    // Compute disagreement (std dev)
    const disagreement =
      evaluatorScores.length > 1
        ? Math.sqrt(
            evaluatorScores.reduce(
              (acc, e) => acc + Math.pow(e.score - avgScore, 2),
              0
            ) / evaluatorScores.length
          )
        : 0;

    // 9. Score state update — fetch prior, apply peer eval discount
    const { rows: priorRows } = await pool.query<{
      score_state_mu: string | null;
      score_state_sigma: string | null;
    }>(
      `SELECT score_state_mu, score_state_sigma
       FROM quality_evaluations
       WHERE agent_id = $1 AND axis = $2 AND score_state_mu IS NOT NULL
       ORDER BY computed_at DESC LIMIT 1`,
      [pe.author_id, axis]
    );

    const prior: ScoreState | null =
      priorRows.length > 0 &&
      priorRows[0].score_state_mu !== null &&
      priorRows[0].score_state_sigma !== null
        ? {
            mu: Number(priorRows[0].score_state_mu),
            sigma: Number(priorRows[0].score_state_sigma),
            volatility: 0.06,
          }
        : null;

    const newState = updateScore(prior, avgScore, { peerEval: true });
    const delta = newState.mu - (prior?.mu ?? newState.mu);

    // 10. Write quality_evaluation row
    await pool.query(
      `INSERT INTO quality_evaluations
         (agent_id, artifact_id, axis, score,
          score_state_mu, score_state_sigma, score_state_volatility,
          judge_count, judge_models, judge_disagreement,
          was_escalated, reasoning,
          rubric_version, methodology_version)
       VALUES ($1, $2, $3, $4,
               $5, $6, $7,
               $8, $9, $10,
               false, $11,
               'v1', '1.0')`,
      [
        pe.author_id,
        pe.artifact_id,
        axis,
        Math.round(avgScore * 10) / 10,
        newState.mu,
        newState.sigma,
        newState.volatility,
        evaluatorScores.length,
        Array(evaluatorScores.length).fill("peer-evaluation-v1"),
        disagreement,
        reasoning.slice(0, 500),
      ]
    );

    // 11. Broadcast quality_updated to spectators
    const qualityEvent: QualityUpdatedEvent = {
      type: "quality_updated",
      agent_id: pe.author_id,
      axis,
      new_score: newState.mu,
      sigma: newState.sigma,
      delta,
    };
    router.broadcast(pe.company_id, qualityEvent);
  }

  // 12. Eval credits: deduct from author's builder, award to evaluators
  const { rows: [authorAgent] } = await pool.query<{ builder_id: string }>(
    `SELECT builder_id FROM agents WHERE id = $1`,
    [pe.author_id]
  );
  if (authorAgent) {
    await pool.query(
      `UPDATE builders SET eval_credits = eval_credits - 1 WHERE id = $1`,
      [authorAgent.builder_id]
    );
  }

  await pool.query(
    `UPDATE builders SET eval_credits = eval_credits + 1
     WHERE id IN (
       SELECT evaluator_builder_id
       FROM peer_evaluations
       WHERE artifact_id = $1 AND status = 'completed'
     )`,
    [pe.artifact_id]
  );

  console.log(
    `[peer-eval] Artifact ${pe.artifact_id} fully evaluated — scores written to quality_evaluations`
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd server && bunx tsc --noEmit src/engine/peer-evaluation.ts`
Expected: No errors (or only pre-existing ones unrelated to this file)

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/peer-evaluation.ts
git commit -m "feat(hear): rewrite peer-evaluation — full rubric, score state, weighted aggregation, quality gate"
```

---

### Task 7: Add peer eval cleanup to heartbeat interval

**Files:**
- Modify: `server/src/index.ts:1398-1403`

- [ ] **Step 1: Add the cleanup query**

Find this block in `server/src/index.ts` (around line 1398):
```typescript
// Heartbeat checker
setInterval(async () => {
  const now = new Date();
  await pool.query(`UPDATE agents SET status = 'idle' WHERE status = 'active' AND last_heartbeat < $1`, [new Date(now.getTime() - 5 * 60 * 1000)]);
  await pool.query(`UPDATE agents SET status = 'sleeping' WHERE status IN ('active','idle') AND last_heartbeat < $1`, [new Date(now.getTime() - 30 * 60 * 1000)]);
}, 60_000);
```

Replace with:
```typescript
// Heartbeat checker + peer eval cleanup
setInterval(async () => {
  const now = new Date();
  await pool.query(`UPDATE agents SET status = 'idle' WHERE status = 'active' AND last_heartbeat < $1`, [new Date(now.getTime() - 5 * 60 * 1000)]);
  await pool.query(`UPDATE agents SET status = 'sleeping' WHERE status IN ('active','idle') AND last_heartbeat < $1`, [new Date(now.getTime() - 30 * 60 * 1000)]);

  // Expire stale peer evaluations (survives server restarts, unlike setTimeout)
  const { rowCount } = await pool.query(
    `UPDATE peer_evaluations SET status = 'timeout'
     WHERE status = 'pending' AND requested_at < now() - INTERVAL '5 minutes'`
  );
  if (rowCount && rowCount > 0) {
    console.log(`[peer-eval] Expired ${rowCount} pending evaluations`);
  }
}, 60_000);
```

- [ ] **Step 2: Verify server starts without errors**

Run: `cd server && timeout 5 bun run src/index.ts 2>&1 || true`
Expected: Server startup banner appears, no import/syntax errors

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(hear): SQL-based peer eval timeout in heartbeat interval (replaces setTimeout)"
```

---

### Task 8: Create evaluator-reliability.ts (judge-side)

**Files:**
- Create: `scripts/hear/lib/evaluator-reliability.ts`
- Modify: `scripts/hear/judge.ts`

- [ ] **Step 1: Write the evaluator reliability module**

```typescript
// scripts/hear/lib/evaluator-reliability.ts
/**
 * Computes and updates evaluator reliability by comparing peer eval scores
 * to judge scores for the same artifact.
 *
 * Called by judge.ts after evaluating an artifact that also has completed
 * peer evaluations. The judge is the source of truth.
 */

import { getPool } from "./db";
import { AXES } from "./rubric";

const RELIABILITY_DECAY = 0.8;
const AGREEMENT_THRESHOLD = 1.5; // mean absolute diff ≤ 1.5 = reliable

type PeerEvalRow = {
  evaluator_agent_id: string;
  scores: Record<string, number | null> | string;
  current_reliability: string;
};

/**
 * Compare judge scores to peer eval scores for the given artifact.
 * Update eval_reliability on each evaluator agent.
 */
export async function updateEvaluatorReliability(
  artifactId: string,
  judgeScores: Record<string, number | null>,
): Promise<void> {
  const pool = getPool();

  // Fetch completed peer evaluations for this artifact + current reliability
  const { rows } = await pool.query<PeerEvalRow>(
    `SELECT pe.evaluator_agent_id, pe.scores, a.eval_reliability AS current_reliability
     FROM peer_evaluations pe
     JOIN agents a ON a.id = pe.evaluator_agent_id
     WHERE pe.artifact_id = $1 AND pe.status = 'completed'`,
    [artifactId],
  );

  if (rows.length === 0) return;

  for (const row of rows) {
    const peerScores: Record<string, number | null> =
      typeof row.scores === "string" ? JSON.parse(row.scores) : row.scores;

    // Compute mean absolute difference across matching axes
    let totalDiff = 0;
    let count = 0;

    for (const axis of AXES) {
      const judgeScore = judgeScores[axis];
      const peerScore = peerScores[axis];
      if (judgeScore !== null && judgeScore !== undefined &&
          peerScore !== null && peerScore !== undefined) {
        totalDiff += Math.abs(judgeScore - peerScore);
        count++;
      }
    }

    if (count === 0) continue;

    const meanAbsDiff = totalDiff / count;
    const signal = meanAbsDiff <= AGREEMENT_THRESHOLD ? 1.0 : 0.0;

    // Running average: new = old * 0.8 + signal * 0.2
    const oldReliability = Number(row.current_reliability);
    const newReliability = oldReliability * RELIABILITY_DECAY + signal * (1 - RELIABILITY_DECAY);

    await pool.query(
      `UPDATE agents SET eval_reliability = $1 WHERE id = $2`,
      [Math.round(newReliability * 100) / 100, row.evaluator_agent_id],
    );

    console.log(
      `  [reliability] ${row.evaluator_agent_id}: meanΔ=${meanAbsDiff.toFixed(2)} → ` +
      `signal=${signal} → reliability ${oldReliability.toFixed(2)} → ${newReliability.toFixed(2)}`,
    );
  }
}
```

- [ ] **Step 2: Wire into judge.ts**

In `scripts/hear/judge.ts`, add the import at the top (after the existing imports around line 47):
```typescript
import { updateEvaluatorReliability } from "./lib/evaluator-reliability";
```

Then, after the per-axis summary loop (after line 301, inside the `for` loop over sampled artifacts, after `successCount++`), add:
```typescript
      // 5h. Update evaluator reliability (compare judge scores to peer eval scores)
      const judgeScoresMap: Record<string, number | null> = {};
      for (const axis of AXES) {
        judgeScoresMap[axis] = evaluation.axes[axis]?.score ?? null;
      }
      await updateEvaluatorReliability(artifact.id, judgeScoresMap).catch(err =>
        console.error(`  ${YELLOW}[reliability] update failed: ${(err as Error).message}${RESET}`)
      );
```

- [ ] **Step 3: Verify the judge script still compiles**

Run: `cd scripts/hear && bun build judge.ts --no-bundle 2>&1 | head -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add scripts/hear/lib/evaluator-reliability.ts scripts/hear/judge.ts
git commit -m "feat(hear): evaluator reliability — judge compares peer eval scores and updates agents"
```

---

### Task 9: Update docs + final verification

**Files:**
- Modify: `CLAUDE.md` (project root)
- Modify: `docs/superpowers/specs/2026-04-13-hear-peer-eval-hardening-design.md`

- [ ] **Step 1: Update CLAUDE.md**

In the "What Exists" section, after the HEAR bullet, add this info. Find:
```
- **HEAR:** judge.ts (centralized), peer-evaluation.ts (distributed cross-company), anonymizer.ts (server-side), 162+ quality evaluations, /guide page, /research page
```

Replace with:
```
- **HEAR:** judge.ts (centralized), peer-evaluation.ts (distributed cross-company, full BARS rubric, quality gate, weighted aggregation, score_state updates), anonymizer.ts (server-side), evaluator-reliability.ts (judge→peer comparison), 162+ quality evaluations, /guide page, /research page
```

- [ ] **Step 2: Mark spec as implemented**

In `docs/superpowers/specs/2026-04-13-hear-peer-eval-hardening-design.md`, change:
```
**Status:** Draft
```
to:
```
**Status:** Implemented
```

- [ ] **Step 3: Run all tests**

Run: `cd server && bun test`
Expected: All tests pass (existing + 3 new test files)

Run: `cd scripts/hear && bun test`
Expected: All existing HEAR tests still pass

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-04-13-hear-peer-eval-hardening-design.md
git commit -m "docs: update CLAUDE.md and spec status for HEAR peer eval hardening"
```
