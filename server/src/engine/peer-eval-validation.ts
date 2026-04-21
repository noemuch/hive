/**
 * Quality gate for peer evaluation responses.
 * Seven deterministic rules — no ML, no LLM.
 *
 * Rules 1-4 are intra-evaluation (length, range, uniformity).
 * Rule 5 is cross-evaluator: rejects evaluations whose score tuple is
 * identical to another already-completed evaluator's tuple on the same
 * artifact. Real independent judgment essentially never produces identical
 * tuples (~10⁻⁵ collision probability for honest evaluators), so a match is
 * a strong signal of template-copying — caught universally regardless of
 * which LLM or SDK the evaluator uses. See hive-fleet#178 v2 for the
 * rationale. Tuple size varies by rubric_variant (7 axes for chat-collab,
 * also 7 for every other variant — 3 invariants + 4 variant axes — so the
 * collision probability stays identical across variants).
 *
 * Rule 6 (new in HEAR Family A3 / #219): reject evaluations containing
 * axes not declared in the evaluatee's rubric_variant. Protects the
 * evaluation from accidental cross-variant score contamination.
 *
 * Rule 7 (new in A5 / #234): when `evidenceQuotes` is supplied as the new
 * per-axis object shape, every non-null axis in `scores` must have >=1
 * quote, and every quote must be <=200 chars. The legacy flat
 * `string[]` shape (pre-A5) bypasses Rule 7 — retained so old evaluators
 * and old rows keep validating. See peer-eval-validation flow in
 * server/src/engine/peer-evaluation.ts.
 */

export type EvalScores = Record<string, number | null>;

/**
 * Accepted shapes for evidence_quotes:
 *   (a) Legacy (pre-A5): `string[]` — flat array, up to 3 verbatim snippets.
 *   (b) New per-axis:    `Record<axis, string[]>` — one bucket per HEAR axis.
 * Callers that don't care about Rule 7 can pass `undefined`.
 */
export type EvidenceQuotes = string[] | Record<string, string[]>;

export const MAX_QUOTE_CHARS = 200;

export type ValidationResult = {
  valid: boolean;
  reason: string;
};

/**
 * Type guard: is this the new per-axis object shape (not a flat array,
 * not null, an object)? Arrays are `typeof === "object"` in JS, so the
 * explicit `Array.isArray` check comes first.
 */
export function isPerAxisEvidence(
  quotes: EvidenceQuotes | undefined | null
): quotes is Record<string, string[]> {
  return (
    quotes !== null &&
    quotes !== undefined &&
    !Array.isArray(quotes) &&
    typeof quotes === "object"
  );
}

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
  allowedAxes: ReadonlyArray<string> | null = null,
  evidenceQuotes: EvidenceQuotes | undefined | null = undefined,
): ValidationResult {
  // Rule 6: reject axes not belonging to the declared variant.
  // Run before the other rules so callers get a precise error.
  if (allowedAxes !== null && allowedAxes.length > 0) {
    const allowed = new Set(allowedAxes);
    for (const axis of Object.keys(scores)) {
      if (!allowed.has(axis)) {
        return {
          valid: false,
          reason: `axis "${axis}" not in declared rubric variant`,
        };
      }
    }
  }

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

  // Rule 7: Per-axis evidence coverage. Only engages when the caller hands
  // us the new per-axis object shape. Legacy flat `string[]` or missing
  // quotes short-circuit to valid — preserves backward compat with the
  // pre-A5 (#234) protocol.
  if (isPerAxisEvidence(evidenceQuotes)) {
    for (const axis of Object.keys(scores)) {
      if (scores[axis] === null || scores[axis] === undefined) continue;
      const quotes = evidenceQuotes[axis];
      if (!Array.isArray(quotes) || quotes.length === 0) {
        return {
          valid: false,
          reason: `missing evidence quote for scored axis "${axis}"`,
        };
      }
      for (const q of quotes) {
        if (typeof q !== "string" || q.trim().length === 0) {
          return {
            valid: false,
            reason: `empty evidence quote for axis "${axis}"`,
          };
        }
        if (q.length > MAX_QUOTE_CHARS) {
          return {
            valid: false,
            reason: `evidence quote for axis "${axis}" exceeds ${MAX_QUOTE_CHARS} chars`,
          };
        }
      }
    }
  }

  return { valid: true, reason: "" };
}
