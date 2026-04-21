import { describe, it, expect, mock } from "bun:test";
import { handleAgentForksList } from "./agent-forks-list";

// Minimal fake Pool. First call = forks page; second call = COUNT(*).
// Handler issues exactly 2 queries in that order.
type ForkRow = {
  child_agent_id: string;
  child_name: string;
  child_avatar_seed: string;
  builder_name: string | null;
  forked_at: Date | string;
};

function makePool(forks: ForkRow[], total: number) {
  let call = 0;
  return {
    query: mock(async (_sql: string, _params: unknown[]) => {
      call += 1;
      if (call === 1) return { rows: forks };
      return { rows: [{ total }] };
    }),
  };
}

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const CHILD_UUID = "22222222-2222-2222-2222-222222222222";

describe("handleAgentForksList", () => {
  it("returns 404 for invalid UUID", async () => {
    const pool = makePool([], 0);
    const res = await handleAgentForksList("not-a-uuid", null, pool as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns empty forks + total 0 when none exist", async () => {
    const pool = makePool([], 0);
    const res = await handleAgentForksList(VALID_UUID, null, pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.forks).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("maps rows into the documented shape", async () => {
    const forkedAt = new Date("2026-04-19T12:00:00Z");
    const pool = makePool(
      [
        {
          child_agent_id: CHILD_UUID,
          child_name: "Phoenix",
          child_avatar_seed: "seed-1",
          builder_name: "Alice",
          forked_at: forkedAt,
        },
      ],
      1
    );
    const res = await handleAgentForksList(VALID_UUID, null, pool as any);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.forks).toHaveLength(1);
    expect(body.forks[0]).toMatchObject({
      child_agent_id: CHILD_UUID,
      child_name: "Phoenix",
      child_avatar_seed: "seed-1",
      builder_name: "Alice",
    });
    expect(typeof body.forks[0].forked_at).toBe("string");
  });

  it("passes limit through (clamped to [1, 100], default 10)", async () => {
    const pool = makePool([], 0);

    await handleAgentForksList(VALID_UUID, null, pool as any);
    // default: 10
    expect((pool.query as any).mock.calls[0][1]).toEqual([VALID_UUID, 10]);

    await handleAgentForksList(VALID_UUID, "25", pool as any);
    expect((pool.query as any).mock.calls[2][1]).toEqual([VALID_UUID, 25]);

    // clamp above 100
    await handleAgentForksList(VALID_UUID, "1000", pool as any);
    expect((pool.query as any).mock.calls[4][1]).toEqual([VALID_UUID, 100]);

    // clamp below 1 → 1
    await handleAgentForksList(VALID_UUID, "0", pool as any);
    expect((pool.query as any).mock.calls[6][1]).toEqual([VALID_UUID, 1]);

    // garbage → default 10
    await handleAgentForksList(VALID_UUID, "not-a-number", pool as any);
    expect((pool.query as any).mock.calls[8][1]).toEqual([VALID_UUID, 10]);
  });

  it("sets a short public Cache-Control", async () => {
    const pool = makePool([], 0);
    const res = await handleAgentForksList(VALID_UUID, null, pool as any);
    const cc = res.headers.get("Cache-Control");
    expect(cc).toMatch(/^public, max-age=\d+$/);
  });

  it("surfaces DB errors as 500 without leaking the message", async () => {
    const pool = {
      query: mock(async () => {
        throw new Error("boom: connection refused");
      }),
    };
    const res = await handleAgentForksList(VALID_UUID, null, pool as any);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("boom");
  });

  it("handles null builder_name gracefully", async () => {
    const pool = makePool(
      [
        {
          child_agent_id: CHILD_UUID,
          child_name: "Unknown",
          child_avatar_seed: "seed-x",
          builder_name: null,
          forked_at: new Date(),
        },
      ],
      1
    );
    const res = await handleAgentForksList(VALID_UUID, null, pool as any);
    const body = await res.json();
    expect(body.forks[0].builder_name).toBeNull();
  });
});
