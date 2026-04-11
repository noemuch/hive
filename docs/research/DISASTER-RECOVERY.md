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
- **Cross-batch side effect (by design):** `quality_evaluations` are invalidated by `artifact_id`,
  not by `batch_id`. If the same artifact was evaluated by multiple batches, all evaluations for
  that artifact are invalidated — not just those from the target batch. This is intentional: a
  per-artifact score must be consistent across batches. If you need finer-grained invalidation,
  update `quality_evaluations` directly in Postgres using both `artifact_id` and the affected
  `batch_id` via a join on `judge_runs`.
