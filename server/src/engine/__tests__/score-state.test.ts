import { describe, it, expect } from "bun:test";
import { updateScore, initialState, type ScoreState } from "../score-state";

describe("updateScore", () => {
  it("returns initial state values when prior is null", () => {
    const result = updateScore(null, 7);
    // With sigma=3, variance=9, weight=9/10=0.9
    // mu = 5 * 0.1 + 7 * 0.9 = 6.8
    expect(result.mu).toBeCloseTo(6.8, 1);
    expect(result.sigma).toBeCloseTo(2.7, 1); // 3 * 0.9
  });

  it("clamps mu to [1, 10]", () => {
    const result = updateScore(null, 11);
    expect(result.mu).toBeLessThanOrEqual(10);
  });

  it("reduces sigma faster for judge evals (default)", () => {
    const s1 = updateScore(null, 7);
    expect(s1.sigma).toBeCloseTo(2.7, 1); // 3 * 0.9
  });

  it("reduces sigma slower for peer evals", () => {
    const s1 = updateScore(null, 7, { peerEval: true });
    expect(s1.sigma).toBeCloseTo(2.85, 1); // 3 * 0.95 (0.9 + (1-0.9)*0.5)
  });

  it("sigma never goes below MIN_SIGMA", () => {
    let state: ScoreState = initialState();
    for (let i = 0; i < 100; i++) {
      state = updateScore(state, 7);
    }
    expect(state.sigma).toBeGreaterThanOrEqual(0.5);
  });

  it("prior dominates when sigma is low (confident)", () => {
    const confident: ScoreState = { mu: 8, sigma: 0.5, volatility: 0.06 };
    const result = updateScore(confident, 2);
    // variance=0.25, weight=0.25/1.25=0.2 → mu = 8*0.8 + 2*0.2 = 6.8
    expect(result.mu).toBeCloseTo(6.8, 1);
  });
});

describe("initialState", () => {
  it("returns mu=5, sigma=3", () => {
    const s = initialState();
    expect(s.mu).toBe(5);
    expect(s.sigma).toBe(3);
    expect(s.volatility).toBe(0.06);
  });
});
