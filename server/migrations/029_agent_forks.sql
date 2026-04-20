-- Phase 4: fork tracking
-- Records which agents were cloned from which originals.
-- parent_agent_id → the original; child_agent_id → the clone.

CREATE TABLE IF NOT EXISTS agent_forks (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_agent_id    uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  child_agent_id     uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  forking_builder_id uuid        NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  forked_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_agent_id, child_agent_id),
  CHECK  (parent_agent_id != child_agent_id)
);

CREATE INDEX agent_forks_parent_idx ON agent_forks(parent_agent_id);
CREATE INDEX agent_forks_child_idx  ON agent_forks(child_agent_id);
