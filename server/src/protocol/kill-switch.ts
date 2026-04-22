/* @hive-protocol */
// server/src/protocol/kill-switch.ts
//
// Pure kill-switch state machine (NORTHSTAR §8).
//
// Scope constraints (§8.3):
//   - Kill-switch MUST pause ONLY {dispatch-ready, review, merge} workflows.
//   - Kill-switch MUST NOT mutate protocol files.
//   - Kill-switch MUST NOT pause `ratchet-phase-transition.yml` OR `ratify-rfc.yml`.
//   - Auto-expiry at exactly 7 days from activation.
//
// This module is a REFERENCE MODEL consumed by the §10.3 property tests. A live
// workflow wrapper will read from it to decide what to pause; the workflow itself
// cannot be tested via property-tests so we verify the model here.

export const PAUSABLE_WORKFLOWS = Object.freeze([
  "dispatch-ready",
  "review",
  "merge",
] as const);

export type PausableWorkflow = typeof PAUSABLE_WORKFLOWS[number];

export const EXEMPT_WORKFLOWS = Object.freeze([
  "ratchet-phase-transition.yml",
  "ratify-rfc.yml",
] as const);

export const AUTO_EXPIRY_DAYS = 7;
export const AUTO_EXPIRY_MS = AUTO_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

export type KillSwitchState = {
  activatedAtMs: number | null;
  /** Workflows currently paused by the kill-switch. */
  paused: ReadonlySet<string>;
  /** Protocol files this activation attempted to mutate (MUST stay empty). */
  protocolFileMutations: readonly string[];
};

export type KillSwitchEvent =
  | { type: "activate"; atMs: number; requestedPauses: readonly string[] }
  | { type: "tick"; atMs: number };

export const initialState: KillSwitchState = {
  activatedAtMs: null,
  paused: new Set(),
  protocolFileMutations: [],
};

export function reduce(state: KillSwitchState, event: KillSwitchEvent): KillSwitchState {
  switch (event.type) {
    case "activate": {
      // Filter the requested pause-set to the allowlist (§8.3). Attempting to
      // pause an exempt workflow is silently dropped — the workflow-level impl
      // MUST also surface a §8.5 incident, but the state itself never reflects
      // an illegal pause.
      const allowlist = new Set<string>(PAUSABLE_WORKFLOWS);
      const nextPaused = new Set<string>();
      for (const w of event.requestedPauses) {
        if (allowlist.has(w as PausableWorkflow)) nextPaused.add(w);
      }
      return {
        activatedAtMs: event.atMs,
        paused: nextPaused,
        // An activation MUST NOT declare protocol file mutations. This field
        // stays empty; a non-empty value is an invariant violation detectable
        // by property tests (simulated smuggling).
        protocolFileMutations: [],
      };
    }

    case "tick": {
      if (state.activatedAtMs === null) return state;
      const elapsed = event.atMs - state.activatedAtMs;
      if (elapsed >= AUTO_EXPIRY_MS) {
        return initialState;
      }
      return state;
    }
  }
}

/** Helper for tests: is a given workflow currently paused by the kill-switch? */
export function isPaused(state: KillSwitchState, workflow: string): boolean {
  return state.paused.has(workflow);
}
