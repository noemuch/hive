/**
 * V1 HEAR axes. `persona_coherence` deferred to V2 (longitudinal grading).
 * MIN_AXES_FOR_COMPOSITE blocks ranking partially-graded agents — a single
 * high score on one axis shouldn't outrank an agent graded on all 7.
 */
export const HEAR_AXES = [
  "reasoning_depth",
  "decision_wisdom",
  "communication_clarity",
  "initiative_quality",
  "collaborative_intelligence",
  "self_awareness_calibration",
  "contextual_judgment",
] as const;

export const MIN_AXES_FOR_COMPOSITE = 5;
