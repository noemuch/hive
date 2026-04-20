import { describe, it, expect, mock } from "bun:test";
import { handleBuilderProfile } from "./builder-profile";

type QueryCall = { sql: string; params: unknown[] };

function makePool(rowsByCallIndex: unknown[][]) {
  const calls: QueryCall[] = [];
  return {
    calls,
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      const rows = rowsByCallIndex[calls.length - 1] ?? [];
      return { rows };
    }),
  };
}

const VALID_ID = "11111111-2222-3333-4444-555555555555";

describe("handleBuilderProfile", () => {
  it("returns 404 when builder id is not a UUID", async () => {
    const pool = makePool([]);
    const res = await handleBuilderProfile("not-a-uuid", pool as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
    // No DB hit — early return.
    expect(pool.calls.length).toBe(0);
  });

  it("returns 404 when builder row does not exist", async () => {
    // 1st call: builder lookup → no rows.
    const pool = makePool([[]]);
    const res = await handleBuilderProfile(VALID_ID, pool as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns builder + agents + stats on success", async () => {
    const pool = makePool([
      // builder row
      [{
        id: VALID_ID,
        display_name: "Alice",
        tier: "verified",
        socials: { github: "alice" },
        created_at: "2026-01-01T00:00:00Z",
      }],
      // agents list (retired excluded at SQL level)
      [
        {
          id: "a1111111-0000-0000-0000-000000000001",
          name: "Zia",
          role: "pm",
          status: "active",
          avatar_seed: "seed-1",
          score_state_mu: "7.50",
          score_state_sigma: "0.40",
          last_evaluated_at: "2026-04-19T12:00:00Z",
          company_id: "c0000000-0000-0000-0000-000000000001",
          company_name: "Lyse",
        },
        {
          id: "a1111111-0000-0000-0000-000000000002",
          name: "Lou",
          role: "developer",
          status: "idle",
          avatar_seed: "seed-2",
          score_state_mu: null,
          score_state_sigma: null,
          last_evaluated_at: null,
          company_id: null,
          company_name: null,
        },
      ],
      // stats aggregate
      [{
        avg_score: "7.50",
        total_artifacts: 42,
        total_peer_evals_received: 12,
      }],
    ]);

    const res = await handleBuilderProfile(VALID_ID, pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.builder).toEqual({
      id: VALID_ID,
      display_name: "Alice",
      tier: "verified",
      socials: { github: "alice" },
      created_at: "2026-01-01T00:00:00Z",
    });

    expect(body.agents).toHaveLength(2);
    expect(body.agents[0]).toEqual({
      id: "a1111111-0000-0000-0000-000000000001",
      name: "Zia",
      role: "pm",
      status: "active",
      avatar_seed: "seed-1",
      score_state_mu: 7.5,
      score_state_sigma: 0.4,
      last_evaluated_at: "2026-04-19T12:00:00Z",
      company: { id: "c0000000-0000-0000-0000-000000000001", name: "Lyse" },
    });
    expect(body.agents[1].company).toBeNull();
    expect(body.agents[1].score_state_mu).toBeNull();
    expect(body.agents[1].score_state_sigma).toBeNull();

    expect(body.stats).toEqual({
      agent_count: 2,
      avg_score: 7.5,
      total_artifacts: 42,
      total_peer_evals_received: 12,
    });
  });

  it("excludes retired agents via SQL WHERE clause", async () => {
    const pool = makePool([
      [{ id: VALID_ID, display_name: "Bob", tier: "free", socials: {}, created_at: "2026-01-01T00:00:00Z" }],
      [],
      [{ avg_score: null, total_artifacts: 0, total_peer_evals_received: 0 }],
    ]);

    await handleBuilderProfile(VALID_ID, pool as any);

    // Agents query (2nd call) must filter out retired status.
    const agentsCall = pool.calls[1];
    expect(agentsCall.sql).toMatch(/status\s*!=\s*'retired'/i);
    expect(agentsCall.params).toEqual([VALID_ID]);
  });

  it("returns avg_score null when no agents are scored", async () => {
    const pool = makePool([
      [{ id: VALID_ID, display_name: "Carol", tier: "free", socials: {}, created_at: "2026-01-01T00:00:00Z" }],
      [],
      [{ avg_score: null, total_artifacts: 0, total_peer_evals_received: 0 }],
    ]);

    const res = await handleBuilderProfile(VALID_ID, pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
    expect(body.stats).toEqual({
      agent_count: 0,
      avg_score: null,
      total_artifacts: 0,
      total_peer_evals_received: 0,
    });
  });

  it("uses parameterized SQL (never interpolates the id)", async () => {
    const pool = makePool([
      [{ id: VALID_ID, display_name: "D", tier: "free", socials: {}, created_at: "2026-01-01T00:00:00Z" }],
      [],
      [{ avg_score: null, total_artifacts: 0, total_peer_evals_received: 0 }],
    ]);

    await handleBuilderProfile(VALID_ID, pool as any);

    for (const call of pool.calls) {
      expect(call.sql).not.toContain(VALID_ID);
      expect(call.params).toContain(VALID_ID);
    }
  });
});
