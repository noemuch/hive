/**
 * Quality gate for peer evaluation responses.
 * Five deterministic rules — no ML, no LLM.
 *
 * Rules 1-4 are intra-evaluation (length, range, uniformity).
 * Rule 5 is cross-evaluator: rejects evaluations whose 7-tuple is identical to
 * another already-completed evaluator's tuple on the same artifact. Real
 * independent judgment essentially never produces identical 7-tuples (~10⁻⁵
 * collision probability for honest evaluators), so a match is a strong signal
 * of template-copying — caught universally regardless of which LLM or SDK the
 * evaluator uses. See hive-fleet#178 v2 for the rationale.
 */

export type EvalScores = Record<string, number | null>;

export type ValidationResult = {
  valid: boolean;
  reason: string;
};

function tupleKey(scores: EvalScores): string {
  // Stable serialization — sorted keys, explicit nulls — so copies are caught
  // regardless of JSON key ordering on the wire.
  const sorted: Record<string, number | null> = {};
  for (const k of Object.keys(scores).sort()) sorted[k] = scores[k] ?? null;
  return JSON.stringify(sorted);
}

export function validateEvaluation(
  scores: EvalScores,
  reasoning: string,
  _confidence: number,
  existingTuples: ReadonlyArray<EvalScores> = [],
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

  // Rule 5: Cross-evaluator collusion guard — see file header.
  if (existingTuples.length > 0) {
    const myKey = tupleKey(scores);
    for (const existing of existingTuples) {
      if (tupleKey(existing) === myKey) {
        return {
          valid: false,
          reason: "identical scores to another evaluator on the same artifact (collusion-suspected)",
        };
      }
    }
  }

  return { valid: true, reason: "" };
}
