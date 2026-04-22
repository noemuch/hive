/* @hive-protocol */
// server/src/protocol/sybil.ts
//
// Pure helpers modelling NORTHSTAR §3.5 sybil-resistance aggregation. The §10.3
// property tests assert:
//   - Builder-weight cap enforcement (defense #1): all agents owned by a single
//     sponsor collapse into 1 unit of aggregate weight per artifact regardless
//     of count.
//   - External sampling floor (defense #2): ≥ 2 of 5 evaluators have Jaccard
//     co-eval < 0.15 with the producer's sponsor.
//   - Connected-component cap (defense #6): a component in the r ≥ 0.6
//     sponsor-correlation subgraph is collectively weight-capped at 1.
//
// The live peer-eval path (`server/src/hear/peer-evaluation.ts`) performs the
// DB-backed version of these computations. This module is the pure algebra.

export type PeerEval = {
  evaluatorAgentId: string;
  evaluatorSponsorId: string;
  score: number;
};

/**
 * Defense #1 — Builder-weight cap.
 *
 * Input: evaluations from a single sponsor's agents on a single artifact.
 * Output: aggregated weight contribution (total per-artifact per-sponsor ≤ 1).
 */
export function sponsorAggregateWeight(evaluations: readonly PeerEval[]): number {
  if (evaluations.length === 0) return 0;
  // Per §3.5 #1: "evaluations from same-sponsor agents collectively cap at 1
  // unit per artifact". We model that as min(1, raw_count) — the raw count is
  // 1-per-eval pre-cap. A correct aggregator can never exceed 1 regardless of
  // how many agents the sponsor spins up.
  return Math.min(1, evaluations.length > 0 ? 1 : 0);
}

/** Jaccard coefficient over two sets of co-eval partner IDs. */
export function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Defense #2 — external-sampling floor.
 *
 * Returns true iff among the 5 evaluators, ≥ 2 have Jaccard < 0.15 with the
 * producer's sponsor.
 */
export function meetsExternalFloor(
  producerSponsor: ReadonlySet<string>,
  evaluatorSponsors: readonly ReadonlySet<string>[],
): boolean {
  if (evaluatorSponsors.length !== 5) return false;
  let externalCount = 0;
  for (const ev of evaluatorSponsors) {
    if (jaccard(producerSponsor, ev) < 0.15) externalCount++;
  }
  return externalCount >= 2;
}

/**
 * Defense #6 — connected-component cap.
 *
 * Input: an adjacency map over sponsors where an edge exists when pairwise
 * correlation r ≥ 0.6. Output: map<sponsorId, componentWeight> where a 3+ -node
 * component is collectively capped at 1. Singletons and pairs retain weight = 1
 * each — defense #1 still applies per-sponsor.
 */
export function componentCappedWeights(
  sponsors: readonly string[],
  highCorrelationEdges: readonly [string, string][],
): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  for (const s of sponsors) adj.set(s, new Set());
  for (const [a, b] of highCorrelationEdges) {
    adj.get(a)?.add(b);
    adj.get(b)?.add(a);
  }

  const seen = new Set<string>();
  const weights = new Map<string, number>();

  for (const start of sponsors) {
    if (seen.has(start)) continue;
    // BFS component.
    const component: string[] = [];
    const queue: string[] = [start];
    seen.add(start);
    while (queue.length) {
      const n = queue.shift()!;
      component.push(n);
      for (const m of adj.get(n) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }

    if (component.length >= 3) {
      // Collectively capped at 1 — distribute evenly so SUM = 1 exactly.
      const share = 1 / component.length;
      for (const s of component) weights.set(s, share);
    } else {
      // Singleton or pair — defense #1 already caps each sponsor to 1.
      for (const s of component) weights.set(s, 1);
    }
  }

  return weights;
}
