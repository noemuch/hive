/* @hive-protocol-test: server/src/protocol/ratchet.ts */
//
// Property-based tests for NORTHSTAR §10.3 / Appendix G row "Ratchet", §7.
//
// The property tests operate on the pure function `computeNextPhase` in
// `server/src/protocol/ratchet.ts`. The future workflow
// `.github/workflows/ratchet-phase-transition.yml` (task #42) will import
// this function verbatim — any divergence between yml thresholds and the
// pure helper is caught by meta-guard.yml (§7.5 final bullet).

import { describe, it, expect } from "bun:test";
import fc from "fast-check";

import {
  computeNextPhase,
  cumulativeOver90d,
  phaseIndex,
  type Phase,
  type RatchetState,
} from "../../protocol/ratchet";

const RUNS = 80;

const arbPhase: fc.Arbitrary<Phase> = fc.constantFrom("P0", "P1", "P2", "P3");

const arbRatchetState: fc.Arbitrary<RatchetState> = fc.record({
  phase: arbPhase,
  cumulativeActive90d: fc.integer({ min: 0, max: 10_000 }),
  monthsSincePhaseEntry: fc.integer({ min: 0, max: 120 }),
});

// ---------- §7.4 monotonicity ----------

describe("ratchet monotonicity (§7.4)", () => {
  it("never returns a lower phase absent §5.8 + 95% reversal proof", () => {
    fc.assert(
      fc.property(arbRatchetState, (state) => {
        const next = computeNextPhase(state);
        return phaseIndex(next) >= phaseIndex(state.phase);
      }),
      { numRuns: RUNS },
    );
  });

  it("honours §5.8 + 95% reversal proof when explicitly provided", () => {
    const state: RatchetState = {
      phase: "P2",
      cumulativeActive90d: 0,
      monthsSincePhaseEntry: 0,
      reversalSupermajority95: true,
      reversalTarget: "P1",
    };
    expect(computeNextPhase(state)).toBe("P1");
  });
});

// ---------- §7.1 time-only fallback ----------

describe("ratchet time-only fallback (§7.1)", () => {
  it("P1 → P2 fires at 36 months even with 0 cumulative active", () => {
    const state: RatchetState = {
      phase: "P1",
      cumulativeActive90d: 0,
      monthsSincePhaseEntry: 36,
    };
    expect(computeNextPhase(state)).toBe("P2");
  });

  it("P2 → P3 fires at 60 months even with 0 cumulative active", () => {
    const state: RatchetState = {
      phase: "P2",
      cumulativeActive90d: 0,
      monthsSincePhaseEntry: 60,
    };
    expect(computeNextPhase(state)).toBe("P3");
  });

  it("P1 → P2 activity trigger (500 + 12 months) also fires", () => {
    const state: RatchetState = {
      phase: "P1",
      cumulativeActive90d: 500,
      monthsSincePhaseEntry: 12,
    };
    expect(computeNextPhase(state)).toBe("P2");
  });
});

// ---------- exhaustive enumeration ----------

describe("exhaustive state-space search for decrement paths (§10.3)", () => {
  it("no path decrements phase over bounded state space without reversal proof", () => {
    const phases: Phase[] = ["P0", "P1", "P2", "P3"];
    const cumulativeBuckets = [0, 250, 500, 2500, 5000, 10_000];
    const monthsBuckets = [0, 11, 12, 23, 24, 35, 36, 59, 60, 120];
    let decrementFound = false;
    for (const p of phases) {
      for (const c of cumulativeBuckets) {
        for (const m of monthsBuckets) {
          const next = computeNextPhase({
            phase: p,
            cumulativeActive90d: c,
            monthsSincePhaseEntry: m,
          });
          if (phaseIndex(next) < phaseIndex(p)) decrementFound = true;
        }
      }
    }
    expect(decrementFound).toBe(false);
  });
});

// ---------- cumulative metric is monotone ----------

describe("cumulativeOver90d monotonicity (§7.2)", () => {
  it("running sum is non-decreasing for non-negative deltas", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            day: fc.integer({ min: 0, max: 89 }),
            delta: fc.integer({ min: 0, max: 100 }),
          }),
          { minLength: 1, maxLength: 200 },
        ),
        (events) => {
          const running = cumulativeOver90d(events);
          for (let i = 1; i < running.length; i++) {
            if (running[i] < running[i - 1]) return false;
          }
          return true;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("negative deltas are clamped to 0 (append-only §7.2)", () => {
    const running = cumulativeOver90d([
      { day: 0, delta: 5 },
      { day: 1, delta: -3 },
      { day: 2, delta: 2 },
    ]);
    expect(running).toEqual([5, 5, 7]);
  });
});
