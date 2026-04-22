/* @hive-protocol */
// server/src/protocol/hear-math.ts
//
// Pure conjugate-Bayesian update helpers for HEAR arithmetic (NORTHSTAR §3.2 / §10.3).
//
// IMPORTANT: these helpers are a STANDALONE MODEL of the Bayesian formula described in
// NORTHSTAR §3 and referenced in `server/src/db/agent-score-state.ts`. The live
// production path (DB-backed SQL AVG in agent-score-state.ts) does NOT yet implement the
// conjugate update — that is tracked as tech debt for genesis (see §3.2, §10.3 and
// `docs/kb/_DEBT.md` "Bayesian posterior migration"). The property tests in
// `server/src/__tests__/protocol-properties/hear-arithmetic.test.ts` verify this pure
// model; once agent-score-state.ts is migrated to the conjugate formula, the tests
// become load-bearing for the production path as well.
//
// Normal–Normal conjugate update for a single HEAR axis:
//   given prior (μ₀, σ₀²) and observation likelihood N(x ; σ²),
//     μ' = (σ² · μ₀ + σ₀² · x) / (σ² + σ₀²)
//     σ'² = (σ² · σ₀²) / (σ² + σ₀²)
//
// All scores/means are on the [1, 10] HEAR axis scale. σ is always strictly > 0.

/** Axis-bounded HEAR score. */
export const HEAR_MIN = 1;
export const HEAR_MAX = 10;

export type Posterior = { mu: number; sigmaSquared: number };

export type Observation = {
  /** Observed score on [1, 10]. */
  score: number;
  /** Likelihood variance σ² > 0 (smaller = more confident evaluator). */
  sigmaSquared: number;
};

/** Numerically-safe reciprocal-sum helper used to avoid 1/Infinity drift. */
function reciprocalSum(a: number, b: number): number {
  // (a·b) / (a + b)  rearranged to avoid overflow when both are large.
  if (a === 0 || b === 0) return 0;
  return 1 / (1 / a + 1 / b);
}

/**
 * One conjugate Normal–Normal update step.
 * Clamps posterior μ into [HEAR_MIN, HEAR_MAX] ("no free HEAR" — §3.2).
 */
export function bayesianUpdate(prior: Posterior, obs: Observation): Posterior {
  const { mu: mu0, sigmaSquared: v0 } = prior;
  const { score, sigmaSquared: vObs } = obs;

  if (!(v0 > 0) || !(vObs > 0)) {
    throw new RangeError(`bayesianUpdate: variances must be > 0 (prior=${v0}, obs=${vObs})`);
  }

  const sigmaSquared = reciprocalSum(v0, vObs);
  // Precision-weighted mean: equivalent algebraically to (v·mu0 + v0·score)/(v+v0)
  // but expressed via precisions to avoid catastrophic cancellation for tiny variances.
  const mu = sigmaSquared * (mu0 / v0 + score / vObs);

  const clamped = Math.min(HEAR_MAX, Math.max(HEAR_MIN, mu));
  return { mu: clamped, sigmaSquared };
}

/** Fold an ordered list of observations into a single posterior. */
export function fold(prior: Posterior, observations: Observation[]): Posterior {
  return observations.reduce(bayesianUpdate, prior);
}

/**
 * Returns true when two posteriors are equal up to `eps` in μ and relative-tolerance σ².
 * Used to assert order-invariance across permutations.
 */
export function posteriorsClose(
  a: Posterior,
  b: Posterior,
  eps = 1e-9,
): boolean {
  const muOk = Math.abs(a.mu - b.mu) <= eps * Math.max(1, Math.abs(a.mu), Math.abs(b.mu));
  const vOk =
    Math.abs(a.sigmaSquared - b.sigmaSquared) <=
    eps * Math.max(1, Math.abs(a.sigmaSquared), Math.abs(b.sigmaSquared));
  return muOk && vOk;
}
