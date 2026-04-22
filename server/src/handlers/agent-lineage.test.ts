import { describe, it, expect, mock } from "bun:test";
import { handleAgentLineage } from "./agent-lineage";

// The handler issues:
//   1. parent lookup (JOIN agent_forks → agents parent) for agentId
//   2. children lookup (JOIN agent_forks → agents child + agent_inherited_mu)
// Tests compose a deterministic pool that returns stubbed rows in that order.

const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const PARENT_ID = "22222222-2222-2222-2222-222222222222";
const CHILD_ID = "33333333-3333-3333-3333-333333333333";

type ParentRow = {
  parent_agent_id: string;
  parent_name: string;
  parent_avatar_seed: string;
  parent_bureau_name: string | null;
  forked_at: Date | string;
  parent_mu_at_fork: string | number | null;
  days_since_fork: string | number;
};

type ChildRow = {
  child_agent_id: string;
  child_name: string;
  child_avatar_seed: string;
  own_mu: string | number | null;
  effective_mu: string | number | null;
  days_since_fork: string | number;
  forked_at: Date | string;
};

function makePool(opts: { parent?: ParentRow | null; children?: ChildRow[] }) {
  let call = 0;
  return {
    query: mock(async (_sql: string, _params?: unknown[]) => {
      call += 1;
      if (call === 1) {
        return { rows: opts.parent ? [opts.parent] : [] };
      }
      return { rows: opts.children ?? [] };
    }),
  };
}

describe("handleAgentLineage (#241 A13)", () => {
  it("returns 404 for an invalid UUID", async () => {
    const pool = makePool({});
    const res = await handleAgentLineage("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
  });

  it("returns parent=null and children=[] for an agent with no lineage", async () => {
    const pool = makePool({ parent: null, children: [] });
    const res = await handleAgentLineage(AGENT_ID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent).toBeNull();
    expect(body.children).toEqual([]);
    expect(body.children_total).toBe(0);
  });

  it("exposes decay metrics on the parent block (day 0 → 25% weight, 30 days remaining)", async () => {
    const pool = makePool({
      parent: {
        parent_agent_id: PARENT_ID,
        parent_name: "Root",
        parent_avatar_seed: "seed-root",
        parent_bureau_name: "HQ",
        forked_at: new Date(),
        parent_mu_at_fork: 8.0,
        days_since_fork: 0,
      },
      children: [],
    });
    const res = await handleAgentLineage(AGENT_ID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.parent.parent_agent_id).toBe(PARENT_ID);
    expect(body.parent.parent_name).toBe("Root");
    expect(body.parent.parent_mu_at_fork).toBeCloseTo(8.0, 2);
    expect(body.parent.inheritance.weight).toBeCloseTo(0.25, 3);
    expect(body.parent.inheritance.component).toBeCloseTo(2.0, 3);
    expect(body.parent.inheritance.days_remaining).toBe(30);
  });

  it("zeroes inheritance past the 30-day window", async () => {
    const pool = makePool({
      parent: {
        parent_agent_id: PARENT_ID,
        parent_name: "Root",
        parent_avatar_seed: "seed-root",
        parent_bureau_name: null,
        forked_at: new Date(),
        parent_mu_at_fork: 8.0,
        days_since_fork: 45,
      },
      children: [],
    });
    const res = await handleAgentLineage(AGENT_ID, pool as never);
    const body = await res.json();
    expect(body.parent.inheritance.weight).toBe(0);
    expect(body.parent.inheritance.component).toBe(0);
    expect(body.parent.inheritance.days_remaining).toBe(0);
  });

  it("returns children with their effective_mu (from the SQL view)", async () => {
    const pool = makePool({
      parent: null,
      children: [
        {
          child_agent_id: CHILD_ID,
          child_name: "Echo",
          child_avatar_seed: "seed-echo",
          own_mu: 5.0,
          effective_mu: 7.0,
          days_since_fork: 0,
          forked_at: new Date(),
        },
      ],
    });
    const res = await handleAgentLineage(AGENT_ID, pool as never);
    const body = await res.json();
    expect(body.children).toHaveLength(1);
    expect(body.children[0].child_agent_id).toBe(CHILD_ID);
    expect(body.children[0].own_mu).toBeCloseTo(5.0, 2);
    expect(body.children[0].effective_mu).toBeCloseTo(7.0, 2);
    expect(body.children_total).toBe(1);
  });

  it("surfaces DB errors as 500 without leaking the message", async () => {
    const pool = {
      query: mock(async () => {
        throw new Error("boom: connection refused");
      }),
    };
    const res = await handleAgentLineage(AGENT_ID, pool as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("sets a short public Cache-Control", async () => {
    const pool = makePool({ parent: null, children: [] });
    const res = await handleAgentLineage(AGENT_ID, pool as never);
    expect(res.headers.get("Cache-Control")).toMatch(/^public, max-age=\d+$/);
  });

  it("registers the GET /api/agents/:id/lineage route via the routes export", async () => {
    const { routes } = await import("./agent-lineage");
    expect(routes).toHaveLength(1);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/api/agents/:id/lineage");
  });
});
