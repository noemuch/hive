/* @hive-protocol */
// server/src/protocol/ratchet.ts
//
// Pure ratchet phase-transition function (NORTHSTAR §7).
//
// Mirrors the logic of `.github/workflows/ratchet-phase-transition.yml`
// (which does NOT yet exist — tracked as task #42). This pure function is the
// reference implementation the workflow will wrap, and is the function verified
// by the §10.3 property tests.
//
// Phases (§7.1):
//   P0 → P1  via tag `v1.0.0-genesis` (external trigger; modelled as input)
//   P1 → P2  (cumulative_active_90d ≥ 500 AND months_since_P1 ≥ 12) OR months_since_P1 ≥ 36
//   P2 → P3  (cumulative_active_90d ≥ 5000 AND months_since_P2 ≥ 24) OR months_since_P2 ≥ 60
//
// §7.4: phase reversal requires §5.8 + additional 95% supermajority — modelled as
// an external `reversalSupermajority95` boolean that this function may honour, but
// the default `computeNextPhase` never produces a lower phase (monotonicity property).

export type Phase = "P0" | "P1" | "P2" | "P3";

export type RatchetState = {
  phase: Phase;
  /** Active agents cumulated over the trailing 90 days (§7.2). */
  cumulativeActive90d: number;
  /** Whole months since entering the current phase. */
  monthsSincePhaseEntry: number;
  /** True iff the caller holds proof of a §5.8 + 95% successful reversal RFC. */
  reversalSupermajority95?: boolean;
  /** Phase to revert to when `reversalSupermajority95 === true`. */
  reversalTarget?: Phase;
};

const PHASE_ORDER: Phase[] = ["P0", "P1", "P2", "P3"];

export function phaseIndex(phase: Phase): number {
  return PHASE_ORDER.indexOf(phase);
}

/**
 * Advance-or-hold transition.
 *
 * MONOTONICITY (§7.4): unless `reversalSupermajority95` is explicitly set, the
 * returned phase is always ≥ input phase (in PHASE_ORDER). Consumers that want
 * reversal must go through §5.8; this function will honour a signed reversal
 * request but does not originate one.
 */
export function computeNextPhase(state: RatchetState): Phase {
  // Reversal path (gated by §5.8 + 95% — the caller is responsible for proof).
  if (state.reversalSupermajority95 && state.reversalTarget) {
    const target = state.reversalTarget;
    if (phaseIndex(target) < phaseIndex(state.phase)) return target;
  }

  switch (state.phase) {
    case "P0":
      // P0→P1 via external genesis tag (not modelled here).
      return "P0";

    case "P1": {
      const byActivity =
        state.cumulativeActive90d >= 500 && state.monthsSincePhaseEntry >= 12;
      const byTime = state.monthsSincePhaseEntry >= 36;
      return byActivity || byTime ? "P2" : "P1";
    }

    case "P2": {
      const byActivity =
        state.cumulativeActive90d >= 5000 && state.monthsSincePhaseEntry >= 24;
      const byTime = state.monthsSincePhaseEntry >= 60;
      return byActivity || byTime ? "P3" : "P2";
    }

    case "P3":
      return "P3";
  }
}

/**
 * Monotone cumulative counter — given a stream of (timestamp, activeCount)
 * observations within a trailing 90-day window, produce the running count. The
 * property: within the window, the running value is non-decreasing.
 */
export function cumulativeOver90d(
  events: readonly { day: number; delta: number }[],
): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const e of events) {
    // §7.2: "append-only" — delta must be ≥ 0 for the monotonicity invariant.
    // We clamp here to model workflow-level enforcement: any negative is dropped.
    const safe = Math.max(0, e.delta);
    acc += safe;
    out.push(acc);
  }
  return out;
}
