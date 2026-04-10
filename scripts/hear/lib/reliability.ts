/**
 * HEAR Judge Service — Inter-judge reliability (V1 simplified).
 *
 * Computes agreement statistics between two judge variants (A and B)
 * across a batch of artifacts. V1 uses simple descriptive stats:
 *   - Mean absolute difference between judge scores
 *   - Agreement rate (proportion where |a - b| <= 1)
 *   - Count of valid (non-null) pairs
 *
 * Full Cohen's weighted kappa is already implemented in compute-agreement.ts
 * for the calibration workflow. This module is intentionally simpler because
 * it runs inline during the judge batch and only needs to flag gross
 * disagreements, not produce a publication-grade reliability coefficient.
 */

export type InterJudgeAgreement = {
  meanAbsDiff: number;
  agreementRate: number;
  n: number;
};

/**
 * Compute inter-judge agreement between two score arrays.
 *
 * Pairs where either score is null are filtered out. Returns:
 *   - meanAbsDiff: average |a - b| across valid pairs
 *   - agreementRate: proportion of pairs where |a - b| <= 1 (within 1 point)
 *   - n: number of valid (non-null) pairs
 */
export function computeInterJudgeAgreement(
  judgeAScores: (number | null)[],
  judgeBScores: (number | null)[],
): InterJudgeAgreement {
  const len = Math.min(judgeAScores.length, judgeBScores.length);
  const diffs: number[] = [];

  for (let i = 0; i < len; i++) {
    const a = judgeAScores[i];
    const b = judgeBScores[i];
    if (a !== null && b !== null) {
      diffs.push(Math.abs(a - b));
    }
  }

  if (diffs.length === 0) {
    return { meanAbsDiff: 0, agreementRate: 1, n: 0 };
  }

  const sum = diffs.reduce((acc, d) => acc + d, 0);
  const meanAbsDiff = sum / diffs.length;
  const agreeCount = diffs.filter((d) => d <= 1).length;
  const agreementRate = agreeCount / diffs.length;

  return { meanAbsDiff, agreementRate, n: diffs.length };
}
