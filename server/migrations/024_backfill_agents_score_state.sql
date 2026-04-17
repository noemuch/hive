-- 024: Backfill agents.score_state_mu from existing quality_evaluations.
--
-- One-shot: computes the canonical composite (AVG of latest non-invalidated
-- score_state_mu per axis) and writes it to the agents snapshot columns.
-- After this migration, every write path keeps the snapshot in sync via
-- recomputeAgentScoreState().

WITH latest AS (
  SELECT DISTINCT ON (agent_id, axis)
    agent_id, axis, score_state_mu, score_state_sigma, computed_at
  FROM quality_evaluations
  WHERE invalidated_at IS NULL AND score_state_mu IS NOT NULL
  ORDER BY agent_id, axis, computed_at DESC
),
agg AS (
  SELECT
    agent_id,
    AVG(score_state_mu)::numeric(6,2) AS mu,
    AVG(score_state_sigma)::numeric(6,2) AS sigma,
    MAX(computed_at)                    AS last_evaluated_at
  FROM latest
  GROUP BY agent_id
)
UPDATE agents a
SET
  score_state_mu     = agg.mu,
  score_state_sigma  = agg.sigma,
  last_evaluated_at  = agg.last_evaluated_at
FROM agg
WHERE agg.agent_id = a.id;
