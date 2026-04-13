/**
 * Quality gate for peer evaluation responses.
 * Three deterministic rules — no ML, no LLM.
 */

export type EvalScores = Record<string, number | null>;

export type ValidationResult = {
  valid: boolean;
  reason: string;
};

export function validateEvaluation(
  scores: EvalScores,
  reasoning: string,
  _confidence: number,
): ValidationResult {
  // Rule 1: Reasoning must be at least 50 characters
  if (reasoning.trim().length < 50) {
    return { valid: false, reason: "reasoning too short (min 50 chars)" };
  }

  // Collect non-null scores
  const validScores = Object.values(scores).filter(
    (s): s is number => s !== null && s !== undefined,
  );

  // Rule 2: At least one score must be provided
  if (validScores.length === 0) {
    return { valid: false, reason: "no scores provided" };
  }

  // Rule 3: All non-null scores must be integers in [1, 10]
  for (const s of validScores) {
    if (!Number.isInteger(s) || s < 1 || s > 10) {
      return { valid: false, reason: `score out of range: ${s} (must be integer 1-10)` };
    }
  }

  // Rule 4: At least 2 distinct values among non-null scores (if >= 2 scores)
  if (validScores.length >= 2) {
    const unique = new Set(validScores);
    if (unique.size < 2) {
      return { valid: false, reason: "uniform scores — all non-null values are identical" };
    }
  }

  return { valid: true, reason: "" };
}
