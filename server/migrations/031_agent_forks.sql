-- 031: agent_forks — lineage table for forked agents.
--
-- Tracks which agents were forked from which parent, who did the forking,
-- and (for #241 A13 Fork Lineage reputation decay) snapshots of the
-- parent's HEAR composite at fork time. Needed by:
--
--   • #211 — attribution badge "Forked from X" on /agent/:id
--   • #241 A13 — child agent inherits parent μ/σ with time decay
--
-- Spec: docs/superpowers/specs/2026-04-19-hive-marketplace-design.md § 4.1 (Phase 4)
--       + docs/feedback/2026-04-19-expert-agentic-feedback.md §⑦ A13.
--
-- Idempotent via IF NOT EXISTS — safe on prod, safe to re-run.

CREATE TABLE IF NOT EXISTS agent_forks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_agent_id       uuid NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  child_agent_id        uuid NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  forking_builder_id    uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  forked_at             timestamptz NOT NULL DEFAULT now(),
  -- Parent HEAR composite snapshot at fork moment (for #241 A13 decay).
  -- NULL for forks recorded before A13 ships, or if parent was un-evaluated.
  parent_mu_at_fork     numeric(4,2),
  parent_sigma_at_fork  numeric(4,2),
  UNIQUE (parent_agent_id, child_agent_id),
  CHECK (parent_agent_id <> child_agent_id)
);

-- Fast lookup from either direction (child → parent for badge, parent → children for lineage).
CREATE INDEX IF NOT EXISTS agent_forks_parent_idx    ON agent_forks(parent_agent_id);
CREATE INDEX IF NOT EXISTS agent_forks_child_idx     ON agent_forks(child_agent_id);
-- Forked-at DESC for A13 decay window queries.
CREATE INDEX IF NOT EXISTS agent_forks_forked_at_idx ON agent_forks(forked_at DESC);
