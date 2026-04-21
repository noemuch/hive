import { describe, it, expect } from "bun:test";
import { validateEvaluation } from "../peer-eval-validation";

const REASONING = "This artifact demonstrates strong reasoning with clear premises and well-structured arguments, citing specific trade-offs.";

describe("validateEvaluation with allowedAxes (HEAR Family A3)", () => {
  it("accepts scores whose axes all belong to the declared variant", () => {
    const codeScores = {
      task_fulfillment: 8,
      calibration: 7,
      cost_efficiency: 6,
      correctness: 9,
      idiomatic_style: 7,
      security_posture: 8,
      maintainability: 6,
    };
    const result = validateEvaluation(codeScores, REASONING, 7, [], Object.keys(codeScores));
    expect(result.valid).toBe(true);
  });

  it("rejects scores containing axes not in the declared variant", () => {
    const mixed = {
      task_fulfillment: 8,
      calibration: 7,
      correctness: 6,
      // chat-collab axis leaking into a code variant — should be rejected.
      communication_clarity: 5,
    };
    const codeAxes = [
      "task_fulfillment",
      "calibration",
      "cost_efficiency",
      "correctness",
      "idiomatic_style",
      "security_posture",
      "maintainability",
    ];
    const result = validateEvaluation(mixed, REASONING, 7, [], codeAxes);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("communication_clarity");
  });

  it("leaves legacy (no allowedAxes) behaviour intact", () => {
    const legacyScores = {
      reasoning_depth: 7,
      decision_wisdom: 5,
      communication_clarity: 8,
      initiative_quality: null,
      collaborative_intelligence: 6,
      self_awareness_calibration: 4,
      contextual_judgment: 7,
    };
    const result = validateEvaluation(legacyScores, REASONING, 7);
    expect(result.valid).toBe(true);
  });

  it("accepts all 6 variants' axis tuples", () => {
    const variants: Record<string, string[]> = {
      "chat-collab": ["task_fulfillment", "calibration", "cost_efficiency", "communication_clarity", "initiative_quality", "collaborative_intelligence", "contextual_judgment"],
      code: ["task_fulfillment", "calibration", "cost_efficiency", "correctness", "idiomatic_style", "security_posture", "maintainability"],
      research: ["task_fulfillment", "calibration", "cost_efficiency", "citation_faithfulness", "depth", "breadth", "recency"],
      creative: ["task_fulfillment", "calibration", "cost_efficiency", "brief_adherence", "originality", "technical_execution", "audience_fit"],
      rag: ["task_fulfillment", "calibration", "cost_efficiency", "groundedness", "retrieval_precision", "answer_completeness", "refusal_appropriateness"],
      "computer-use": ["task_fulfillment", "calibration", "cost_efficiency", "goal_completion", "action_efficiency", "safety", "recoverability"],
    };
    // Produce diverse, valid scores per variant.
    const samples = [8, 7, 6, 9, 5, 4, 7];
    for (const [vid, axes] of Object.entries(variants)) {
      const scores: Record<string, number> = {};
      axes.forEach((a, i) => {
        scores[a] = samples[i];
      });
      const result = validateEvaluation(scores, REASONING, 7, [], axes);
      expect({ vid, result }).toEqual({ vid, result: { valid: true, reason: "" } });
    }
  });
});
