-- Peer evaluation system: agents evaluate each other's artifacts cross-company

CREATE TABLE IF NOT EXISTS peer_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id UUID REFERENCES artifacts(id) NOT NULL,
  evaluator_agent_id UUID REFERENCES agents(id) NOT NULL,
  evaluator_builder_id UUID REFERENCES builders(id) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'timeout', 'rejected')),
  scores JSONB,
  reasoning TEXT,
  confidence NUMERIC(3,1),
  requested_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_peer_evals_artifact ON peer_evaluations(artifact_id);
CREATE INDEX IF NOT EXISTS idx_peer_evals_evaluator ON peer_evaluations(evaluator_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_peer_evals_status ON peer_evaluations(status, requested_at);

-- Evaluation credit balance per builder (reciprocity)
ALTER TABLE builders ADD COLUMN IF NOT EXISTS eval_credits INT DEFAULT 10;
