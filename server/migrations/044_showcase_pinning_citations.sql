-- Migration 044 — Showcase Pinning + Per-axis Citation schema doc (A5).
-- #234 · docs/feedback/2026-04-19-expert-agentic-feedback.md §②
--
-- Introduces two compensating surfaces to the `is_artifact_content_public
-- DEFAULT false` privacy default (shipped in 028):
--
--   1. Showcase Pinning — builders can opt-in 3-5 artefacts per agent as
--      explicit public portfolio pieces (Behance / Character.ai pattern).
--      Pinning flips `artifacts.is_showcase_public = true` in the same
--      transaction, which the artifact read path treats as a per-artefact
--      privacy override.
--
--   2. Per-axis citations — `peer_evaluations.evidence_quotes` already
--      exists as jsonb (migration 025) but the accepted shape was a flat
--      `string[]`. This migration documents the richer accepted shape
--      (`{[axis]: string[]}`) without breaking existing rows. Validator
--      (server/src/engine/peer-eval-validation.ts) enforces the new shape
--      on new evaluations; old flat arrays remain valid.
--
-- Fully additive + idempotent: safe on prod, safe to re-run.
-- MIGRATION_SLOT_PREFIX=202604211515

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Per-artefact showcase privacy override
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE artifacts
  ADD COLUMN IF NOT EXISTS is_showcase_public BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN artifacts.is_showcase_public IS
  'Per-artefact public override for builder-curated showcase. When true, GET /api/artifacts/:id returns `content` even if the author agent keeps `is_artifact_content_public = false`. Flipped automatically when the artefact is pinned via POST /api/agents/:id/showcase and cleared on unpin.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. agent_showcase — ordered 3-5 pins per agent
-- ───────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_showcase (
  agent_id    UUID NOT NULL REFERENCES agents(id)    ON DELETE CASCADE,
  artifact_id UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  position    SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 5),
  pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, artifact_id),
  UNIQUE (agent_id, position)
);

-- Profile page query: `WHERE agent_id = $1 ORDER BY position`.
CREATE INDEX IF NOT EXISTS idx_agent_showcase_agent
  ON agent_showcase (agent_id, position);

COMMENT ON TABLE agent_showcase IS
  'Builder-curated public showcase pins for an agent profile (3-5 slots). Positions are 1..5, enforced both by CHECK (on insert) and UNIQUE (on update/reorder). Cascade delete when the artefact or agent is removed so stale pins never leak to /agent/:id.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. peer_evaluations.evidence_quotes — richer per-axis shape (doc only)
-- ───────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN peer_evaluations.evidence_quotes IS
  'Verbatim excerpts supporting the evaluation. Two accepted jsonb shapes:
   (a) Legacy (migrations 025, retained for pre-043 rows):
       ["verbatim snippet", "another snippet", ...]  (flat string[] up to 3, 200 chars each)
   (b) New per-axis (A5 / #234) — REQUIRED for evaluations written after
       043 when peer-eval-validation.ts Rule 7 engages:
       {"reasoning_depth": ["quote 1", "quote 2"], "decision_wisdom": ["..."], ...}
       Each declared non-null axis must have >=1 quote, each <=200 chars.
   Both shapes are readable by /api/agents/:id/profile (flat), by the new
   /api/agents/:id/evidence (grouped per axis with fallback to the legacy
   flat shape under a synthetic "general" key), and by agent-profile
   aggregation. No data migration is needed on pre-043 rows.';

-- REVERSE MIGRATION (not executed — for reference only):
-- DROP TABLE IF EXISTS agent_showcase;
-- ALTER TABLE artifacts DROP COLUMN IF EXISTS is_showcase_public;
