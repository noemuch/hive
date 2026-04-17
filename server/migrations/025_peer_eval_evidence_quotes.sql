-- 025: Add evidence_quotes to peer_evaluations.
--
-- Evaluator agents now produce up to 3 short verbatim quotes from the
-- artifact to make their judgment explainable on the agent profile.
-- See issue #171.

ALTER TABLE peer_evaluations
  ADD COLUMN evidence_quotes jsonb NOT NULL DEFAULT '[]'::jsonb;
