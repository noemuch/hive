/* @hive-protocol-test: server/src/protocol/meta-guard.ts */
//
// Property-based tests for NORTHSTAR §10.3 / Appendix G row "Meta-guard".
//
// Property under test: the 3-layer defense stack
// {protocol-path-guard, meta-guard, watchdog} is acyclic with respect to
// self-verification. The graph has NO self-loop (no node verifies itself) and
// admits a topological order — i.e. watchdog is a source with respect to
// "is verified by", protocol-path-guard is a sink.
//
// Source of truth: `server/src/protocol/meta-guard.ts`.

import { describe, it, expect } from "bun:test";
import fc from "fast-check";

import {
  defenseStack,
  hasSelfLoop,
  topologicalSort,
  type GuardEdge,
  type GuardNode,
} from "../../protocol/meta-guard";

const RUNS = 80;

const NODES: GuardNode[] = [
  "protocol-path-guard",
  "meta-guard",
  "watchdog",
  "signed-anchors",
];

const arbNode: fc.Arbitrary<GuardNode> = fc.constantFrom(...NODES);

describe("meta-guard circularity (§9.3 / §10.3)", () => {
  it("the canonical 3-layer stack has no self-loop", () => {
    expect(hasSelfLoop(defenseStack)).toBe(false);
  });

  it("the canonical 3-layer stack is topologically sortable (no cycles)", () => {
    const order = topologicalSort(NODES, defenseStack);
    expect(order).not.toBeNull();
    expect(order!.length).toBe(NODES.length);
  });

  it("watchdog verifies both meta-guard AND protocol-path-guard (S-R2-4)", () => {
    const watchdogEdges = defenseStack.filter((e) => e.from === "watchdog");
    const verifiedByWatchdog = new Set(watchdogEdges.map((e) => e.to));
    expect(verifiedByWatchdog.has("meta-guard")).toBe(true);
    expect(verifiedByWatchdog.has("protocol-path-guard")).toBe(true);
  });

  it("no guard can verify itself — rejects any injected self-loop edge", () => {
    fc.assert(
      fc.property(arbNode, (node) => {
        const tampered: readonly GuardEdge[] = [
          ...defenseStack,
          { from: node, to: node },
        ];
        // A self-loop ALWAYS trips the detector.
        return hasSelfLoop(tampered);
      }),
      { numRuns: RUNS },
    );
  });

  it("cycles of length 2 are rejected by the topological sort", () => {
    fc.assert(
      fc.property(
        fc.tuple(arbNode, arbNode).filter(([a, b]) => a !== b),
        ([a, b]) => {
          const cyclic: GuardEdge[] = [
            ...defenseStack,
            { from: a, to: b },
            { from: b, to: a },
          ];
          const order = topologicalSort(NODES, cyclic);
          // Either the graph is already acyclic (sort succeeds) or our
          // injected cycle is detected. We require detection whenever the
          // injected edges form a genuine new 2-cycle — the defense stack
          // must not already close that cycle under any injection.
          if (order === null) return true;
          // If the sort succeeded, the injected cycle must have collapsed
          // with existing edges into a DAG — which is only possible when
          // (a,b) or (b,a) was already in defenseStack. Verify that.
          const existing = new Set(defenseStack.map((e) => `${e.from}->${e.to}`));
          return existing.has(`${a}->${b}`) && existing.has(`${b}->${a}`);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
