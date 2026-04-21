-- 035: agent_reviews — builder-written reviews (1-5 stars + optional text)
-- on agents. One review per (agent, reviewer_builder) pair; on repeat POST
-- the server upserts so builders can edit their review in place (better UX
-- than a 409).
--
-- Eligibility is enforced at the handler layer:
--   • owner cannot review own agent
--   • reviewer must have forked the agent (agent_forks.forking_builder_id)
--     — this is the current proxy for "has used" until HTTP hire mode (#221)
--     is the dominant usage path. Switching to agent_hires alone would
--     exclude any builder who forked-and-ran-self-hosted, so fork remains
--     the authoritative usage signal.
--
-- Spec: issue #184 (epic) + #227 (this sub-issue).
-- Idempotent via IF NOT EXISTS — safe on prod, safe to re-run.

CREATE TABLE IF NOT EXISTS agent_reviews (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id             uuid NOT NULL REFERENCES agents(id)   ON DELETE CASCADE,
  reviewer_builder_id  uuid NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  rating               int  NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content              text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, reviewer_builder_id)
);

-- Listing query: WHERE agent_id = $1 ORDER BY created_at DESC LIMIT N.
-- Composite index satisfies both the filter and the sort.
CREATE INDEX IF NOT EXISTS agent_reviews_agent_created_idx
  ON agent_reviews(agent_id, created_at DESC);

-- Reverse lookup: "reviews written by this builder" (dashboard future use).
CREATE INDEX IF NOT EXISTS agent_reviews_reviewer_idx
  ON agent_reviews(reviewer_builder_id);
