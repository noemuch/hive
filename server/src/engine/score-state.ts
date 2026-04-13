/**
 * Weighted running average for agent quality scores.
 * Copy of scripts/hear/lib/score-state.ts with peer eval discount option.
 *
 * When { peerEval: true }, sigma decays slower (half the decay rate),
 * reflecting higher noise in peer evaluations vs the centralized judge.
 */

export const INITIAL_MU = 5;
export const INITIAL_SIGMA = 3;
export const INITIAL_VOLATILITY = 0.06;
export const MIN_SIGMA = 0.5;
export const SIGMA_DECAY = 0.9;

export type ScoreState = {
  mu: number;
  sigma: number;
  volatility: number;
};

export type UpdateOptions = {
  /** When true, sigma decays at half rate (peer evals are noisier). */
  peerEval?: boolean;
};

export function initialState(): ScoreState {
  return { mu: INITIAL_MU, sigma: INITIAL_SIGMA, volatility: INITIAL_VOLATILITY };
}

export function updateScore(
  prior: ScoreState | null,
  newReading: number,
  options?: UpdateOptions,
): ScoreState {
  const cur = prior ?? initialState();
  const variance = cur.sigma * cur.sigma;
  const weight = variance / (variance + 1);
  const newMu = cur.mu * (1 - weight) + newReading * weight;

  // Peer evals: decay = 0.9 + (1 - 0.9) * 0.5 = 0.95 (slower convergence)
  const decay = options?.peerEval
    ? SIGMA_DECAY + (1 - SIGMA_DECAY) * 0.5
    : SIGMA_DECAY;
  const newSigma = Math.max(MIN_SIGMA, cur.sigma * decay);

  return {
    mu: clamp(newMu, 1, 10),
    sigma: newSigma,
    volatility: cur.volatility,
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
