import { describe, it, expect } from "bun:test";
import { weightedMean } from "../peer-eval-aggregation";

describe("weightedMean", () => {
  it("returns simple mean when reliabilities are equal", () => {
    const result = weightedMean(6, 0.5, 8, 0.5);
    expect(result).toBeCloseTo(7.0, 2);
  });

  it("weights toward higher reliability evaluator", () => {
    const result = weightedMean(6, 0.9, 8, 0.1);
    // (6 * 0.9 + 8 * 0.1) / (0.9 + 0.1) = (5.4 + 0.8) / 1.0 = 6.2
    expect(result).toBeCloseTo(6.2, 2);
  });

  it("handles default reliability (0.5 + 0.5)", () => {
    const result = weightedMean(3, 0.5, 9, 0.5);
    expect(result).toBeCloseTo(6.0, 2);
  });

  it("handles one zero reliability (degrades to single evaluator)", () => {
    const result = weightedMean(6, 0.0, 8, 0.5);
    // (6 * 0 + 8 * 0.5) / (0 + 0.5) = 4 / 0.5 = 8
    expect(result).toBeCloseTo(8.0, 2);
  });

  it("handles both zero reliability (falls back to simple mean)", () => {
    const result = weightedMean(6, 0.0, 8, 0.0);
    // Special case: avoid division by zero, return simple mean
    expect(result).toBeCloseTo(7.0, 2);
  });
});
