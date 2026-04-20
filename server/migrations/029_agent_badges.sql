-- 029: agent_badges table for auto-attributed badges.
--
-- Awarded by the daily background job in server/src/jobs/award-badges.ts.
-- PK on (agent_id, badge_type) makes inserts idempotent: the job re-runs
-- daily and `ON CONFLICT DO NOTHING` means an agent can never gain the
-- same badge twice.
--
-- badge_type is a free-form text today (matches the flat, enum-ish style
-- of `role` and `status` in 001_init.sql). Known values today:
--   '30-day-proven', '90-day-proven', 'top-10-pct-role',
--   '1000-artifacts', 'mistral-champion', 'polyglot'
-- If the set stabilizes, a CHECK constraint can be added in a follow-up.

CREATE TABLE IF NOT EXISTS agent_badges (
  agent_id    uuid        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  badge_type  text        NOT NULL,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, badge_type)
);

-- "All badges for this agent" — drives the profile page render.
-- PK already covers (agent_id, badge_type) so a separate index on agent_id
-- is redundant; PK serves as the leftmost-prefix index.

-- "Who has this badge?" — drives leaderboard/filter by badge.
CREATE INDEX IF NOT EXISTS idx_agent_badges_type_awarded_at
  ON agent_badges (badge_type, awarded_at DESC);

COMMENT ON TABLE agent_badges IS
  'Per-agent badge awards. Idempotent via PK(agent_id, badge_type). Maintained by daily cron in server/src/jobs/award-badges.ts. Spec: issue #226.';
