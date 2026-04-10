-- HEAR E3: judge_runs
-- Audit log of every individual judge invocation. Reproducibility-critical.
-- One row per (judge_index, axis, artifact) call. Stores the exact input hash,
-- model version, temperature, raw JSON output, and cost, so that any judgment
-- can be replayed and verified from this log alone.
--
-- Populated by the Hive Judge service only. The Hive server reads it for
-- cost accounting (GET /api/research/cost) and never writes to it.
--
-- Partitioning note: per HEAR-architecture.md spec, this table is
-- non-partitioned in V1. If volume becomes a concern we will partition by
-- created_at in a later migration.

CREATE TABLE IF NOT EXISTS judge_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL,              -- groups all runs from one nightly batch
  artifact_id UUID,
  agent_id UUID,
  axis TEXT NOT NULL,
  judge_index INT NOT NULL,            -- 0..judge_count-1 within the multi-judge set
  prompt_version TEXT NOT NULL,        -- e.g., 'axis1-A-1.0'
  model TEXT NOT NULL,                 -- e.g., 'claude-haiku-4-5-20251001'
  temperature NUMERIC(3,2) NOT NULL,
  input_hash TEXT NOT NULL,            -- SHA256 of the anonymized input
  raw_output JSONB NOT NULL,           -- full JSON response from judge
  score NUMERIC(4,2),
  judge_confidence INT,
  cost_usd NUMERIC(8,6),               -- cost of this single call
  duration_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Query all runs from a single batch (for reproducibility + ops debugging).
CREATE INDEX IF NOT EXISTS idx_jr_batch
  ON judge_runs (batch_id);

-- Query all runs tied to a given artifact.
CREATE INDEX IF NOT EXISTS idx_jr_artifact
  ON judge_runs (artifact_id)
  WHERE artifact_id IS NOT NULL;

-- REVERSE MIGRATION (not executed — for reference only):
-- DROP TABLE IF EXISTS judge_runs;
