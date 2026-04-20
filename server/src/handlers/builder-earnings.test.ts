import { describe, it, expect, mock } from "bun:test";
import {
  DEFAULT_HIVE_FEE_BPS,
  computeFee,
  computeBuilderEarning,
  parseFeeBps,
  isProfitable,
  handleBuilderEarnings,
  handleBuilderEarningsForMonth,
  handleAgentEarnings,
} from "./builder-earnings";

describe("computeFee", () => {
  it("returns 10% of revenue at default bps", () => {
    expect(computeFee(10_000, DEFAULT_HIVE_FEE_BPS)).toBe(1_000);
  });

  it("rounds down fractional cents (half towards zero)", () => {
    expect(computeFee(999, 1000)).toBe(99);
    expect(computeFee(1, 1000)).toBe(0);
  });

  it("returns 0 on zero revenue", () => {
    expect(computeFee(0, 1500)).toBe(0);
  });

  it("honours custom bps", () => {
    expect(computeFee(10_000, 1500)).toBe(1_500);
    expect(computeFee(10_000, 500)).toBe(500);
  });

  it("refuses negative revenue", () => {
    expect(() => computeFee(-1, 1000)).toThrow();
  });

  it("refuses out-of-range bps", () => {
    expect(() => computeFee(100, -1)).toThrow();
    expect(() => computeFee(100, 10_001)).toThrow();
  });
});

describe("computeBuilderEarning", () => {
  it("equals revenue minus fee", () => {
    expect(computeBuilderEarning(10_000, 1000)).toBe(9_000);
  });

  it("is never negative", () => {
    expect(computeBuilderEarning(100, 10_000)).toBe(0);
  });
});

describe("parseFeeBps", () => {
  it("returns default when env unset", () => {
    expect(parseFeeBps(undefined)).toBe(DEFAULT_HIVE_FEE_BPS);
  });

  it("parses a valid integer", () => {
    expect(parseFeeBps("1500")).toBe(1500);
  });

  it("falls back to default on non-integer", () => {
    expect(parseFeeBps("bogus")).toBe(DEFAULT_HIVE_FEE_BPS);
  });

  it("clamps to [0, 10000]", () => {
    expect(parseFeeBps("-5")).toBe(DEFAULT_HIVE_FEE_BPS);
    expect(parseFeeBps("99999")).toBe(DEFAULT_HIVE_FEE_BPS);
  });
});

describe("isProfitable", () => {
  it("true when net earnings exceed LLM cost", () => {
    expect(isProfitable({ netCents: 10_000, llmCostCents: 4_000 })).toBe(true);
  });

  it("false when net equals cost (not strictly greater)", () => {
    expect(isProfitable({ netCents: 5_000, llmCostCents: 5_000 })).toBe(false);
  });

  it("false when revenue is zero", () => {
    expect(isProfitable({ netCents: 0, llmCostCents: 0 })).toBe(false);
  });
});

// ─── Route handlers (integration with a mocked pg pool) ───────────────────

function makeAuthHeaders(token = "valid-token") {
  return { Authorization: `Bearer ${token}` };
}

function makePoolWithRows(rowsByCall: Array<Array<Record<string, unknown>>>) {
  let call = 0;
  return {
    query: mock(async () => {
      const rows = rowsByCall[call] ?? [];
      call += 1;
      return { rows };
    }),
  };
}

function makePoolUndefinedTable() {
  return {
    query: mock(async () => {
      const err = new Error('relation "builder_earnings" does not exist') as Error & { code: string };
      err.code = "42P01";
      throw err;
    }),
  };
}

describe("handleBuilderEarnings", () => {
  it("401 without Bearer token", async () => {
    const req = new Request("http://x/api/builders/me/earnings");
    const res = await handleBuilderEarnings(req, makePoolWithRows([]) as never, () => null);
    expect(res.status).toBe(401);
  });

  it("401 with invalid token", async () => {
    const req = new Request("http://x/api/builders/me/earnings", { headers: makeAuthHeaders() });
    const res = await handleBuilderEarnings(req, makePoolWithRows([]) as never, () => null);
    expect(res.status).toBe(401);
  });

  it("returns zero-filled months when tables are missing (pre-migration)", async () => {
    const req = new Request("http://x/api/builders/me/earnings", { headers: makeAuthHeaders() });
    const res = await handleBuilderEarnings(
      req,
      makePoolUndefinedTable() as never,
      () => ({ builder_id: "b1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { months: Array<{ month: string }> };
    expect(body.months).toHaveLength(12);
  });

  it("returns rows with all derived fields when data exists", async () => {
    const row = {
      month: "2026-04-01",
      hire_revenue_cents: "20000",
      hive_fee_cents: "2000",
      net_cents: "18000",
      agent_count: 3,
      hire_count: 5,
    };
    const req = new Request("http://x/api/builders/me/earnings", { headers: makeAuthHeaders() });
    const res = await handleBuilderEarnings(
      req,
      makePoolWithRows([[row]]) as never,
      () => ({ builder_id: "b1" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      months: Array<{ month: string; hire_revenue_cents: number; net_cents: number }>;
      current: { hire_revenue_cents: number };
      lifetime: { hire_revenue_cents: number };
    };
    const april = body.months.find((m) => m.month === "2026-04-01");
    expect(april?.hire_revenue_cents).toBe(20_000);
    expect(april?.net_cents).toBe(18_000);
    expect(body.lifetime.hire_revenue_cents).toBe(20_000);
  });
});

describe("handleBuilderEarningsForMonth", () => {
  it("400 on invalid month format", async () => {
    const req = new Request("http://x/api/builders/me/earnings/2026-4", { headers: makeAuthHeaders() });
    const res = await handleBuilderEarningsForMonth(req, "2026-4", makePoolWithRows([]) as never, () => ({ builder_id: "b1" }));
    expect(res.status).toBe(400);
  });

  it("returns per-agent breakdown", async () => {
    const row = {
      agent_id: "a1",
      agent_name: "Alice",
      avatar_seed: "alice",
      revenue_cents: "10000",
      fee_cents: "1000",
      net_cents: "9000",
      call_count: 20,
      llm_cost_cents: "500",
    };
    const req = new Request("http://x/api/builders/me/earnings/2026-04", { headers: makeAuthHeaders() });
    const res = await handleBuilderEarningsForMonth(req, "2026-04", makePoolWithRows([[row]]) as never, () => ({ builder_id: "b1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: Array<{ agent_id: string; profitable: boolean; net_cents: number }> };
    expect(body.agents[0].agent_id).toBe("a1");
    expect(body.agents[0].net_cents).toBe(9000);
    expect(body.agents[0].profitable).toBe(true);
  });
});

describe("handleAgentEarnings", () => {
  it("404 on invalid uuid", async () => {
    const req = new Request("http://x/api/agents/not-a-uuid/earnings", { headers: makeAuthHeaders() });
    const res = await handleAgentEarnings(req, "not-a-uuid", makePoolWithRows([]) as never, () => ({ builder_id: "b1" }));
    expect(res.status).toBe(404);
  });

  it("403 when caller is not the agent owner", async () => {
    const uuid = "11111111-1111-4111-a111-111111111111";
    const ownerCheck = [{ builder_id: "other-builder" }];
    const req = new Request(`http://x/api/agents/${uuid}/earnings`, { headers: makeAuthHeaders() });
    const res = await handleAgentEarnings(req, uuid, makePoolWithRows([ownerCheck]) as never, () => ({ builder_id: "b1" }));
    expect(res.status).toBe(403);
  });

  it("returns earnings history for owner", async () => {
    const uuid = "11111111-1111-4111-a111-111111111111";
    const rowsByCall = [
      [{ builder_id: "b1", name: "Alice", avatar_seed: "alice" }],
      [{
        month: "2026-04-01",
        revenue_cents: "10000",
        fee_cents: "1000",
        net_cents: "9000",
        call_count: 20,
        llm_cost_cents: "500",
      }],
    ];
    const req = new Request(`http://x/api/agents/${uuid}/earnings`, { headers: makeAuthHeaders() });
    const res = await handleAgentEarnings(req, uuid, makePoolWithRows(rowsByCall) as never, () => ({ builder_id: "b1" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agent: { id: string };
      months: Array<{ month: string; net_cents: number; profitable: boolean }>;
    };
    expect(body.agent.id).toBe(uuid);
    expect(body.months[0].profitable).toBe(true);
  });
});
