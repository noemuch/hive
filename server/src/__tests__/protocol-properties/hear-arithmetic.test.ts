/* @hive-protocol-test: server/src/protocol/hear-math.ts */
//
// Property-based tests for NORTHSTAR §10.3 / Appendix G row "HEAR update".
//
// Scope & caveat: these properties exercise the PURE model in
// `server/src/protocol/hear-math.ts`. The current production path
// (`server/src/db/agent-score-state.ts`) is a SQL AVG snapshot, not the
// Bayesian conjugate update the NORTHSTAR specifies. Once agent-score-state.ts
// migrates to the conjugate formula (tracked as tech debt for genesis, see
// docs/kb/_DEBT.md), these properties become load-bearing on the prod path.
// Until then they pin the reference math so the migration has a verifier.

import { describe, it, expect } from "bun:test";
import fc from "fast-check";

import {
  bayesianUpdate,
  fold,
  posteriorsClose,
  HEAR_MIN,
  HEAR_MAX,
  type Observation,
  type Posterior,
} from "../../protocol/hear-math";

const RUNS = 80;

// ---------- generators ----------

const arbScore = fc.double({
  min: 1,
  max: 10,
  noNaN: true,
  noDefaultInfinity: true,
});

const arbVariance = fc.double({
  min: 0.01,
  max: 100,
  noNaN: true,
  noDefaultInfinity: true,
});

const arbPosterior: fc.Arbitrary<Posterior> = fc.record({
  mu: arbScore,
  sigmaSquared: arbVariance,
});

const arbObservation: fc.Arbitrary<Observation> = fc.record({
  score: arbScore,
  sigmaSquared: arbVariance,
});

// ---------- properties ----------

describe("HEAR Bayesian update — pure conjugate math", () => {
  it("matches the closed-form Normal–Normal conjugate formula", () => {
    fc.assert(
      fc.property(arbPosterior, arbObservation, (prior, obs) => {
        const { mu, sigmaSquared } = bayesianUpdate(prior, obs);

        const v0 = prior.sigmaSquared;
        const v = obs.sigmaSquared;
        const expectedV = (v0 * v) / (v0 + v);
        const expectedMuRaw = (v * prior.mu + v0 * obs.score) / (v + v0);
        const expectedMu = Math.min(HEAR_MAX, Math.max(HEAR_MIN, expectedMuRaw));

        // Posterior mean: relative tolerance 1e-9.
        const muDelta = Math.abs(mu - expectedMu);
        const muScale = Math.max(1, Math.abs(expectedMu));
        // Posterior variance: relative tolerance 1e-9.
        const vDelta = Math.abs(sigmaSquared - expectedV);
        const vScale = Math.max(1, Math.abs(expectedV));

        return muDelta <= 1e-9 * muScale && vDelta <= 1e-9 * vScale;
      }),
      { numRuns: RUNS },
    );
  });

  it("never produces NaN or Infinity for inputs in the expected range", () => {
    fc.assert(
      fc.property(arbPosterior, arbObservation, (prior, obs) => {
        const out = bayesianUpdate(prior, obs);
        return (
          Number.isFinite(out.mu) &&
          Number.isFinite(out.sigmaSquared) &&
          !Number.isNaN(out.mu) &&
          !Number.isNaN(out.sigmaSquared)
        );
      }),
      { numRuns: RUNS },
    );
  });

  it("posterior μ is strictly bounded to [1, 10] (no free HEAR)", () => {
    fc.assert(
      fc.property(arbPosterior, arbObservation, (prior, obs) => {
        const { mu } = bayesianUpdate(prior, obs);
        return mu >= HEAR_MIN && mu <= HEAR_MAX;
      }),
      { numRuns: RUNS },
    );
  });

  it("is commutative across observation order (≥ 3 evals)", () => {
    fc.assert(
      fc.property(
        arbPosterior,
        fc.array(arbObservation, { minLength: 3, maxLength: 12 }),
        (prior, obs) => {
          const a = fold(prior, obs);
          const reversed = [...obs].reverse();
          const b = fold(prior, reversed);
          // Shuffle permutation (a single swap).
          const swapped = [...obs];
          if (swapped.length >= 2) {
            [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
          }
          const c = fold(prior, swapped);

          // Use a relaxed epsilon — floating-point associativity is not exact,
          // but conjugate normal updates commute to within numerical noise.
          return (
            posteriorsClose(a, b, 1e-6) && posteriorsClose(a, c, 1e-6)
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("converges to observed score as N → ∞ with same observation", () => {
    fc.assert(
      fc.property(arbPosterior, arbObservation, (prior, obs) => {
        // Number of iterations must scale with the precision ratio: when the
        // prior is much more confident than the observation (low v0, high
        // vObs), convergence is correspondingly slow. For the standard input
        // ranges (v ∈ [0.01, 100]) the worst case is v0=0.01 / vObs=100 →
        // precision ratio 1e4, so a linear scan would need ~1e4 steps. We
        // normalize by injecting N ≥ 20·(vObs/v0) iterations — still finite,
        // and enough for the posterior μ to reach within 0.05 of the score.
        // Closed form: error after N steps = (mu0-score) · (1/v0) / (1/v0 + N/v_obs).
        // To keep |error| < tolerance we need N > (|mu0-score| · v_obs)/(tolerance · v0).
        // With |mu0-score| ≤ 9 (HEAR range) and tolerance 0.1, we use a 100x
        // margin over the precision ratio.
        const precisionRatio = obs.sigmaSquared / prior.sigmaSquared;
        const N = Math.max(1000, Math.ceil(100 * precisionRatio + 100));
        let state = prior;
        for (let i = 0; i < N; i++) state = bayesianUpdate(state, obs);
        const clampedScore = Math.min(HEAR_MAX, Math.max(HEAR_MIN, obs.score));
        const muConverged = Math.abs(state.mu - clampedScore) < 0.1;
        const varianceShrunk = state.sigmaSquared < prior.sigmaSquared + 1e-9;
        return muConverged && varianceShrunk;
      }),
      { numRuns: RUNS },
    );
  });
});
