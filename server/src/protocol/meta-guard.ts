/* @hive-protocol */
// server/src/protocol/meta-guard.ts
//
// Trust-graph model of the §9.3 10-layer defense stack — in particular layers
// 1 (protocol-path-guard), 2 (meta-guard), 3 (watchdog). The §10.3 property
// tests verify that this graph is acyclic with respect to self-verification
// and terminates at an externally-anchored root (watchdog reads PROTOCOL_PATHS
// from signed anchors).

export type GuardNode = "protocol-path-guard" | "meta-guard" | "watchdog" | "signed-anchors";

/**
 * Directed edge "verifier → verified": "watchdog verifies meta-guard" is the
 * edge { from: "watchdog", to: "meta-guard" }.
 *
 * Per §9.3:
 *   - meta-guard verifies protocol-path-guard (SHA match against PROTOCOL_PATHS.sig)
 *   - watchdog verifies meta-guard AND protocol-path-guard (closes S-R2-4)
 *   - signed-anchors (PROTOCOL_PATHS.sig + Steward GPG) is the acyclic root —
 *     it is NOT verified by any of the three guards at runtime; it is verified
 *     out-of-band by ≥ 2 Stewards' GPG signatures.
 */
export type GuardEdge = { from: GuardNode; to: GuardNode };

export const defenseStack: readonly GuardEdge[] = Object.freeze([
  { from: "meta-guard", to: "protocol-path-guard" },
  { from: "watchdog", to: "meta-guard" },
  { from: "watchdog", to: "protocol-path-guard" },
  // signed-anchors is a source node (no incoming "is verified by" edges from
  // our runtime guards). All three runtime guards READ from signed-anchors,
  // but that is a "reads config" relation, not "verifies" — hence the edges
  // below are omitted from the verifies-graph.
]);

/**
 * True iff the "verifies" graph has NO self-verification cycle of length 1
 * (node → node). The property-test also performs a topological sort to reject
 * longer cycles.
 */
export function hasSelfLoop(edges: readonly GuardEdge[]): boolean {
  return edges.some((e) => e.from === e.to);
}

/** Kahn's topological sort — returns null on cycle detection. */
export function topologicalSort(
  nodes: readonly GuardNode[],
  edges: readonly GuardEdge[],
): GuardNode[] | null {
  const indeg = new Map<GuardNode, number>();
  for (const n of nodes) indeg.set(n, 0);
  for (const e of edges) {
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  const queue: GuardNode[] = [];
  for (const [n, d] of indeg) if (d === 0) queue.push(n);
  const order: GuardNode[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const e of edges) {
      if (e.from === n) {
        const d = (indeg.get(e.to) ?? 0) - 1;
        indeg.set(e.to, d);
        if (d === 0) queue.push(e.to);
      }
    }
  }
  return order.length === nodes.length ? order : null;
}
