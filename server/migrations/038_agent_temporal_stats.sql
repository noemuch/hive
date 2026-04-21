-- 038: Temporal credibility — per-agent tenure + score evolution + stability.
--
-- MIGRATION_SLOT_PREFIX=202604211430
--
-- Adds the "TIME as a differentiator" dimension (issue #236 / A14). No
-- competitor marketplace (Agent.ai, Poe, Character.ai, skills.sh) surfaces
-- long-tail defensibility; Hive makes *"consistently good for 2 years"* a
-- visible, filterable claim.
--
-- Changes (all additive + idempotent):
--   1. agents.first_score_at — when the first peer-eval / judge row landed.
--      Populated by a one-shot backfill below + by recomputeAgentScoreState()
--      on future writes (set once, never updated).
--   2. MATERIALIZED VIEW agent_temporal_stats — pre-aggregates:
--        • days_active (from COALESCE(backdated_joined_at, created_at))
--        • first_score_at
--        • mu_evolution jsonb  — {month, mu, sigma, n_evals}[] for last 24 mo
--        • stability_score     — STDDEV of μ over rolling 90-day window
--                                (lower = more stable). NULL if <3 daily samples.
--        • consistency_badge   — text label: 'Stable μ ≥ 7.5 for 365 days' / 'New' / etc.
--
-- Refresh contract:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY agent_temporal_stats
--   Called best-effort from server/src/db/temporal-refresh.ts after quality
--   notify batches (1h debounce). Long-term a GitHub Actions nightly cron
--   should own this; that workflow wire-up is deferred to a follow-up (App
--   permissions block workflow edits).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. first_score_at snapshot on agents
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE agents ADD COLUMN IF NOT EXISTS first_score_at timestamptz;

-- Backfill: oldest non-invalidated quality_evaluation per agent.
UPDATE agents a
SET first_score_at = first_eval.computed_at
FROM (
  SELECT agent_id, MIN(computed_at) AS computed_at
  FROM quality_evaluations
  WHERE invalidated_at IS NULL
    AND score_state_mu IS NOT NULL
  GROUP BY agent_id
) first_eval
WHERE first_eval.agent_id = a.id
  AND a.first_score_at IS NULL;

-- Index for "evaluated for ≥ N days" marketplace filters.
CREATE INDEX IF NOT EXISTS idx_agents_first_score_at
  ON agents (first_score_at DESC NULLS LAST)
  WHERE status <> 'retired';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Helper: consistency_badge rule (inlined in MV, documented here)
-- ───────────────────────────────────────────────────────────────────────────
--
-- Semantics (applied in the MV):
--   days_since_first = EXTRACT(DAY FROM now() - first_score_at)
--
--   Qualifying labels (first match wins, top to bottom):
--     - 'Stable μ ≥ 7.5 for 365 days'   if days_since_first >= 365 AND stability_score < 0.3 AND current_mu >= 7.5
--     - 'Stable μ ≥ 7.0 for 180 days'   if days_since_first >= 180 AND stability_score < 0.4 AND current_mu >= 7.0
--     - 'Stable μ ≥ 6.5 for 90 days'    if days_since_first >= 90  AND stability_score < 0.5 AND current_mu >= 6.5
--     - 'Evolving'                       if stability_score IS NOT NULL AND stability_score >= 0.6
--     - 'New'                            if first_score_at IS NULL OR days_since_first < 30
--     - NULL                             otherwise (not enough signal yet)
--
-- The thresholds are defensible but not load-bearing for this migration;
-- rule tuning can happen in a pure-SQL follow-up (no schema change).

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Materialized view: agent_temporal_stats
-- ───────────────────────────────────────────────────────────────────────────
--
-- Drop + recreate pattern (not CREATE OR REPLACE) so migration is safe to
-- rerun when the shape is edited in a follow-up. Idempotency via DROP IF EXISTS.

DROP MATERIALIZED VIEW IF EXISTS agent_temporal_stats CASCADE;

CREATE MATERIALIZED VIEW agent_temporal_stats AS
WITH monthly AS (
  -- Last 24 months of per-agent, per-month HEAR composite.
  SELECT
    qe.agent_id,
    date_trunc('month', qe.computed_at)::date     AS month,
    AVG(qe.score_state_mu)::numeric(6,2)          AS mu,
    AVG(qe.score_state_sigma)::numeric(6,2)       AS sigma,
    COUNT(*)::int                                 AS n_evals
  FROM quality_evaluations qe
  WHERE qe.invalidated_at IS NULL
    AND qe.score_state_mu IS NOT NULL
    AND qe.computed_at > now() - INTERVAL '24 months'
  GROUP BY qe.agent_id, date_trunc('month', qe.computed_at)
),
evolution_agg AS (
  SELECT
    agent_id,
    jsonb_agg(
      jsonb_build_object(
        'month',  to_char(month, 'YYYY-MM'),
        'mu',     mu,
        'sigma',  sigma,
        'n_evals', n_evals
      )
      ORDER BY month
    ) AS mu_evolution
  FROM monthly
  GROUP BY agent_id
),
daily AS (
  -- Last 90 days, per-agent, per-day average μ — input to stability stddev.
  SELECT
    qe.agent_id,
    DATE(qe.computed_at)          AS day,
    AVG(qe.score_state_mu)::float AS mu
  FROM quality_evaluations qe
  WHERE qe.invalidated_at IS NULL
    AND qe.score_state_mu IS NOT NULL
    AND qe.computed_at > now() - INTERVAL '90 days'
  GROUP BY qe.agent_id, DATE(qe.computed_at)
),
stability AS (
  SELECT
    agent_id,
    CASE WHEN COUNT(*) >= 3
         THEN STDDEV_POP(mu)::numeric(4,2)
         ELSE NULL END            AS stability_score,
    COUNT(*)::int                 AS stability_sample_days
  FROM daily
  GROUP BY agent_id
)
SELECT
  a.id                                                                    AS agent_id,
  a.first_score_at,
  GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(a.backdated_joined_at, a.created_at))) / 86400)::int
  )                                                                       AS days_active,
  CASE WHEN a.first_score_at IS NOT NULL
       THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - a.first_score_at)) / 86400)::int)
       ELSE NULL END                                                      AS days_since_first_score,
  COALESCE(e.mu_evolution, '[]'::jsonb)                                   AS mu_evolution,
  s.stability_score,
  s.stability_sample_days,
  CASE
    WHEN a.first_score_at IS NULL THEN 'New'
    WHEN EXTRACT(DAY FROM (now() - a.first_score_at)) >= 365
         AND s.stability_score IS NOT NULL AND s.stability_score < 0.3
         AND a.score_state_mu IS NOT NULL AND a.score_state_mu >= 7.5
      THEN 'Stable μ ≥ 7.5 for 365 days'
    WHEN EXTRACT(DAY FROM (now() - a.first_score_at)) >= 180
         AND s.stability_score IS NOT NULL AND s.stability_score < 0.4
         AND a.score_state_mu IS NOT NULL AND a.score_state_mu >= 7.0
      THEN 'Stable μ ≥ 7.0 for 180 days'
    WHEN EXTRACT(DAY FROM (now() - a.first_score_at)) >= 90
         AND s.stability_score IS NOT NULL AND s.stability_score < 0.5
         AND a.score_state_mu IS NOT NULL AND a.score_state_mu >= 6.5
      THEN 'Stable μ ≥ 6.5 for 90 days'
    WHEN s.stability_score IS NOT NULL AND s.stability_score >= 0.6
      THEN 'Evolving'
    WHEN EXTRACT(DAY FROM (now() - a.first_score_at)) < 30
      THEN 'New'
    ELSE NULL
  END                                                                     AS consistency_badge,
  now()                                                                   AS computed_at
FROM agents a
LEFT JOIN evolution_agg e ON e.agent_id = a.id
LEFT JOIN stability     s ON s.agent_id = a.id
WHERE a.status <> 'retired'
WITH DATA;

-- REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX idx_agent_temporal_stats_agent_id
  ON agent_temporal_stats (agent_id);

-- Supplementary indexes for marketplace sort/filter paths.
CREATE INDEX idx_agent_temporal_stats_days_active
  ON agent_temporal_stats (days_active DESC);

CREATE INDEX idx_agent_temporal_stats_stability
  ON agent_temporal_stats (stability_score ASC NULLS LAST);

CREATE INDEX idx_agent_temporal_stats_consistency
  ON agent_temporal_stats (consistency_badge);

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Documentation
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN agents.first_score_at IS
  'Timestamp of the first non-invalidated quality_evaluation row for this agent. Set once by recomputeAgentScoreState and never updated. Drives the "evaluated for N days" marketplace filter + temporal credibility badge.';

COMMENT ON MATERIALIZED VIEW agent_temporal_stats IS
  'Per-agent temporal credibility: days_active, first_score_at, 24-month mu_evolution jsonb, 90-day rolling stability_score (stddev of μ), consistency_badge. Refresh with REFRESH MATERIALIZED VIEW CONCURRENTLY agent_temporal_stats (see server/src/db/temporal-refresh.ts). Spec: #236 / A14.';
