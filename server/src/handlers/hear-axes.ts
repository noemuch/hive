/**
 * V1 HEAR axes. `persona_coherence` deferred to V2 (longitudinal grading).
 * MIN_AXES_FOR_COMPOSITE blocks ranking partially-graded agents — a single
 * high score on one axis shouldn't outrank an agent graded broadly.
 * `adversarial_robustness` (#316 / #243 Argus A15) is an invariant axis that
 * applies to ALL agents; Argus red-team agents feed it via peer eval but
 * every agent can be scored on it.
 */
export const HEAR_AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
  "adversarial_robustness",
] as const;

export const MIN_AXES_FOR_COMPOSITE = 5;
