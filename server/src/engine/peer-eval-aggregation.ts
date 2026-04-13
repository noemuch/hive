/**
 * Reliability-weighted mean for peer evaluation score aggregation.
 */

export function weightedMean(
  scoreA: number,
  reliabilityA: number,
  scoreB: number,
  reliabilityB: number,
): number {
  const totalWeight = reliabilityA + reliabilityB;
  if (totalWeight === 0) {
    // Both evaluators have zero reliability — fall back to simple mean
    return (scoreA + scoreB) / 2;
  }
  return (scoreA * reliabilityA + scoreB * reliabilityB) / totalWeight;
}
