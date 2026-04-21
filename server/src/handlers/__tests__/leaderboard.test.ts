import { describe, it, expect, mock, beforeEach } from "bun:test";
import { handleLeaderboardPerformance } from "../leaderboard";
import { marketplaceCache } from "../../cache/lru";

// The performance leaderboard SQL must JOIN `agent_inherited_mu` so
// forked agents see their effective μ (own μ + decaying inheritance from
// parent). Issue #241 A13 acceptance: "Leaderboard correctly uses
// effective_mu".

const AGENT_A = "11111111-1111-1111-1111-111111111111";
const AGENT_B = "22222222-2222-2222-2222-222222222222";

type AgentRow = {
  id: string;
  name: string;
  role: string;
  avatar_seed: string;
  score_state_mu: string | number | null;
  effective_mu: string | number | null;
  score_state_sigma: string | number | null;
  last_evaluated_at: string | null;
  llm_provider: string | null;
  company_id: string | null;
  company_name: string | null;
  created_at: string;
};

function makePool(agents: AgentRow[]) {
  return {
    query: mock(async (sql: string, _params: unknown[]) => {
      if (/FROM agents/i.test(sql) && /LEFT JOIN agent_inherited_mu/i.test(sql)) {
        return { rows: agents };
      }
      // Trend / stats sub-queries — return empty so defaults kick in.
      return { rows: [] };
    }),
  };
}

describe("handleLeaderboardPerformance — effective_mu surfacing (#241 A13)", () => {
  beforeEach(() => {
    // The handler uses a short in-process cache; clear it so each test
    // hits the pool freshly.
    marketplaceCache.clear();
  });

  it("queries agent_inherited_mu and returns effective_mu on each row", async () => {
    const pool = makePool([
      {
        id: AGENT_A,
        name: "Forked",
        role: "engineer",
        avatar_seed: "sa",
        score_state_mu: 5.0,
        effective_mu: 7.0,
        score_state_sigma: 0.8,
        last_evaluated_at: "2026-04-20T00:00:00.000Z",
        llm_provider: null,
        company_id: null,
        company_name: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const url = new URL("http://localhost/api/leaderboard");
    const res = await handleLeaderboardPerformance(url, pool as never);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>> };

    expect(res.status).toBe(200);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].score_state_mu).toBeCloseTo(5.0, 3);
    expect(body.agents[0].effective_mu).toBeCloseTo(7.0, 3);

    // The SQL must reference the new view exactly once.
    const sqlCalls = (pool.query as unknown as {
      mock: { calls: Array<[string, unknown[]]> };
    }).mock.calls;
    const mainSql = sqlCalls.find(([s]) => /FROM agents/.test(s) && /LEFT JOIN/.test(s));
    expect(mainSql).toBeDefined();
    expect(mainSql![0]).toMatch(/agent_inherited_mu/);
  });

  it("leaves effective_mu === score_state_mu for non-forked agents (view returns null)", async () => {
    const pool = makePool([
      {
        id: AGENT_B,
        name: "Native",
        role: "pm",
        avatar_seed: "sb",
        score_state_mu: 6.2,
        effective_mu: null,
        score_state_sigma: 1.0,
        last_evaluated_at: null,
        llm_provider: null,
        company_id: null,
        company_name: null,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const url = new URL("http://localhost/api/leaderboard");
    const res = await handleLeaderboardPerformance(url, pool as never);
    const body = (await res.json()) as { agents: Array<Record<string, unknown>> };
    expect(body.agents[0].score_state_mu).toBeCloseTo(6.2, 3);
    // For non-forked agents the UI should fall back to score_state_mu; the
    // API reports the raw effective_mu from the view (null) so the client
    // can coalesce.
    expect(body.agents[0].effective_mu).toBeNull();
  });
});
