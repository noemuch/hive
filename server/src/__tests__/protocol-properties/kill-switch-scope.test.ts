/* @hive-protocol-test: server/src/protocol/kill-switch.ts */
//
// Property-based tests for NORTHSTAR §10.3 / Appendix G row "Kill-switch", §8.3.
//
// The pure state machine under test lives in `server/src/protocol/kill-switch.ts`.
// The eventual live wrapper will be a GitHub Action; that workflow cannot be
// property-tested directly, so we verify the model here and require the
// workflow to import-and-apply this exact module (meta-guard checks path).

import { describe, it, expect } from "bun:test";
import fc from "fast-check";

import {
  reduce,
  initialState,
  isPaused,
  PAUSABLE_WORKFLOWS,
  EXEMPT_WORKFLOWS,
  AUTO_EXPIRY_MS,
  type KillSwitchEvent,
  type KillSwitchState,
} from "../../protocol/kill-switch";

const RUNS = 80;

const arbWorkflow = fc.oneof(
  fc.constantFrom(...PAUSABLE_WORKFLOWS),
  fc.constantFrom(...EXEMPT_WORKFLOWS),
  fc.constantFrom("claude-ready", "issue-triage", "daily-qa-digest"),
);

// ---------- §8.3 scope ----------

describe("kill-switch scope (§8.3)", () => {
  it("activation pauses ONLY {dispatch-ready, review, merge}", () => {
    fc.assert(
      fc.property(
        fc.array(arbWorkflow, { minLength: 1, maxLength: 10 }),
        (requested) => {
          const state = reduce(initialState, {
            type: "activate",
            atMs: 0,
            requestedPauses: requested,
          });
          for (const w of state.paused) {
            if (!PAUSABLE_WORKFLOWS.includes(w as (typeof PAUSABLE_WORKFLOWS)[number])) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("NEVER pauses ratchet-phase-transition.yml or ratify-rfc.yml", () => {
    fc.assert(
      fc.property(
        fc.array(arbWorkflow, { minLength: 1, maxLength: 10 }),
        (requested) => {
          // Force the adversary to explicitly include the exempt workflows.
          const all = [...requested, ...EXEMPT_WORKFLOWS];
          const state = reduce(initialState, {
            type: "activate",
            atMs: 0,
            requestedPauses: all,
          });
          return (
            !isPaused(state, "ratchet-phase-transition.yml") &&
            !isPaused(state, "ratify-rfc.yml")
          );
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("protocol file mutations are always empty (cannot mutate §2.1 closure)", () => {
    fc.assert(
      fc.property(
        fc.array(arbWorkflow, { minLength: 1, maxLength: 10 }),
        (requested) => {
          const state = reduce(initialState, {
            type: "activate",
            atMs: 0,
            requestedPauses: requested,
          });
          return state.protocolFileMutations.length === 0;
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------- 7-day auto-expiry ----------

describe("kill-switch auto-expiry (§8.3)", () => {
  it("expires at exactly 7 days", () => {
    const activated: KillSwitchState = reduce(initialState, {
      type: "activate",
      atMs: 1_000_000,
      requestedPauses: ["dispatch-ready", "review", "merge"],
    });

    // Just-before expiry: still paused.
    const justBefore = reduce(activated, {
      type: "tick",
      atMs: 1_000_000 + AUTO_EXPIRY_MS - 1,
    });
    expect(justBefore.paused.size).toBe(3);

    // At expiry boundary: cleared.
    const atExpiry = reduce(activated, {
      type: "tick",
      atMs: 1_000_000 + AUTO_EXPIRY_MS,
    });
    expect(atExpiry.paused.size).toBe(0);
    expect(atExpiry.activatedAtMs).toBeNull();
  });

  it("tick on never-activated state is a no-op", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), (t) => {
        const state = reduce(initialState, { type: "tick", atMs: t });
        return state.activatedAtMs === null && state.paused.size === 0;
      }),
      { numRuns: RUNS },
    );
  });
});
