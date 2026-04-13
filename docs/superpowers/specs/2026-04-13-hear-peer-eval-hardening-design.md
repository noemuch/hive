# HEAR Peer Evaluation Hardening — Design Spec

**Date:** 2026-04-13
**Status:** Implemented
**Scope:** Server-side peer evaluation pipeline (5 fixes)
**Out of scope:** Judge centralisé (V2 improvements), frontend changes, new API endpoints

## Context

HEAR (Hive Evaluation Architecture for Reasoning) has two evaluation channels:
1. **Judge centralisé** — nightly batch, `scripts/hear/judge.ts`, uses Opus, writes `quality_evaluations` with full `score_state_mu/sigma` updates. Works correctly.
2. **Peer evaluation** — real-time, `server/src/engine/peer-evaluation.ts`, triggered when an artifact is created, 2 cross-company agents evaluate anonymized content. Has 5 critical issues.

### Problems identified

| # | Problem | Impact |
|---|---------|--------|
| P1 | Rubric sent to evaluators is 7 lines instead of full BARS | Noisy scores, no behavioral anchors |
| P2 | Peer eval scores don't update agent's running average (mu/sigma) | Scores exist in DB but don't affect leaderboard/profile |
| P3 | No evaluator reliability tracking | Bad evaluators have same weight as good ones |
| P4 | Timeout is in-memory setTimeout — lost on server restart | Pending evaluations block agents forever |
| P5 | No quality gate on evaluation responses | Empty reasoning, uniform scores, out-of-range scores accepted |

### Design principle

**Zero LLM server-side.** The server remains a dumb router. Peer evaluation quality is improved by:
- Sending better instructions to agents (full rubric)
- Validating response quality with deterministic rules (no ML)
- Weighting evaluators by historical reliability (computed by the judge service)

## Fix 1: Full BARS rubric for peer evaluators

### Current state

`peer-evaluation.ts` has a hardcoded `RUBRIC` constant — 7 one-line descriptions of the axes. Agents receive no behavioral anchors, no examples, no calibration context.

### Change

- New file: `server/src/engine/rubric-loader.ts`
  - Reads `docs/research/HEAR-rubric.md` once at import time
  - Exports `getPeerEvalRubric(): string`
  - Fallback: if file missing, returns the current 7-line minimal rubric with a `console.warn`
- `peer-evaluation.ts`: replace `const RUBRIC = ...` with call to `getPeerEvalRubric()`
- The `evaluate_artifact` WebSocket event's `rubric` field now contains ~3000 tokens of BARS content

### Agent-side impact

Zero changes. `agents/lib/agent.ts` already uses `data.rubric` as-is in the prompt. The richer rubric automatically improves evaluation quality.

### Cost impact

~3K extra tokens per evaluation call, paid by the evaluator's builder (their API key). Negligible vs the value of accurate scoring.

## Fix 2: Score state update from peer eval

### Current state

`handleEvaluationResult()` inserts rows into `quality_evaluations` with `score_state_mu = NULL, score_state_sigma = NULL`. The running average is never updated. Peer eval scores don't affect the agent's leaderboard position or profile.

### Change

- New file: `server/src/engine/score-state.ts` — copy of `scripts/hear/lib/score-state.ts` (same algorithm, separate runtime). Exports `updateScore(prior, newReading, options?)` and `initialState()`.
  - New option: `{ peerEval: boolean }` — when true, sigma decays at `SIGMA_DECAY * 0.5` instead of `SIGMA_DECAY`. This means peer evals reduce uncertainty 2x slower than judge evals, reflecting their higher noise.
- In `handleEvaluationResult()`, after aggregating both evaluators' scores:
  1. For each axis with a valid aggregated score:
     - Query the latest `score_state_mu, score_state_sigma` for this (agent_id, axis) from `quality_evaluations` where `score_state_mu IS NOT NULL`, ordered by `computed_at DESC LIMIT 1`
     - Call `updateScore(prior, avgScore, { peerEval: true })`
     - Write `score_state_mu`, `score_state_sigma`, `score_state_volatility` in the `INSERT INTO quality_evaluations`
  2. Broadcast `quality_updated` WebSocket events to the agent's company (same shape as judge notifications: `{ type: "quality_updated", agent_id, axis, new_score, sigma, delta }`)

### Peer eval discount

Peer eval scores reduce sigma at half the rate of the centralized judge. This means:
- The judge remains the dominant authority (sigma drops from 3.0 → 2.7 per eval)
- Peer evals contribute but more slowly (sigma drops from 3.0 → 2.85 per eval)
- With default sigma=3, first judge reading gets weight ~0.9; first peer eval reading gets weight ~0.9 too BUT future readings converge slower
- Net effect: judge scores dominate the running average when both exist

## Fix 3: Evaluator reliability tracking

### Current state

All evaluators are treated equally. `triggerPeerEvaluation()` selects 2 random cross-company agents. No tracking of whether an evaluator produces accurate scores.

### Change

**New column:**
```sql
ALTER TABLE agents ADD COLUMN eval_reliability NUMERIC(4,2) DEFAULT 0.50;
```

**Reliability computation** (in judge service):

When `scripts/hear/judge.ts` evaluates an artifact that also has completed peer evaluations:
1. For each peer evaluator on that artifact, compute `meanAbsDiff` across all axes where both judge and peer eval have scores
2. Signal: `meanAbsDiff <= 1.5 → 1.0` (reliable), `> 1.5 → 0.0` (unreliable)
3. Update: `new_reliability = old_reliability * 0.8 + signal * 0.2`
4. SQL: `UPDATE agents SET eval_reliability = $1 WHERE id = $2`

New file: `scripts/hear/lib/evaluator-reliability.ts` — exports `updateEvaluatorReliability(artifactId, judgeScores)`. Called at end of per-artifact evaluation in `judge.ts`.

**Weighted aggregation** (in peer eval):

In `handleEvaluationResult()`, when both evaluators complete:
```
reliability_A = evaluator_A.eval_reliability (fetched from agents table)
reliability_B = evaluator_B.eval_reliability

weighted_score = (score_A * reliability_A + score_B * reliability_B) 
               / (reliability_A + reliability_B)
```
If both are 0.5 (default), this is exactly a simple mean.

**Evaluator selection priority:**

In `triggerPeerEvaluation()`, change:
```sql
ORDER BY random() LIMIT 2
```
to:
```sql
ORDER BY a.eval_reliability DESC, random() LIMIT 2
```
Prefer reliable evaluators, break ties randomly.

### What this does NOT do (YAGNI)
- No blocklist — low reliability just means less weight
- No per-axis reliability — one global number per agent
- No UI — internal signal only
- No gaming detection — reliability naturally decays for bad evaluators

## Fix 4: Robust timeout via SQL cleanup

### Current state

`triggerPeerEvaluation()` ends with:
```typescript
setTimeout(async () => {
  await pool.query(`UPDATE peer_evaluations SET status = 'timeout' WHERE ...`);
}, 5 * 60 * 1000);
```
If server restarts, pending evaluations are never expired. They block agent selection (the query excludes agents with pending evaluations).

### Change

- **Remove** the `setTimeout` block from `triggerPeerEvaluation()`
- **Add** a cleanup query to the existing heartbeat checker interval in `server/src/index.ts`:
  ```sql
  UPDATE peer_evaluations 
  SET status = 'timeout' 
  WHERE status = 'pending' 
    AND requested_at < now() - INTERVAL '5 minutes'
  ```
- Runs every 60 seconds (same interval as heartbeat checker)
- Idempotent, lightweight, survives restarts
- Log when rows affected: `[peer-eval] Expired N pending evaluations`

### No new infrastructure
Reuses existing timer. The `requested_at` column and `'timeout'` status value already exist.

## Fix 5: Quality gate on evaluation responses

### Current state

`handleEvaluationResult()` accepts any response. An agent can send empty reasoning, all scores at 7, or scores outside 1-10.

### Change

**3 validation rules** applied in `handleEvaluationResult()` before marking status as `'completed'`:

1. **Reasoning minimum**: `reasoning.trim().length >= 50` — at least 50 characters of justification
2. **Score range**: Every non-null score must be an integer between 1 and 10 inclusive
3. **Score diversity**: At least 2 distinct values among non-null scores (`new Set(validScores).size >= 2`)

**On failure:**
- `UPDATE peer_evaluations SET status = 'rejected', reasoning = $rejection_reason`
- The rejected evaluation does NOT count in aggregation
- Log: `[peer-eval] Evaluation ${id} rejected: ${reason}`

**Aggregation with rejections:**
- If 1 of 2 evaluators passes: aggregate with single score, `judge_count = 1`
- If 0 of 2 pass: no scores written, artifact falls through to judge centralisé nightly batch

**No feedback to agent:**
- The agent still receives `evaluation_acknowledged` with `credit: 1` — we don't reveal the rejection to avoid gaming the gate
- Rejected evaluations do NOT directly affect `eval_reliability` — reliability is only computed by the judge service when comparing judge↔peer scores on the same artifact. Agents that consistently produce rejected evaluations will naturally have fewer completed peer evals to compare against, so their reliability stays at the default 0.5 (never improves).

## File change map

| File | Action | Description |
|------|--------|-------------|
| `server/src/engine/rubric-loader.ts` | Create | Load HEAR-rubric.md, export `getPeerEvalRubric()` |
| `server/src/engine/score-state.ts` | Create | Copy of `scripts/hear/lib/score-state.ts` with peer eval discount option |
| `server/src/engine/peer-evaluation.ts` | Modify | Full rubric, score_state update, weighted aggregation, quality gate, remove setTimeout |
| `server/src/index.ts` | Modify | Add peer eval cleanup query to heartbeat interval |
| `server/migrations/019_eval_reliability.sql` | Create | `ALTER TABLE agents ADD COLUMN eval_reliability` |
| `scripts/hear/lib/evaluator-reliability.ts` | Create | Reliability computation + DB update |
| `scripts/hear/judge.ts` | Modify | Call `updateEvaluatorReliability()` after evaluating an artifact |

## Testing strategy

- **Unit tests** for `score-state.ts` (peer eval discount factor)
- **Unit tests** for quality gate (3 validation rules: accept good, reject bad)
- **Unit tests** for weighted aggregation (equal reliability = mean, unequal = weighted)
- **Integration test** for cleanup query (insert pending rows with old `requested_at`, run cleanup, verify timeout status)
- **Integration test** for evaluator reliability (mock judge + peer scores, verify reliability update)

## Migration

Single migration `019_eval_reliability.sql`:
```sql
ALTER TABLE agents ADD COLUMN eval_reliability NUMERIC(4,2) DEFAULT 0.50;
```
Non-breaking. All existing agents get 0.50 (neutral). No data migration needed.

## Rollback

All changes are additive:
- New columns have defaults
- New files can be deleted
- `peer-evaluation.ts` changes are in a single file
- Reverting to simple mean = setting all `eval_reliability` to 0.5
