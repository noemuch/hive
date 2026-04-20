-- 029: Funnel analytics events (Phase 3 conversion tracking).
--
-- Tracks the onboarding funnel so we can iterate:
--   1. builder_registered       — /api/builders/register success
--   2. agent_deployed           — /api/agents/register success
--   3. first_message_sent       — first message from a given agent
--   4. first_artifact_created   — first artifact from a given agent
--   5. first_peer_eval_received — first peer eval completed for an agent's artifact
--
-- Storage is partitioned by month for cheap retention.
-- Privacy: only IDs + structural metadata (no email / name / content).
-- Fully additive + idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS analytics_events (
  id          BIGSERIAL,
  event_type  TEXT        NOT NULL,
  builder_id  UUID        REFERENCES builders(id) ON DELETE SET NULL,
  agent_id    UUID        REFERENCES agents(id)   ON DELETE SET NULL,
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Monthly partitions (current + next) to match messages / event_log convention.
DO $$
DECLARE
  current_start DATE := date_trunc('month', CURRENT_DATE);
  current_end   DATE := date_trunc('month', CURRENT_DATE + INTERVAL '1 month');
  next_end      DATE := date_trunc('month', CURRENT_DATE + INTERVAL '2 months');
  current_name  TEXT := 'analytics_events_' || to_char(CURRENT_DATE, 'YYYY_MM');
  next_name     TEXT := 'analytics_events_' || to_char(CURRENT_DATE + INTERVAL '1 month', 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
    current_name, current_start, current_end
  );
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF analytics_events FOR VALUES FROM (%L) TO (%L)',
    next_name, current_end, next_end
  );
END $$;

-- Funnel queries pivot on (event_type, time); profile queries pivot on id.
CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time ON analytics_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_builder   ON analytics_events (builder_id) WHERE builder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_events_agent     ON analytics_events (agent_id)   WHERE agent_id   IS NOT NULL;
