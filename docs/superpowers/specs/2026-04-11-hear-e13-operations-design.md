# HEAR E13 — Operations & Deployment

**Date:** 2026-04-11
**Issue:** #120
**Branch:** feat/120-hear-e13-operations-deployment
**Milestone:** HEAR V1 — Sunday April 12

## Scope

Four tasks remaining after V1 rescope (Cloudflare Workers deferred to #129):

| Task | What |
|------|------|
| E13-1 | Railway deployment → deferred to #129 (Thomas) |
| E13-2 | Cost dashboard `/api/research/cost` → **already done** |
| E13-3 | Calibration set backup |
| E13-4 | CI for adversarial tests |
| E13-5 | Disaster recovery: batch score invalidation |

---

## E13-3 — Calibration Set Backup

### Decision

Git is the backup. The calibration set is a static asset (~50 items, ~200kb). No cloud storage, no cron, no extra infrastructure.

### Implementation

**New file:** `scripts/hear/backup-calibration.ts`

Connects to Postgres, dumps `calibration_set` + `calibration_grades` as idempotent SQL (`INSERT INTO ... ON CONFLICT DO NOTHING`). Writes to `docs/research/calibration/backup/calibration-dump.sql`.

Run manually after any calibration item is added:
```bash
bun run scripts/hear/backup-calibration.ts
```

**New file:** `docs/research/calibration/backup/RESTORE.md`

```md
# Restore Calibration Set

1. Ensure DATABASE_URL is set and the schema migrations have run.
2. psql $DATABASE_URL < docs/research/calibration/backup/calibration-dump.sql
3. Verify: bun run scripts/hear/compute-agreement.ts
```

**Output file (committed to git):** `docs/research/calibration/backup/calibration-dump.sql`

Generated SQL format:
```sql
-- HEAR calibration set backup — generated 2026-04-11T...
-- Run: psql $DATABASE_URL < this-file.sql

INSERT INTO calibration_set (id, artifact_content, artifact_type, rubric_version, added_at)
VALUES (...)
ON CONFLICT (id) DO NOTHING;

INSERT INTO calibration_grades (id, calibration_id, grader_id, axis, score, justification, graded_at)
VALUES (...)
ON CONFLICT (id) DO NOTHING;
```

---

## E13-4 — CI for Adversarial Tests

### Decision

Mock-based CI (option B): subprocess `claude` is stubbed, no Anthropic API calls in CI. Golden fixtures from the calibration set catch prompt regressions. Runs in < 10s.

### Trigger

`.github/workflows/hear-ci.yml` — fires on push and PR when paths match:
- `scripts/hear/**`
- `docs/research/calibration/**`

### Test structure

```
scripts/hear/__tests__/
  cost.test.ts            — CostMonitor unit tests
  anonymizer.test.ts      — Content anonymization tests
  orchestrator.test.ts    — evaluateArtifact with mocked callClaudeCli
  golden.test.ts          — 5 calibration fixtures, score within ±1
  fixtures/
    judge-excellent.json  — mock output: all axes score 8–9
    judge-poor.json       — mock output: all axes score 2–3
    judge-average.json    — mock output: all axes score 5–6
```

**cost.test.ts** covers:
- `assertCanSpend` throws `BudgetExceededError` when daily cap exceeded
- `assertCanSpend` throws `BudgetExceededError` when monthly cap exceeded
- `record` accumulates spend correctly
- `hydrateCostMonitor` sets correct initial values from mock pool

**anonymizer.test.ts** covers:
- UUIDs are replaced
- Agent names (from name map) are stripped
- ISO timestamps are removed
- Content remains semantically intact (word count roughly preserved)

**orchestrator.test.ts** covers:
- `evaluateArtifact` returns all 7 HEAR axes (V1 scope — `persona_coherence` deferred to V2)
- Each axis has `score` in [1–10], `reasoning` string, `disagreement` number
- `judgeRuns` array has 2 entries per axis (2 judges × 7 axes = 14)
- Cost is recorded on the monitor after evaluation

**golden.test.ts** covers:
- 5 golden items (drawn from calibration set items 001, 004, 009, 019, 029)
- Expected score ranges: excellent ≥ 7, poor ≤ 4, average 4–7
- Test fails if aggregated score is outside expected range ± 1

### CI workflow

```yaml
# .github/workflows/hear-ci.yml
name: HEAR CI
on:
  push:
    paths: ['scripts/hear/**', 'docs/research/calibration/**']
  pull_request:
    paths: ['scripts/hear/**', 'docs/research/calibration/**']

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test scripts/hear/__tests__
```

---

## E13-5 — Disaster Recovery: Batch Invalidation

### Decision

Soft-delete approach: add `invalidated_at` + `invalidation_reason` to both `quality_evaluations` and `judge_runs`. Invalidated rows are excluded from public queries but never deleted (audit log preserved).

### Migration: `017_batch_invalidation.sql`

```sql
ALTER TABLE quality_evaluations
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

ALTER TABLE judge_runs
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidation_reason TEXT;

-- Index for the common query: active evaluations only
CREATE INDEX IF NOT EXISTS idx_qe_active
  ON quality_evaluations (agent_id, axis, computed_at DESC)
  WHERE invalidated_at IS NULL;
```

### Endpoint: `POST /api/internal/quality/invalidate-batch`

**Auth:** `X-Hive-Internal-Token` header (same as `/api/internal/quality/notify`)

**Request:**
```json
{ "batch_id": "uuid", "reason": "judge bug — prompt v1.0 underscored spec artifacts" }
```

**Logic (single transaction):**
1. Validate `batch_id` is a UUID, `reason` is non-empty
2. `UPDATE judge_runs SET invalidated_at = now(), invalidation_reason = $reason WHERE batch_id = $batch_id AND invalidated_at IS NULL`
3. Collect the `artifact_id`s from those runs
4. `UPDATE quality_evaluations SET invalidated_at = now(), invalidation_reason = $reason WHERE artifact_id = ANY($artifact_ids) AND invalidated_at IS NULL`
5. Return `{ ok: true, runs_invalidated: N, evaluations_invalidated: M }`

**Response:**
```json
{ "ok": true, "runs_invalidated": 48, "evaluations_invalidated": 6 }
```

### Query filter

All public-facing queries that read scores must add:
```sql
WHERE invalidated_at IS NULL
```

Affected queries:
- `/api/research/cost` — already filters by `created_at`, add `AND invalidated_at IS NULL` on `judge_runs`
- Leaderboard / agent profile score queries (when implemented)

### Disaster recovery procedure

**New file:** `docs/research/DISASTER-RECOVERY.md`

```md
# HEAR Disaster Recovery — Score Invalidation

Use this procedure when a judge bug is detected that produced systematically wrong scores for a batch.

## Step 1 — Identify the batch

SELECT DISTINCT batch_id, MIN(created_at), COUNT(*)
FROM judge_runs
WHERE created_at > '<suspected window>'
GROUP BY batch_id
ORDER BY MIN(created_at);

## Step 2 — Invalidate the batch

curl -X POST https://<HIVE_URL>/api/internal/quality/invalidate-batch \
  -H "X-Hive-Internal-Token: $HIVE_INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batch_id": "<uuid>", "reason": "<description of the bug>"}'

Expected response: { "ok": true, "runs_invalidated": N, "evaluations_invalidated": M }

## Step 3 — Verify

SELECT COUNT(*) FROM judge_runs WHERE batch_id = '<uuid>' AND invalidated_at IS NULL;
-- Should return 0.

## Step 4 — Re-run the judge (optional)

If the bug is fixed, re-run the judge for the affected date range:
bun run scripts/hear/judge.ts --since <ISO date>
```

---

## What is NOT in this spec

- **E13-1 Railway setup** → #129 (Thomas)
- **E13-2 cost endpoint** → already implemented in `server/src/index.ts:872`
- `.env.example` HEAR vars → already added to `.env.example`
