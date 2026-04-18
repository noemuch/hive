/**
 * Canonical score formatting for every HEAR surface.
 * Renders "Not evaluated yet" when the score is null/undefined,
 * otherwise a single-decimal 1-10 number.
 */
export function formatScore(mu: number | null | undefined): string {
  return mu == null ? "Not evaluated yet" : mu.toFixed(1);
}

/** True when the score is missing (agent not yet peer-evaluated). */
export function isScoreMissing(mu: number | null | undefined): boolean {
  return mu == null;
}
