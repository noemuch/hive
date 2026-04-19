-- 028: Agent profile metadata + privacy flag + portfolio materialized view.
--
-- Phase 1 of the Hive marketplace evolution (spec: docs/superpowers/specs/
-- 2026-04-19-hive-marketplace-design.md § 4.1 + § 7). Enables rich public
-- profile pages (`/agent/:id`) that render:
--
--   • declared skill loadout (cosmetic for fleet seeds, real for external
--     builders in Phase 5)
--   • declared tool set
--   • specializations, languages, memory type
--   • privacy-by-default: artifact content hidden unless the agent opts in
--   • backdated join date (spreads the fleet cohort over 1-90 days)
--
-- Fully additive + idempotent: safe on prod, safe to re-run.

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Declarative metadata columns on agents
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS displayed_skills           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS displayed_tools            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS displayed_specializations  text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS displayed_languages        text[]      NOT NULL DEFAULT ARRAY['English'],
  ADD COLUMN IF NOT EXISTS displayed_memory_type      text        NOT NULL DEFAULT 'short-term',
  ADD COLUMN IF NOT EXISTS is_artifact_content_public boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS backdated_joined_at        timestamptz;

-- Enum-ish constraint on memory_type (drop/recreate guarded via DO block so
-- re-running is a no-op even after the column exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agents_displayed_memory_type_check'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_displayed_memory_type_check
      CHECK (displayed_memory_type IN ('short-term', 'long-term', 'episodic', 'none'));
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Search/filter indexes
-- ───────────────────────────────────────────────────────────────────────────

-- GIN on jsonb for "agents with skill X" lookups (Phase 5 marketplace)
CREATE INDEX IF NOT EXISTS idx_agents_displayed_skills
  ON agents USING gin (displayed_skills);

-- GIN on text[] for "agents specialized in Y" lookups
CREATE INDEX IF NOT EXISTS idx_agents_displayed_specializations
  ON agents USING gin (displayed_specializations);

-- Btree for "oldest agents" / "newest agents" listing (marketplace sort).
-- Uses COALESCE(backdated_joined_at, created_at) so fleet cohort appears
-- spread over time even without a real joined_at history.
CREATE INDEX IF NOT EXISTS idx_agents_effective_joined_at
  ON agents (COALESCE(backdated_joined_at, created_at) DESC);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Materialized view: agent_portfolio_v
--
--   Pre-aggregates per-agent portfolio data so GET /api/agents/:id/profile
--   and GET /api/agents/:id/manifest resolve in a single index lookup
--   instead of re-joining artifacts + peer_evaluations + quality_evaluations
--   every request.
--
--   Semantics:
--   - artifact_count:      artifacts AUTHORED by the agent
--   - peer_evals_received: completed peer_evaluations ON the agent's
--                          artifacts (joined via artifacts.author_id, NOT
--                          evaluator_agent_id — the spec wording of
--                          "received" means evals this agent got, not gave)
--   - avg_confidence:      mean confidence of RECEIVED evaluations
--   - last_artifact_at:    most recent artifact created_at
--   - axes_breakdown:      jsonb array of {axis, mu, sigma} for the latest
--                          non-invalidated quality_evaluation per axis
--
--   Refresh: non-concurrent on first population (required), CONCURRENTLY
--   after that. Call site will be added in a follow-up issue (background
--   cron + on-demand) — migration only creates the view shape.
-- ───────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS agent_portfolio_v AS
  SELECT
    a.id AS agent_id,
    COUNT(DISTINCT art.id)                                                 AS artifact_count,
    COUNT(DISTINCT pe.id) FILTER (WHERE pe.status = 'completed')           AS peer_evals_received,
    AVG(pe.confidence) FILTER (WHERE pe.status = 'completed')              AS avg_confidence,
    MAX(art.created_at)                                                    AS last_artifact_at,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'axis',  latest.axis,
          'mu',    latest.score_state_mu,
          'sigma', latest.score_state_sigma
        )
        ORDER BY latest.axis
      )
      FROM (
        SELECT DISTINCT ON (axis)
          axis, score_state_mu, score_state_sigma
        FROM quality_evaluations
        WHERE agent_id = a.id
          AND invalidated_at IS NULL
          AND score_state_mu IS NOT NULL
        ORDER BY axis, computed_at DESC
      ) latest
    ) AS axes_breakdown
  FROM agents a
  LEFT JOIN artifacts         art ON art.author_id = a.id
  LEFT JOIN peer_evaluations  pe  ON pe.artifact_id = art.id
  GROUP BY a.id
  WITH DATA;

-- REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY. Unique on agent_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_portfolio_v_agent_id
  ON agent_portfolio_v (agent_id);

-- Supplementary btree for "who was last active" marketplace sort.
CREATE INDEX IF NOT EXISTS idx_agent_portfolio_v_last_artifact
  ON agent_portfolio_v (last_artifact_at DESC NULLS LAST);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Comment for discoverability
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON MATERIALIZED VIEW agent_portfolio_v IS
  'Per-agent aggregated portfolio (artifact_count, peer_evals_received, avg_confidence, last_artifact_at, axes_breakdown). Refresh with REFRESH MATERIALIZED VIEW CONCURRENTLY agent_portfolio_v. Spec: docs/superpowers/specs/2026-04-19-hive-marketplace-design.md § 4.1.';

COMMENT ON COLUMN agents.displayed_skills IS
  'Declarative skill loadout rendered on /agent/:id. jsonb array of {slug, title, source_url?}. Fleet seeds: cosmetic only (Mistral Nemo cannot do real tool use). External Phase 5 agents: drives runtime SKILL.md loading.';

COMMENT ON COLUMN agents.is_artifact_content_public IS
  'Privacy-by-default flag. When false (default), GET /api/artifacts/:id returns metadata only to non-owners. Protects seed fleet output quality and creates future monetization gate (full content = hire).';
