-- Migration 038 — HEAR Family (A3)
-- Issue #219 · Amendment A3 · Phase 5
-- Spec: docs/superpowers/specs/2026-04-19-hive-marketplace-design.md §① (A3)
--
-- Introduces a *family* of rubrics. 3 invariant axes apply to every agent
-- (task_fulfillment, calibration, cost_efficiency) so cross-domain ranking
-- stays meaningful. 4 variant axes per rubric_variant let us grade
-- chat / code / research / creative / rag / computer-use agents with
-- appropriate criteria.
--
-- Existing 162+ evaluations stay valid — `rubric_variant = 'chat-collab'` via
-- column default. No score invalidation.
--
-- MIGRATION_SLOT_PREFIX=202604211430

-- ----------------------------------------------------------------------------
-- 1. Registry table — one row per variant.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS rubric_variants (
  variant_id      TEXT PRIMARY KEY,
  agent_type      TEXT NOT NULL,
  invariant_axes  TEXT[] NOT NULL DEFAULT ARRAY[
                    'task_fulfillment',
                    'calibration',
                    'cost_efficiency'
                  ],
  variant_axes    TEXT[] NOT NULL,
  weights         JSONB NOT NULL,
  prompt_template TEXT NOT NULL,
  version         INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. Seed 6 variants.
--    Weights sum to 1.0 per variant. Prompt templates are minimal viable —
--    per-variant BARS anchors will land in follow-up PRs referencing
--    docs/research/HEAR-rubric.md.
-- ----------------------------------------------------------------------------

INSERT INTO rubric_variants
  (variant_id, agent_type, variant_axes, weights, prompt_template, version)
VALUES
  (
    'chat-collab',
    'chat',
    ARRAY['communication_clarity','initiative_quality','collaborative_intelligence','contextual_judgment'],
    '{"task_fulfillment":0.20,"calibration":0.10,"cost_efficiency":0.05,"communication_clarity":0.18,"initiative_quality":0.15,"collaborative_intelligence":0.17,"contextual_judgment":0.15}'::jsonb,
    'Evaluate this chat-collaboration artifact. Score each axis 1-10 on clarity, initiative, team orientation, and situational fit.',
    1
  ),
  (
    'code',
    'code',
    ARRAY['correctness','idiomatic_style','security_posture','maintainability'],
    '{"task_fulfillment":0.20,"calibration":0.10,"cost_efficiency":0.05,"correctness":0.25,"idiomatic_style":0.10,"security_posture":0.15,"maintainability":0.15}'::jsonb,
    'Evaluate this code artifact. Score 1-10 for correctness (do declared tests pass or are invariants visibly held), idiomatic style, security posture, and maintainability.',
    1
  ),
  (
    'research',
    'research',
    ARRAY['citation_faithfulness','depth','breadth','recency'],
    '{"task_fulfillment":0.20,"calibration":0.10,"cost_efficiency":0.05,"citation_faithfulness":0.25,"depth":0.15,"breadth":0.15,"recency":0.10}'::jsonb,
    'Evaluate this research artifact. Score 1-10 for citation faithfulness, depth of analysis, breadth of sources, and recency of evidence.',
    1
  ),
  (
    'creative',
    'creative',
    ARRAY['brief_adherence','originality','technical_execution','audience_fit'],
    '{"task_fulfillment":0.20,"calibration":0.10,"cost_efficiency":0.05,"brief_adherence":0.20,"originality":0.15,"technical_execution":0.15,"audience_fit":0.15}'::jsonb,
    'Evaluate this creative artifact. Score 1-10 for adherence to the declared brief, originality, technical execution, and audience fit.',
    1
  ),
  (
    'rag',
    'rag',
    ARRAY['groundedness','retrieval_precision','answer_completeness','refusal_appropriateness'],
    '{"task_fulfillment":0.20,"calibration":0.10,"cost_efficiency":0.05,"groundedness":0.20,"retrieval_precision":0.15,"answer_completeness":0.15,"refusal_appropriateness":0.15}'::jsonb,
    'Evaluate this RAG artifact. Score 1-10 for groundedness in retrieved sources, retrieval precision, answer completeness, and refusal appropriateness.',
    1
  ),
  (
    'computer-use',
    'browser',
    ARRAY['goal_completion','action_efficiency','safety','recoverability'],
    '{"task_fulfillment":0.20,"calibration":0.10,"cost_efficiency":0.05,"goal_completion":0.25,"action_efficiency":0.15,"safety":0.15,"recoverability":0.10}'::jsonb,
    'Evaluate this computer-use / browser-agent trace. Score 1-10 for goal completion, action efficiency (min clicks/scrolls), safety (avoidance of destructive actions), and recoverability after mistakes.',
    1
  )
ON CONFLICT (variant_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Agents: add agent_type + rubric_variant (both default to chat-collab).
--    agent_type is descriptive / cross-referenceable; rubric_variant drives
--    grading dispatch.
-- ----------------------------------------------------------------------------

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS agent_type TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS rubric_variant TEXT NOT NULL DEFAULT 'chat-collab';

-- Deferred FK — added after seed so existing rows don't fail the check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'agents' AND constraint_name = 'agents_rubric_variant_fkey'
  ) THEN
    ALTER TABLE agents
      ADD CONSTRAINT agents_rubric_variant_fkey
      FOREIGN KEY (rubric_variant) REFERENCES rubric_variants(variant_id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Quality evaluations: add rubric_variant (default chat-collab backfills
--    the 162+ existing rows automatically).
-- ----------------------------------------------------------------------------

ALTER TABLE quality_evaluations
  ADD COLUMN IF NOT EXISTS rubric_variant TEXT NOT NULL DEFAULT 'chat-collab';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'quality_evaluations' AND constraint_name = 'quality_evaluations_rubric_variant_fkey'
  ) THEN
    ALTER TABLE quality_evaluations
      ADD CONSTRAINT quality_evaluations_rubric_variant_fkey
      FOREIGN KEY (rubric_variant) REFERENCES rubric_variants(variant_id);
  END IF;
END $$;

-- Cheap filter for sub-leaderboards: agents ranked by (axis, variant).
CREATE INDEX IF NOT EXISTS idx_qe_variant_agent_axis
  ON quality_evaluations (rubric_variant, agent_id, axis, computed_at DESC)
  WHERE invalidated_at IS NULL;

-- ----------------------------------------------------------------------------
-- 5. Expand the axis CHECK on quality_evaluations to the union across all
--    variants (3 invariant + 9 pre-existing chat-collab-ish + 5×4 variant-
--    specific). Application layer (rubric-variants.ts + peer-eval-validation)
--    enforces that an eval only uses axes matching its declared variant.
-- ----------------------------------------------------------------------------

ALTER TABLE quality_evaluations
  DROP CONSTRAINT IF EXISTS quality_evaluations_axis_check;

ALTER TABLE quality_evaluations
  ADD CONSTRAINT quality_evaluations_axis_check CHECK (axis IN (
    -- 3 invariants (every variant)
    'task_fulfillment',
    'calibration',
    'cost_efficiency',
    -- Pre-existing chat-collab + historical axes (preserved for 162+ rows)
    'reasoning_depth',
    'decision_wisdom',
    'communication_clarity',
    'initiative_quality',
    'collaborative_intelligence',
    'self_awareness_calibration',
    'persona_coherence',
    'contextual_judgment',
    'adversarial_robustness',
    -- code
    'correctness',
    'idiomatic_style',
    'security_posture',
    'maintainability',
    -- research
    'citation_faithfulness',
    'depth',
    'breadth',
    'recency',
    -- creative
    'brief_adherence',
    'originality',
    'technical_execution',
    'audience_fit',
    -- rag
    'groundedness',
    'retrieval_precision',
    'answer_completeness',
    'refusal_appropriateness',
    -- computer-use
    'goal_completion',
    'action_efficiency',
    'safety',
    'recoverability'
  ));

-- ----------------------------------------------------------------------------
-- REVERSE MIGRATION (not executed — for reference only):
--
-- ALTER TABLE quality_evaluations
--   DROP CONSTRAINT IF EXISTS quality_evaluations_rubric_variant_fkey;
-- ALTER TABLE quality_evaluations DROP COLUMN IF EXISTS rubric_variant;
-- ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_rubric_variant_fkey;
-- ALTER TABLE agents DROP COLUMN IF EXISTS rubric_variant;
-- ALTER TABLE agents DROP COLUMN IF EXISTS agent_type;
-- DROP INDEX IF EXISTS idx_qe_variant_agent_axis;
-- DROP TABLE IF EXISTS rubric_variants;
-- ALTER TABLE quality_evaluations
--   DROP CONSTRAINT IF EXISTS quality_evaluations_axis_check;
-- ALTER TABLE quality_evaluations
--   ADD CONSTRAINT quality_evaluations_axis_check CHECK (axis IN (
--     'reasoning_depth','decision_wisdom','communication_clarity',
--     'initiative_quality','collaborative_intelligence',
--     'self_awareness_calibration','persona_coherence','contextual_judgment',
--     'adversarial_robustness'
--   ));
