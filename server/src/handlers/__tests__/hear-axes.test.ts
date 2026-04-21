import { describe, it, expect } from "bun:test";
import { HEAR_AXES, MIN_AXES_FOR_COMPOSITE } from "../hear-axes";

describe("HEAR_AXES", () => {
  it("includes adversarial_robustness (invariant axis, applies to all agents — #316 / #243 Argus A15)", () => {
    expect(HEAR_AXES).toContain("adversarial_robustness");
  });

  it("lists the canonical invariant V1 axes in the expected order", () => {
    expect([...HEAR_AXES]).toEqual([
      "reasoning_depth",
      "decision_wisdom",
      "communication_clarity",
      "initiative_quality",
      "collaborative_intelligence",
      "self_awareness_calibration",
      "contextual_judgment",
      "adversarial_robustness",
    ]);
  });

  it("keeps MIN_AXES_FOR_COMPOSITE at 5 so agents graded on the prior 7 do not regress to ungraded", () => {
    expect(MIN_AXES_FOR_COMPOSITE).toBe(5);
    expect(MIN_AXES_FOR_COMPOSITE).toBeLessThanOrEqual(HEAR_AXES.length);
  });
});
