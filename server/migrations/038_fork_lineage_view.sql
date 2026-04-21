-- 038: Fork lineage — reputation inheritance with time decay (#241 A13).
-- MIGRATION_SLOT_PREFIX=202604211430
--
-- Builds on migration 031 (agent_forks table already has
-- parent_mu_at_fork + parent_sigma_at_fork snapshot columns).
--
-- Adds:
--   1. `agent_inherited_mu` VIEW exposing, for every (child, parent) fork row:
--        - days_since_fork
--        - inheritance_weight    = MAX(0, 0.25 * (1 - days_since_fork / 30))
--        - inherited_mu_component = parent_mu_at_fork * inheritance_weight
--        - effective_mu          = LEAST(10, COALESCE(child.score_state_mu, 0) + component)
--      The weight constants 0.25 / 30 MUST stay in sync with
--      server/src/db/fork-inheritance.ts (INHERITANCE_MAX_WEIGHT / INHERITANCE_WINDOW_DAYS).
--
--   2. `prevent_self_fork()` trigger function + BEFORE INSERT trigger on agent_forks.
--      Self-fork detection: RAISE when `forking_builder_id` equals the parent
--      agent's `builder_id`. This is the "cannot game via self-fork" acceptance
--      criterion — builders forking their OWN agents gain no inheritance bonus
--      because those forks are rejected at the DB layer. (Different builders
--      forking one parent remain legitimate — that's the whole marketplace.)
--
-- Idempotent via CREATE OR REPLACE / DROP TRIGGER IF EXISTS so it's safe to
-- re-run on prod and in CI.

CREATE OR REPLACE VIEW agent_inherited_mu AS
SELECT
  af.child_agent_id                                                 AS agent_id,
  af.parent_agent_id,
  af.forked_at,
  af.parent_mu_at_fork,
  af.parent_sigma_at_fork,
  GREATEST(0, EXTRACT(EPOCH FROM (now() - af.forked_at)) / 86400.0)::numeric AS days_since_fork,
  GREATEST(
    0,
    0.25 * (1.0 - LEAST(1.0, GREATEST(0, EXTRACT(EPOCH FROM (now() - af.forked_at)) / 86400.0) / 30.0))
  )::numeric(6,4)                                                   AS inheritance_weight,
  COALESCE(
    af.parent_mu_at_fork * GREATEST(
      0,
      0.25 * (1.0 - LEAST(1.0, GREATEST(0, EXTRACT(EPOCH FROM (now() - af.forked_at)) / 86400.0) / 30.0))
    ),
    0
  )::numeric(6,2)                                                   AS inherited_mu_component,
  -- effective_mu: capped at 10, NULL only if both components are NULL.
  CASE
    WHEN child.score_state_mu IS NULL AND af.parent_mu_at_fork IS NULL THEN NULL
    ELSE LEAST(
      10.0,
      COALESCE(child.score_state_mu, 0) + COALESCE(
        af.parent_mu_at_fork * GREATEST(
          0,
          0.25 * (1.0 - LEAST(1.0, GREATEST(0, EXTRACT(EPOCH FROM (now() - af.forked_at)) / 86400.0) / 30.0))
        ),
        0
      )
    )
  END::numeric(4,2)                                                 AS effective_mu,
  GREATEST(0, 30 - GREATEST(0, EXTRACT(EPOCH FROM (now() - af.forked_at)) / 86400.0))::int AS days_remaining
FROM agent_forks af
JOIN agents child ON child.id = af.child_agent_id;

COMMENT ON VIEW agent_inherited_mu IS
  'Fork reputation inheritance with 30-day linear decay (#241 A13). '
  'Keeps constants in sync with server/src/db/fork-inheritance.ts.';

-- ---------------------------------------------------------------------------
-- Self-fork guard (acceptance criterion: "Cannot game via self-fork").
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION prevent_self_fork()
RETURNS TRIGGER AS $$
DECLARE
  parent_builder uuid;
BEGIN
  SELECT builder_id INTO parent_builder
  FROM agents
  WHERE id = NEW.parent_agent_id;

  IF parent_builder IS NOT NULL AND parent_builder = NEW.forking_builder_id THEN
    RAISE EXCEPTION 'cannot_fork_own_agent: builder % cannot fork their own agent %',
      NEW.forking_builder_id, NEW.parent_agent_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_forks_no_self_fork ON agent_forks;
CREATE TRIGGER agent_forks_no_self_fork
BEFORE INSERT ON agent_forks
FOR EACH ROW EXECUTE FUNCTION prevent_self_fork();
