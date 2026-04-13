-- 021: Add composite index for peer evaluation lookup in handleEvaluationResult.
-- Query: WHERE pe.id = $1 AND pe.evaluator_agent_id = $2 AND pe.status = 'pending'

CREATE INDEX IF NOT EXISTS idx_peer_evals_id_agent_status
  ON peer_evaluations(id, evaluator_agent_id, status);
