import { describe, it, expect, mock } from "bun:test";
import { handleAgentCollection, COLLECTION_SLUGS } from "./collections";

type FakeRow = {
  id: string;
  name: string;
  role: string;
  avatar_seed: string | null;
  score_state_mu: string | number | null;
  score_state_sigma: string | number | null;
  last_evaluated_at: string | null;
  llm_provider: string | null;
  bureau_id: string | null;
  bureau_name: string | null;
  msg_count?: number;
};

const sampleRow = (over: Partial<FakeRow> = {}): FakeRow => ({
  id: "11111111-1111-1111-1111-111111111111",
  name: "Sample Agent",
  role: "developer",
  avatar_seed: "seed-1",
  score_state_mu: "8.25",
  score_state_sigma: "0.5",
  last_evaluated_at: "2026-04-20T00:00:00Z",
  llm_provider: "anthropic",
  bureau_id: "22222222-2222-2222-2222-222222222222",
  bureau_name: "Acme",
  ...over,
});

function makePool(rows: FakeRow[]) {
  const query = mock(async (_sql: string, _params: unknown[]) => ({ rows }));
  return { pool: { query }, query };
}

describe("handleAgentCollection", () => {
  it("returns 404 for unknown slug without hitting the DB", async () => {
    const { pool, query } = makePool([]);
    const res = await handleAgentCollection("not-a-slug", pool as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("unknown_collection");
    expect(query).not.toHaveBeenCalled();
  });

  it("exposes every collection slug from the spec", () => {
    expect(COLLECTION_SLUGS.sort()).toEqual([
      "anthropic-champions",
      "mistral-champions",
      "most-prolific",
      "most-reliable-qa",
      "new-and-promising",
      "top-designers",
      "top-developers",
    ]);
  });

  it.each([
    ["top-developers", "Top Developers"],
    ["top-designers", "Top Designers"],
    ["most-reliable-qa", "Most Reliable QA"],
    ["mistral-champions", "Mistral Champions"],
    ["anthropic-champions", "Anthropic Champions"],
    ["new-and-promising", "New & Promising"],
    ["most-prolific", "Most Prolific"],
  ])("returns 200 with slug=%s and expected title", async (slug, title) => {
    const { pool } = makePool([sampleRow()]);
    const res = await handleAgentCollection(slug, pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.slug).toBe(slug);
    expect(body.title).toBe(title);
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents.length).toBe(1);
  });

  it("shapes the agent payload with numeric scores and nested bureau", async () => {
    const { pool } = makePool([sampleRow()]);
    const body = await (await handleAgentCollection("top-developers", pool as any)).json();
    const agent = body.agents[0];
    expect(agent).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Sample Agent",
      role: "developer",
      avatar_seed: "seed-1",
      score_state_mu: 8.25,
      score_state_sigma: 0.5,
      last_evaluated_at: "2026-04-20T00:00:00Z",
      llm_provider: "anthropic",
      bureau: { id: "22222222-2222-2222-2222-222222222222", name: "Acme" },
    });
  });

  it("returns null score_state_mu/sigma and null bureau when the agent has none", async () => {
    const { pool } = makePool([
      sampleRow({
        score_state_mu: null,
        score_state_sigma: null,
        last_evaluated_at: null,
        llm_provider: null,
        bureau_id: null,
        bureau_name: null,
      }),
    ]);
    const body = await (await handleAgentCollection("top-developers", pool as any)).json();
    const agent = body.agents[0];
    expect(agent.score_state_mu).toBeNull();
    expect(agent.score_state_sigma).toBeNull();
    expect(agent.last_evaluated_at).toBeNull();
    expect(agent.llm_provider).toBeNull();
    expect(agent.bureau).toBeNull();
  });

  it("filters top-developers by role = developer (parameterized)", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("top-developers", pool as any);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("a.role = $2");
    expect(sql).toContain("a.score_state_mu IS NOT NULL");
    expect(params).toEqual([8, "developer"]);
  });

  it("filters top-designers by role = designer (parameterized)", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("top-designers", pool as any);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("a.role = $2");
    expect(params).toEqual([8, "designer"]);
  });

  it("filters most-reliable-qa by role = qa (parameterized)", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("most-reliable-qa", pool as any);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([8, "qa"]);
  });

  it("filters mistral-champions by llm_provider = mistral (parameterized)", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("mistral-champions", pool as any);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("a.llm_provider = $2");
    expect(params).toEqual([8, "mistral"]);
  });

  it("filters anthropic-champions by llm_provider = anthropic (parameterized)", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("anthropic-champions", pool as any);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("a.llm_provider = $2");
    expect(params).toEqual([8, "anthropic"]);
  });

  it("new-and-promising applies the 14-day window and min_score >= 6", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("new-and-promising", pool as any);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("a.created_at > now() - ($2 || ' days')::interval");
    expect(sql).toContain("a.score_state_mu >= $3");
    expect(params).toEqual([8, 14, 6]);
  });

  it("most-prolific counts messages in the last 24h and joins back to agents", async () => {
    const { pool, query } = makePool([]);
    await handleAgentCollection("most-prolific", pool as any);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("author_counts");
    expect(sql).toContain("($2 || ' hours')::interval");
    expect(params).toEqual([8, 24]);
  });

  it("never interpolates slug-derived values into SQL", async () => {
    const injected = "'; DROP TABLE agents; --";
    const res = await handleAgentCollection(injected, {} as any);
    expect(res.status).toBe(404);
  });
});
