/* @hive-protocol-test: server/src/protocol/sybil.ts */
//
// Property-based tests for NORTHSTAR §10.3 / Appendix G row "Peer-eval" and
// §3.5 defenses #1, #2, #6.
//
// Pure algebra under test lives in `server/src/protocol/sybil.ts`. The live
// DB-backed aggregation path is `server/src/hear/peer-evaluation.ts`; the
// two should be kept in sync and a follow-up migration is tracked in
// docs/kb/_DEBT.md "peer-evaluation aggregator refactor".

import { describe, it, expect } from "bun:test";
import fc from "fast-check";

import {
  sponsorAggregateWeight,
  meetsExternalFloor,
  componentCappedWeights,
  jaccard,
  type PeerEval,
} from "../../protocol/sybil";

const RUNS = 80;

const arbAgentId = fc.uuid();
const arbSponsorId = fc.uuid();

// ---------- defense #1: builder-weight cap ----------

describe("sybil defense #1 — builder-weight cap", () => {
  it("aggregate weight ≤ 1 per builder per artifact regardless of N", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        arbSponsorId,
        (N, sponsor) => {
          const evals: PeerEval[] = Array.from({ length: N }, (_, i) => ({
            evaluatorAgentId: `agent-${i}`,
            evaluatorSponsorId: sponsor,
            score: 5,
          }));
          const w = sponsorAggregateWeight(evals);
          return w <= 1 && w >= 0;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("is exactly 1 when at least one evaluation exists", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ agentId: arbAgentId, sponsorId: arbSponsorId }), {
          minLength: 1,
          maxLength: 50,
        }),
        (rows) => {
          const evals: PeerEval[] = rows.map((r) => ({
            evaluatorAgentId: r.agentId,
            evaluatorSponsorId: r.sponsorId,
            score: 5,
          }));
          return sponsorAggregateWeight(evals) === 1;
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------- defense #2: external sampling floor ----------

describe("sybil defense #2 — external-sampling floor", () => {
  it("returns true when ≥ 2 of 5 evaluators have Jaccard < 0.15", () => {
    // Deterministic scenario — at least 2 fully-disjoint sponsor sets.
    const producer = new Set(["p1", "p2"]);
    const evaluators: ReadonlySet<string>[] = [
      new Set(["p1", "p2"]),       // jaccard 1.0  — internal
      new Set(["p1"]),             // jaccard 0.5  — internal
      new Set(["external-a"]),     // jaccard 0.0  — external
      new Set(["external-b"]),     // jaccard 0.0  — external
      new Set(["external-c"]),     // jaccard 0.0  — external
    ];
    expect(meetsExternalFloor(producer, evaluators)).toBe(true);
  });

  it("returns false when < 2 evaluators are external", () => {
    const producer = new Set(["p1", "p2"]);
    const evaluators: ReadonlySet<string>[] = [
      new Set(["p1", "p2"]),
      new Set(["p1"]),
      new Set(["p2"]),
      new Set(["p1", "p2", "p3"]),
      new Set(["external-only"]),
    ];
    expect(meetsExternalFloor(producer, evaluators)).toBe(false);
  });

  it("jaccard is bounded [0, 1] for any pair of finite sets", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 20 }),
        fc.array(fc.string(), { maxLength: 20 }),
        (a, b) => {
          const sa = new Set(a);
          const sb = new Set(b);
          const j = jaccard(sa, sb);
          return j >= 0 && j <= 1 && Number.isFinite(j);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

// ---------- defense #6: connected-component cap ----------

describe("sybil defense #6 — connected-component cap", () => {
  it("3+ node component's weights sum to exactly 1", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 10 }),
        (componentSize) => {
          const sponsors = Array.from(
            { length: componentSize },
            (_, i) => `s${i}`,
          );
          // Ring + chord to guarantee connectivity.
          const edges: [string, string][] = [];
          for (let i = 0; i < componentSize - 1; i++) {
            edges.push([sponsors[i], sponsors[i + 1]]);
          }
          edges.push([sponsors[0], sponsors[componentSize - 1]]);

          const weights = componentCappedWeights(sponsors, edges);
          let sum = 0;
          for (const s of sponsors) sum += weights.get(s) ?? 0;
          return Math.abs(sum - 1) < 1e-9;
        },
      ),
      { numRuns: RUNS },
    );
  });

  it("disjoint singletons keep individual weight 1 (defense #1 suffices)", () => {
    const sponsors = ["a", "b", "c"];
    const weights = componentCappedWeights(sponsors, []);
    expect(weights.get("a")).toBe(1);
    expect(weights.get("b")).toBe(1);
    expect(weights.get("c")).toBe(1);
  });
});
