import { describe, it, expect } from "bun:test";
import { validateEvaluation, MAX_QUOTE_CHARS, type ValidationResult } from "../peer-eval-validation";

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

  describe("Rule 7 — per-axis evidence coverage (A5)", () => {
    const reasoning = "A".repeat(60);

    it("accepts per-axis evidence with one quote per non-null axis", () => {
      const quotes = {
        reasoning_depth: ["logical chain from A to B is explicit"],
        decision_wisdom: ["chose option B given the cost/benefit"],
        communication_clarity: ["headings, bullets, no jargon"],
        collaborative_intelligence: ["invites pushback from reviewers"],
        self_awareness_calibration: ["flags residual uncertainty in §3"],
        contextual_judgment: ["references the Q3 freeze calendar"],
      };
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, quotes);
      expect(result.valid).toBe(true);
    });

    it("rejects when a non-null scored axis has no quote", () => {
      const quotes = {
        reasoning_depth: ["ok"],
        // decision_wisdom scored 5 but missing quote
        communication_clarity: ["clear"],
        collaborative_intelligence: ["collab"],
        self_awareness_calibration: ["aware"],
        contextual_judgment: ["context"],
      };
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, quotes);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("decision_wisdom");
    });

    it("rejects when a quote exceeds 200 chars", () => {
      const quotes = {
        reasoning_depth: ["x".repeat(MAX_QUOTE_CHARS + 1)],
        decision_wisdom: ["ok"],
        communication_clarity: ["ok"],
        collaborative_intelligence: ["ok"],
        self_awareness_calibration: ["ok"],
        contextual_judgment: ["ok"],
      };
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, quotes);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("exceeds");
    });

    it("rejects when a quote is an empty string", () => {
      const quotes = {
        reasoning_depth: ["   "],
        decision_wisdom: ["ok"],
        communication_clarity: ["ok"],
        collaborative_intelligence: ["ok"],
        self_awareness_calibration: ["ok"],
        contextual_judgment: ["ok"],
      };
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, quotes);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("empty");
    });

    it("ignores quotes for null-scored axes (initiative_quality is null here)", () => {
      const quotes = {
        reasoning_depth: ["ok"],
        decision_wisdom: ["ok"],
        communication_clarity: ["ok"],
        collaborative_intelligence: ["ok"],
        self_awareness_calibration: ["ok"],
        contextual_judgment: ["ok"],
        // no initiative_quality — it's null in goodScores, so no quote required
      };
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, quotes);
      expect(result.valid).toBe(true);
    });

    it("bypasses Rule 7 for legacy flat string[] evidence (backward compat)", () => {
      const legacyQuotes = ["general snippet A", "general snippet B"];
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, legacyQuotes);
      expect(result.valid).toBe(true);
    });

    it("bypasses Rule 7 when evidence is undefined (no coverage check)", () => {
      const result = validateEvaluation(goodScores, reasoning, 7, [], null, undefined);
      expect(result.valid).toBe(true);
    });
  });
});
