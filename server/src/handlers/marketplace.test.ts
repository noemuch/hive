import { describe, it, expect, mock } from "bun:test";
import { handleMarketplace } from "./marketplace";

type QueryCall = [string, unknown[]?];

function makePool(rows: Record<string, unknown>[] = [], total = 0) {
  const query = mock(async (sql: string, _params: unknown[] = []) => {
    if (sql.includes("COUNT(*)")) return { rows: [{ total }] };
    return { rows };
  });
  return { query };
}

function dataCall(pool: ReturnType<typeof makePool>): QueryCall | undefined {
  return pool.query.mock.calls.find((c) => !String(c[0]).includes("COUNT(*)")) as QueryCall | undefined;
}

describe("handleMarketplace", () => {
  it("returns empty agents array when no results (not 404)", async () => {
    const pool = makePool([], 0);
    const req = new Request("http://localhost/api/agents/marketplace");
    const res = await handleMarketplace(req, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.has_more).toBe(false);
  });

  it("shapes row into agent payload with all required fields", async () => {
    const now = new Date();
    const joined = new Date(now.getTime() - 30 * 86_400_000);
    const pool = makePool(
      [
        {
          id: "a1",
          name: "Maxime",
          role: "developer",
          avatar_seed: "seed1",
          score_state_mu: "7.80",
          score_state_sigma: "0.40",
          last_evaluated_at: now,
          llm_provider: "mistral",
          brief: "short brief",
          displayed_skills: [{ slug: "react" }, { slug: "postgres" }],
          displayed_tools: [{ slug: "vscode" }],
          effective_joined_at: joined,
          company_id: "c1",
          company_name: "Lyse",
        },
      ],
      1
    );
    const req = new Request("http://localhost/api/agents/marketplace");
    const res = await handleMarketplace(req, pool as never);
    const body = await res.json();
    expect(body.agents).toHaveLength(1);
    const a = body.agents[0];
    expect(a.id).toBe("a1");
    expect(a.name).toBe("Maxime");
    expect(a.role).toBe("developer");
    expect(a.score_state_mu).toBe(7.8);
    expect(a.score_state_sigma).toBe(0.4);
    expect(a.llm_provider).toBe("mistral");
    expect(a.llm_model_label).toBeNull();
    expect(a.displayed_skills_count).toBe(2);
    expect(a.displayed_tools_count).toBe(1);
    expect(a.company).toEqual({ id: "c1", name: "Lyse" });
    expect(a.days_active).toBe(30);
    expect(a.brief).toBe("short brief");
  });

  it("clamps limit above MAX to 100 and defaults to 24", async () => {
    const pool = makePool();
    await handleMarketplace(new Request("http://localhost/api/agents/marketplace?limit=500"), pool as never);
    const call = dataCall(pool);
    expect(call?.[1]).toContain(100);

    const pool2 = makePool();
    await handleMarketplace(new Request("http://localhost/api/agents/marketplace"), pool2 as never);
    expect(dataCall(pool2)?.[1]).toContain(24);
  });

  it("computes has_more when total > offset + returned", async () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      id: String(i),
      name: "n",
      role: "developer",
      avatar_seed: "s",
      score_state_mu: null,
      score_state_sigma: null,
      last_evaluated_at: null,
      llm_provider: null,
      brief: null,
      displayed_skills: [],
      displayed_tools: [],
      effective_joined_at: new Date(),
      company_id: null,
      company_name: null,
    }));
    const pool = makePool(rows, 100);
    const res = await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?limit=24&offset=0"),
      pool as never
    );
    const body = await res.json();
    expect(body.total).toBe(100);
    expect(body.has_more).toBe(true);
  });

  it("has_more=false on last page", async () => {
    const rows = Array.from({ length: 4 }, () => ({
      id: "x",
      name: "n",
      role: "developer",
      avatar_seed: "s",
      score_state_mu: null,
      score_state_sigma: null,
      last_evaluated_at: null,
      llm_provider: null,
      brief: null,
      displayed_skills: [],
      displayed_tools: [],
      effective_joined_at: new Date(),
      company_id: null,
      company_name: null,
    }));
    const pool = makePool(rows, 100);
    const res = await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?limit=24&offset=96"),
      pool as never
    );
    const body = await res.json();
    expect(body.has_more).toBe(false);
  });

  it("role filter: ?role=developer,designer → WHERE role = ANY", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?role=developer,designer"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/a\.role = ANY/);
    expect(call?.[1]).toContainEqual(["developer", "designer"]);
  });

  it("role filter: ignores unknown values silently", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?role=hacker,developer"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[1]).toContainEqual(["developer"]);
  });

  it("role filter: all values invalid → no role clause", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?role=hacker,wizard"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).not.toMatch(/a\.role = ANY/);
  });

  it("min_score filter passes numeric threshold", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?min_score=7.5"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/score_state_mu >= \$/);
    expect(call?.[1]).toContain(7.5);
  });

  it("min_score filter: non-numeric is ignored", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?min_score=foo"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).not.toMatch(/score_state_mu >=/);
  });

  it("llm_provider filter: ?llm_provider=mistral,anthropic", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?llm_provider=mistral,anthropic"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/llm_provider = ANY/);
    expect(call?.[1]).toContainEqual(["mistral", "anthropic"]);
  });

  it("min_history_days filter: ?min_history_days=30", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?min_history_days=30"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/COALESCE\(a\.backdated_joined_at, a\.created_at\) <=/);
    expect(call?.[1]).toContain(30);
  });

  it("status filter: ?status=active,idle", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?status=active,idle"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/a\.status = ANY/);
    expect(call?.[1]).toContainEqual(["active", "idle"]);
  });

  it("default always excludes retired", async () => {
    const pool = makePool();
    await handleMarketplace(new Request("http://localhost/api/agents/marketplace"), pool as never);
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/status != 'retired'/);
  });

  it("q matches agent name case-insensitive prefix", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?q=maxim"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/ILIKE/);
    expect(call?.[1]).toContain("maxim%");
  });

  it("q joins builders table to match display_name", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?q=noe"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/LEFT JOIN builders b/);
  });

  it("q empty/whitespace-only string is ignored (no ILIKE)", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?q=%20%20"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).not.toMatch(/ILIKE/);
  });

  it("sort=score → ORDER BY score_state_mu DESC", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?sort=score"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/ORDER BY a\.score_state_mu DESC/);
  });

  it("sort=seniority → ORDER BY effective_joined_at ASC (oldest first)", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?sort=seniority"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/COALESCE\(a\.backdated_joined_at, a\.created_at\) ASC/);
  });

  it("sort=recent_activity → ORDER BY last_heartbeat DESC NULLS LAST", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?sort=recent_activity"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/last_heartbeat DESC NULLS LAST/);
  });

  it("sort=artifact_count → joins agent_portfolio_v and orders by artifact_count DESC", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?sort=artifact_count"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/agent_portfolio_v/);
    expect(call?.[0]).toMatch(/artifact_count DESC/);
  });

  it("unknown sort falls back to score", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?sort=nonsense"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/ORDER BY a\.score_state_mu DESC/);
  });

  it("sort=tenured → ORDER BY effective_joined_at ASC (alias of seniority, user-facing name)", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?sort=tenured"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/COALESCE\(a\.backdated_joined_at, a\.created_at\) ASC/);
  });

  it("consistency=stable → joins agent_temporal_stats and filters LIKE 'Stable %'", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?consistency=stable"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/agent_temporal_stats/);
    expect(call?.[0]).toMatch(/temporal\.consistency_badge LIKE 'Stable %'/);
  });

  it("consistency=evolving → equality match on 'Evolving'", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?consistency=evolving"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/temporal\.consistency_badge = 'Evolving'/);
  });

  it("consistency=new → matches 'New' OR missing MV row", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?consistency=new"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/'New' OR temporal\.consistency_badge IS NULL/);
  });

  it("unknown consistency value → filter ignored, no temporal join", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace?consistency=bogus"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).not.toMatch(/agent_temporal_stats/);
    expect(call?.[0]).not.toMatch(/consistency_badge/);
  });

  it("no consistency filter → temporal MV is NOT joined (cost guard)", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request("http://localhost/api/agents/marketplace"),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).not.toMatch(/agent_temporal_stats/);
  });

  it("combined filters: all parameters merged into single WHERE + ORDER BY", async () => {
    const pool = makePool();
    await handleMarketplace(
      new Request(
        "http://localhost/api/agents/marketplace?q=max&role=developer&min_score=6&llm_provider=mistral&min_history_days=7&status=active&sort=artifact_count&limit=10&offset=5"
      ),
      pool as never
    );
    const call = dataCall(pool);
    expect(call?.[0]).toMatch(/ILIKE/);
    expect(call?.[0]).toMatch(/a\.role = ANY/);
    expect(call?.[0]).toMatch(/score_state_mu >=/);
    expect(call?.[0]).toMatch(/llm_provider = ANY/);
    expect(call?.[0]).toMatch(/a\.status = ANY/);
    expect(call?.[0]).toMatch(/artifact_count DESC/);
    expect(call?.[1]).toContain(10);
    expect(call?.[1]).toContain(5);
  });
});
