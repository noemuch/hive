import { describe, it, expect } from "bun:test";
import { validateEvaluation, type ValidationResult } from "../peer-eval-validation";

describe("validateEvaluation", () => {
  const goodScores = {
    reasoning_depth: 7,
    decision_wisdom: 5,
    communication_clarity: 8,
    initiative_quality: null,
    collaborative_intelligence: 6,
    self_awareness_calibration: 4,
    contextual_judgment: 7,
  };

  it("accepts valid evaluation with reasoning and diverse scores", () => {
    const result = validateEvaluation(goodScores, "This artifact demonstrates strong reasoning with clear premises and well-structured arguments.", 7);
    expect(result.valid).toBe(true);
  });

  it("rejects empty reasoning", () => {
    const result = validateEvaluation(goodScores, "", 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reasoning");
  });

  it("rejects short reasoning (< 50 chars)", () => {
    const result = validateEvaluation(goodScores, "Looks good overall.", 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("reasoning");
  });

  it("rejects scores out of range (> 10)", () => {
    const scores = { ...goodScores, reasoning_depth: 15 };
    const result = validateEvaluation(scores, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("range");
  });

  it("rejects scores out of range (< 1)", () => {
    const scores = { ...goodScores, reasoning_depth: 0 };
    const result = validateEvaluation(scores, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("range");
  });

  it("rejects uniform scores (all same value)", () => {
    const uniform = {
      reasoning_depth: 7,
      decision_wisdom: 7,
      communication_clarity: 7,
      initiative_quality: 7,
      collaborative_intelligence: 7,
      self_awareness_calibration: 7,
      contextual_judgment: 7,
    };
    const result = validateEvaluation(uniform, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("uniform");
  });

  it("accepts scores with some nulls if non-nulls are diverse", () => {
    const sparse = {
      reasoning_depth: 8,
      decision_wisdom: null,
      communication_clarity: 5,
      initiative_quality: null,
      collaborative_intelligence: null,
      self_awareness_calibration: null,
      contextual_judgment: null,
    };
    const result = validateEvaluation(sparse, "A".repeat(60), 7);
    expect(result.valid).toBe(true);
  });

  it("rejects zero non-null scores", () => {
    const empty = {
      reasoning_depth: null,
      decision_wisdom: null,
      communication_clarity: null,
      initiative_quality: null,
      collaborative_intelligence: null,
      self_awareness_calibration: null,
      contextual_judgment: null,
    };
    const result = validateEvaluation(empty, "A".repeat(60), 7);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("no scores");
  });

  it("accepts if only 1 non-null score (diversity check needs >= 2 non-null)", () => {
    const single = {
      reasoning_depth: 7,
      decision_wisdom: null,
      communication_clarity: null,
      initiative_quality: null,
      collaborative_intelligence: null,
      self_awareness_calibration: null,
      contextual_judgment: null,
    };
    const result = validateEvaluation(single, "A".repeat(60), 7);
    expect(result.valid).toBe(true);
  });

  describe("Rule 5 — cross-evaluator collusion", () => {
    it("rejects when scores match an existing evaluator on the same artifact", () => {
      const result = validateEvaluation(goodScores, "A".repeat(60), 7, [goodScores]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("collusion");
    });

    it("rejects even if key order differs (stable serialization)", () => {
      const reordered = {
        contextual_judgment: 7,
        collaborative_intelligence: 6,
        self_awareness_calibration: 4,
        initiative_quality: null,
        communication_clarity: 8,
        decision_wisdom: 5,
        reasoning_depth: 7,
      };
      const result = validateEvaluation(reordered, "A".repeat(60), 7, [goodScores]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("collusion");
    });

    it("accepts when scores differ on at least one axis", () => {
      const distinct = { ...goodScores, reasoning_depth: 9 };
      const result = validateEvaluation(distinct, "A".repeat(60), 7, [goodScores]);
      expect(result.valid).toBe(true);
    });

    it("accepts when no existing tuples are provided (first evaluator)", () => {
      const result = validateEvaluation(goodScores, "A".repeat(60), 7, []);
      expect(result.valid).toBe(true);
    });

    it("rejects against the LAST of many existing tuples", () => {
      const a = { ...goodScores, reasoning_depth: 1 };
      const b = { ...goodScores, reasoning_depth: 2 };
      const c = { ...goodScores };
      const result = validateEvaluation(goodScores, "A".repeat(60), 7, [a, b, c]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("collusion");
    });
  });
});
