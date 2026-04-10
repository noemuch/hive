/**
 * HEAR Judge Service — Glicko-2-inspired score updater (V1 simplified).
 *
 * This is NOT real Glicko-2. V1 ships a simple weighted running average
 * with monotonically decreasing uncertainty so the API surface matches
 * what the rest of the pipeline expects (`{ mu, sigma }`). V2 will replace
 * the body of `updateScore` with a proper Glickman 2012 implementation
 * (rating-period batched, with τ volatility). The shape of the inputs and
 * outputs is intentionally compatible with that future swap.
 *
 * Reference (for the V2 swap):
 *   Glickman, M. E. (2012). "Example of the Glicko-2 system." BU.
 */

export const INITIAL_MU = 5; // middle of the 1-10 displayed scale
export const INITIAL_SIGMA = 3; // high uncertainty for new agents
export const INITIAL_VOLATILITY = 0.06; // unused in V1, kept for V2 schema parity

export const MIN_SIGMA = 0.5;
export const SIGMA_DECAY = 0.9;

export type ScoreState = {
  mu: number;
  sigma: number;
  volatility: number;
};

export function initialState(): ScoreState {
  return {
    mu: INITIAL_MU,
    sigma: INITIAL_SIGMA,
    volatility: INITIAL_VOLATILITY,
  };
}

/**
 * Fold a new judge reading into the existing (mu, sigma) estimate.
 *
 * V1 algorithm (placeholder for true Glicko-2):
 *   weight = 1 / (sigma^2 + 1)
 *   newMu  = oldMu * (1 - weight) + newReading * weight
 *   newSigma = max(MIN_SIGMA, oldSigma * SIGMA_DECAY)
 *
 * Properties this preserves vs. true Glicko-2:
 *   - High initial uncertainty → first reading dominates (large weight)
 *   - Each new reading shrinks uncertainty
 *   - Bounded sigma (we never claim total certainty)
 *
 * Properties this misses (deferred to V2):
 *   - Rating period batching
 *   - Volatility (τ) update
 *   - Pairwise comparison input (V1 uses absolute scores from the rubric)
 *   - Symmetric updates between rated agents
 */
export function updateScore(
  prior: ScoreState | null,
  newReading: number,
): ScoreState {
  const cur = prior ?? initialState();
  const variance = cur.sigma * cur.sigma;
  const weight = 1 / (variance + 1);
  const newMu = cur.mu * (1 - weight) + newReading * weight;
  const newSigma = Math.max(MIN_SIGMA, cur.sigma * SIGMA_DECAY);
  return {
    mu: clamp(newMu, 1, 10),
    sigma: newSigma,
    volatility: cur.volatility,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
