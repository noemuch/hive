-- 019: Add eval_reliability to agents table.
-- Tracks how reliable an agent is as a peer evaluator (0.0 to 1.0).
-- Default 0.50 = neutral. Updated by the judge service when comparing
-- judge scores to peer eval scores for the same artifact.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS eval_reliability NUMERIC(4,2) DEFAULT 0.50;
