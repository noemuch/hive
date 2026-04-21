-- Migration 043 — Weekly Challenge Gallery (A6)
-- Issue #240 · Amendment A6 · Phase 4
-- Spec: docs/feedback/2026-04-19-expert-agentic-feedback.md §②
--
-- Enables head-to-head comparison of agents on the SAME brief. Three tables:
--   challenges             — weekly / timed briefs (slug, prompt, agent_type,
--                            rubric_variant, starts_at, ends_at, status)
--   challenge_submissions  — one row per agent × challenge (FK artifact_id
--                            links to the A4 polymorphic artifact)
--   challenge_votes        — community upvotes, one per (challenge, artifact,
--                            builder) so we can't stuff the ballot
--
-- Reuses existing artifact types (image / code_diff / report / document / ...)
-- added in migration 041 — no new types are needed. `agent_type_filter` is a
-- soft constraint enforced at submission time by the handler, not by SQL (so
-- admin can re-classify without a migration).
--
-- Seeds 1 active challenge so the demo page renders on first deploy. The
-- challenge is scoped `public` (no creator builder) to avoid depending on
-- seeded builder UUIDs.
--
-- MIGRATION_SLOT_PREFIX=202604211500

-- ----------------------------------------------------------------------------
-- 1. challenges: the weekly brief.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS challenges (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT NOT NULL,
  prompt              TEXT NOT NULL,
  -- Soft filter: UI + handler reject submissions whose artifact.type is
  -- outside this list. Empty array = accept any type.
  agent_type_filter   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  rubric_variant      TEXT NOT NULL DEFAULT 'chat-collab'
                        REFERENCES rubric_variants(variant_id),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  -- Lifecycle: draft (not yet open) → active (accepting submissions) →
  -- completed (window closed, grid is read-only archive).
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft', 'active', 'completed')),
  created_by          UUID REFERENCES builders(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- Fast path for /api/challenges/current (active + within window)
CREATE INDEX IF NOT EXISTS idx_challenges_status_ends_at
  ON challenges (status, ends_at DESC);

-- ----------------------------------------------------------------------------
-- 2. challenge_submissions: one artifact per agent per challenge.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS challenge_submissions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id     UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  artifact_id      UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  vote_count       INT NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
  -- Exactly one entry per (challenge, agent) — an agent can only submit one
  -- artifact per brief. Re-submits should replace, not duplicate.
  UNIQUE (challenge_id, agent_id),
  -- And one entry per (challenge, artifact) — an artifact can't compete twice.
  UNIQUE (challenge_id, artifact_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_submissions_challenge
  ON challenge_submissions (challenge_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_challenge_submissions_agent
  ON challenge_submissions (agent_id, submitted_at DESC);

-- ----------------------------------------------------------------------------
-- 3. challenge_votes: builder → submission upvote (idempotent).
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS challenge_votes (
  challenge_id     UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  artifact_id      UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  voter_builder_id UUID NOT NULL REFERENCES builders(id) ON DELETE CASCADE,
  voted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (challenge_id, artifact_id, voter_builder_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_votes_challenge_artifact
  ON challenge_votes (challenge_id, artifact_id);

-- ----------------------------------------------------------------------------
-- 4. Seed: one active engineering challenge, valid for 7 days from now so the
--    demo has something to display. Idempotent via ON CONFLICT on slug.
-- ----------------------------------------------------------------------------

INSERT INTO challenges (slug, title, prompt, agent_type_filter, rubric_variant, starts_at, ends_at, status)
VALUES (
  'week-1-refactor-node-handler',
  'Week 1 — Refactor this Node.js route handler for readability',
  E'Take a 200-line Express.js route handler that does: JSON parse → validate input → 4 DB lookups → business rule → 2 side-effect writes → format response. Refactor it for readability:\n\n- Extract pure helpers, keep IO at the edges.\n- Name things honestly (no `processData`, no `helper`).\n- Remove any layer that doesn\'t pay for itself.\n\nSubmit your refactored code as a `code_diff` artifact. Rubric: `code` variant (correctness, idiomatic_style, security_posture, maintainability).',
  ARRAY['code_diff', 'pr', 'document'],
  'code',
  now(),
  now() + INTERVAL '7 days',
  'active'
)
ON CONFLICT (slug) DO NOTHING;

-- REVERSE MIGRATION (not executed — for reference):
-- DROP TABLE IF EXISTS challenge_votes;
-- DROP TABLE IF EXISTS challenge_submissions;
-- DROP TABLE IF EXISTS challenges;
