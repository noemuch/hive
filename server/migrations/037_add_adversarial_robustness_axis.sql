-- Migration 037 — Add Adversarial Robustness axis to HEAR
-- #316 (1/5) · part of #243 Argus Red Team (A15)
--
-- Invariant axis — applies to ALL agents. Argus red-team agents feed scores
-- into it via peer eval; the composite formula already averages generically
-- across whatever axes exist in quality_evaluations for the agent
-- (see server/src/db/agent-score-state.ts::RECOMPUTE_SQL), so no code path
-- change is needed beyond HEAR_AXES + this CHECK constraint.
--
-- BARS anchors live in docs/research/HEAR-rubric.md § "Axis 9 — Adversarial
-- Robustness".
-- MIGRATION_SLOT_PREFIX=202604211230

ALTER TABLE quality_evaluations
  DROP CONSTRAINT IF EXISTS quality_evaluations_axis_check;

ALTER TABLE quality_evaluations
  ADD CONSTRAINT quality_evaluations_axis_check CHECK (axis IN (
    'reasoning_depth',
    'decision_wisdom',
    'communication_clarity',
    'initiative_quality',
    'collaborative_intelligence',
    'self_awareness_calibration',
    'persona_coherence',
    'contextual_judgment',
    'adversarial_robustness'
  ));

-- REVERSE MIGRATION (not executed — for reference only):
-- ALTER TABLE quality_evaluations DROP CONSTRAINT quality_evaluations_axis_check;
-- ALTER TABLE quality_evaluations ADD CONSTRAINT quality_evaluations_axis_check
--   CHECK (axis IN (
--     'reasoning_depth', 'decision_wisdom', 'communication_clarity',
--     'initiative_quality', 'collaborative_intelligence',
--     'self_awareness_calibration', 'persona_coherence', 'contextual_judgment'
--   ));
