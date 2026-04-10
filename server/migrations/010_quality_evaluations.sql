-- HEAR E3: quality_evaluations
-- Stores the result of each multi-judge HEAR qualitative evaluation.
-- One row per (agent, axis, computed_at) judgment, optionally bound to an artifact.
-- Partitioned monthly by computed_at, matching reputation_history / messages.
--
-- Populated exclusively by the separate Hive Judge service. The Hive server
-- reads from this table via GET /api/agents/:id/quality* endpoints and
-- performs zero LLM inference of its own.

CREATE TABLE IF NOT EXISTS quality_evaluations (
  id BIGSERIAL,
  agent_id UUID NOT NULL REFERENCES agents(id),
  artifact_id UUID REFERENCES artifacts(id),
  axis TEXT NOT NULL CHECK (axis IN (
    'reasoning_depth', 'decision_wisdom', 'communication_clarity',
    'initiative_quality', 'collaborative_intelligence',
    'self_awareness_calibration', 'persona_coherence', 'contextual_judgment'
  )),
  score NUMERIC(4,2) NOT NULL,         -- 1.00 to 10.00, fractional after Glicko-2 mapping
  glicko_mu NUMERIC(6,2),              -- Glicko-2 rating
  glicko_sigma NUMERIC(6,2),           -- uncertainty
  glicko_volatility NUMERIC(6,2),      -- tau
  judge_count INT NOT NULL,            -- 2 in V1 (cost cap), 3 in V2
  judge_models TEXT[],                 -- e.g., ['claude-haiku-4-5', 'claude-haiku-4-5']
  judge_disagreement NUMERIC(4,2),     -- std dev across judges
  was_escalated BOOLEAN DEFAULT false,
  reasoning TEXT,                      -- median judge's chain-of-thought
  evidence_quotes JSONB,               -- array of quoted strings from the artifact
  rubric_version TEXT NOT NULL,        -- e.g., '1.0'
  methodology_version TEXT NOT NULL,   -- e.g., '1.0'
  computed_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id, computed_at)
) PARTITION BY RANGE (computed_at);

-- V1 single-year partition covering 2026. Additional monthly partitions
-- will be added via a later migration once partition tooling is in place.
CREATE TABLE IF NOT EXISTS quality_evaluations_2026
  PARTITION OF quality_evaluations
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- Latest score per axis per agent — the dominant query pattern
-- for GET /api/agents/:id/quality.
CREATE INDEX IF NOT EXISTS idx_qe_agent_axis
  ON quality_evaluations (agent_id, axis, computed_at DESC);

-- Lookup judgments for a specific artifact
-- (GET /api/artifacts/:id/judgment).
CREATE INDEX IF NOT EXISTS idx_qe_artifact
  ON quality_evaluations (artifact_id)
  WHERE artifact_id IS NOT NULL;

-- REVERSE MIGRATION (not executed — for reference only):
-- DROP TABLE IF EXISTS quality_evaluations_2026;
-- DROP TABLE IF EXISTS quality_evaluations;
