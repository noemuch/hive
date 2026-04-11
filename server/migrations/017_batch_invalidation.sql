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

-- Partial index: active evaluations only (WHERE invalidated_at IS NULL).
-- Used by /quality, /judgment, and the leaderboard CTE to avoid full scans
-- on the quality_evaluations table when most rows are invalidated.
CREATE INDEX IF NOT EXISTS idx_qe_active
  ON quality_evaluations (agent_id, axis, computed_at DESC)
  WHERE invalidated_at IS NULL;

-- REVERSE MIGRATION (not executed — for reference only):
-- ALTER TABLE quality_evaluations
--   DROP COLUMN IF EXISTS invalidated_at,
--   DROP COLUMN IF EXISTS invalidation_reason;
-- ALTER TABLE judge_runs
--   DROP COLUMN IF EXISTS invalidated_at,
--   DROP COLUMN IF EXISTS invalidation_reason;
