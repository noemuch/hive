import { describe, it, expect, mock } from "bun:test";
import {
  handleAgentTemporal,
  clearAgentTemporalCache,
} from "../agent-temporal";

type FakeRows = Record<string, unknown>[];

function makePool(rows: FakeRows) {
  return {
    query: mock(async (_sql: string, _params: unknown[]) => ({ rows })),
  };
}

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

describe("handleAgentTemporal", () => {
  it("returns 404 for an invalid UUID without touching the pool", async () => {
    clearAgentTemporalCache();
    const pool = makePool([]);
    const res = await handleAgentTemporal("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 when no agents row exists (or agent is retired)", async () => {
    clearAgentTemporalCache();
    const pool = makePool([]);
    const res = await handleAgentTemporal(VALID_UUID, pool as never);
    expect(res.status).toBe(404);
  });

  it("returns temporal stats shaped from the MV row joined with current agent score", async () => {
    clearAgentTemporalCache();
    const pool = makePool([
      {
        agent_id: VALID_UUID,
        first_score_at: new Date("2025-05-01T10:00:00Z"),
        current_mu: "7.80",
        current_sigma: "0.30",
        days_active: 1847,
        days_since_first_score: 355,
        mu_evolution: [
          { month: "2025-05", mu: "7.40", sigma: "0.42", n_evals: 8 },
          { month: "2025-06", mu: "7.60", sigma: "0.38", n_evals: 12 },
          { month: "2026-04", mu: "7.80", sigma: "0.30", n_evals: 24 },
        ],
        stability_score: "0.24",
        stability_sample_days: 62,
        consistency_badge: "Stable μ ≥ 7.5 for 365 days",
      },
    ]);
    const res = await handleAgentTemporal(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agent_id).toBe(VALID_UUID);
    expect(body.days_active).toBe(1847);
    expect(body.days_since_first_score).toBe(355);
    expect(body.current_mu).toBe(7.8);
    expect(body.current_sigma).toBe(0.3);
    expect(body.stability_score).toBe(0.24);
    expect(body.stability_sample_days).toBe(62);
    expect(body.consistency_badge).toBe("Stable μ ≥ 7.5 for 365 days");
    expect(body.mu_evolution).toHaveLength(3);
    expect(body.mu_evolution[0]).toEqual({
      month: "2025-05",
      mu: 7.4,
      sigma: 0.42,
      n_evals: 8,
    });
    expect(body.first_score_at).toMatch(/^2025-05-01/);
  });

  it("handles an agent with no MV row yet (left join nulls) gracefully", async () => {
    clearAgentTemporalCache();
    const pool = makePool([
      {
        agent_id: VALID_UUID,
        first_score_at: null,
        current_mu: null,
        current_sigma: null,
        days_active: null,
        days_since_first_score: null,
        mu_evolution: null,
        stability_score: null,
        stability_sample_days: null,
        consistency_badge: null,
      },
    ]);
    const res = await handleAgentTemporal(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.first_score_at).toBeNull();
    expect(body.current_mu).toBeNull();
    expect(body.days_active).toBe(0);
    expect(body.days_since_first_score).toBeNull();
    expect(body.mu_evolution).toEqual([]);
    expect(body.stability_score).toBeNull();
    expect(body.stability_sample_days).toBe(0);
    expect(body.consistency_badge).toBeNull();
  });

  it("drops malformed evolution points instead of returning bogus rows", async () => {
    clearAgentTemporalCache();
    const pool = makePool([
      {
        agent_id: VALID_UUID,
        first_score_at: null,
        current_mu: null,
        current_sigma: null,
        days_active: 0,
        days_since_first_score: null,
        mu_evolution: [
          { month: "2026-04", mu: "7.5", sigma: "0.3", n_evals: 10 },
          { month: null, mu: "7.0", sigma: "0.5", n_evals: 3 },
          { foo: "bar" },
          "not an object",
          { month: "2026-03", mu: null },
        ],
        stability_score: null,
        stability_sample_days: null,
        consistency_badge: null,
      },
    ]);
    const res = await handleAgentTemporal(VALID_UUID, pool as never);
    const body = await res.json();
    expect(body.mu_evolution).toHaveLength(1);
    expect(body.mu_evolution[0].month).toBe("2026-04");
  });
});
