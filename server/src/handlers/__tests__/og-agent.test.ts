import { describe, it, expect, mock } from "bun:test";
import { handleOgAgent } from "../og-agent";

// Same pattern as agent-profile.test.ts: inject a fake pool whose `query`
// returns canned rows. We don't mock the renderer — rendering a PNG in Bun
// is fast (<100ms warm) and exercising the real path catches font / resvg
// regressions that a mock would hide.

type FakeRows = Record<string, unknown>[];
type QueryRouter = (sql: string, params: unknown[]) => FakeRows;

function makePool(router: QueryRouter) {
  return {
    query: mock(async (sql: string, params: unknown[]) => ({
      rows: router(sql, params),
    })),
  };
}

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

const BASE_ROW = {
  name: "Atlas",
  role: "developer",
  avatar_seed: "atlas",
  score_state_mu: "7.42",
  llm_provider: "mistral",
  status: "active",
  bureau_name: "Lyse",
};

function assertPng(res: Response, body: ArrayBuffer) {
  expect(res.headers.get("Content-Type")).toBe("image/png");
  const bytes = new Uint8Array(body);
  expect(bytes[0]).toBe(0x89);
  expect(bytes[1]).toBe(0x50);
  expect(bytes[2]).toBe(0x4e);
  expect(bytes[3]).toBe(0x47);
}

describe("handleOgAgent", () => {
  it("returns 404 PNG for invalid UUID without touching the pool", async () => {
    const pool = makePool(() => []);
    const res = await handleOgAgent("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
    assertPng(res, await res.arrayBuffer());
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 PNG when agent is missing", async () => {
    const pool = makePool(() => []);
    const res = await handleOgAgent(VALID_UUID, pool as never);
    expect(res.status).toBe(404);
    assertPng(res, await res.arrayBuffer());
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("returns 404 PNG when agent is retired", async () => {
    const pool = makePool(() => [{ ...BASE_ROW, status: "retired" }]);
    const res = await handleOgAgent(VALID_UUID, pool as never);
    expect(res.status).toBe(404);
    assertPng(res, await res.arrayBuffer());
  });

  it("returns 200 PNG with cache headers for a fully-populated agent", async () => {
    const pool = makePool(() => [BASE_ROW]);
    const res = await handleOgAgent(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, s-maxage=3600"
    );
    assertPng(res, await res.arrayBuffer());
  });

  it("uses exactly one parameterized query to fetch agent + bureau", async () => {
    const pool = makePool(() => [BASE_ROW]);
    await handleOgAgent(VALID_UUID, pool as never);
    expect(pool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("FROM agents");
    expect(sql).toContain("LEFT JOIN bureaux");
    expect(params).toEqual([VALID_UUID]);
  });

  it("renders 200 PNG for an agent with null score", async () => {
    const pool = makePool(() => [{ ...BASE_ROW, score_state_mu: null }]);
    const res = await handleOgAgent(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    assertPng(res, await res.arrayBuffer());
  });

  it("renders 200 PNG when bureau is null (independent agent)", async () => {
    const pool = makePool(() => [{ ...BASE_ROW, bureau_name: null }]);
    const res = await handleOgAgent(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    assertPng(res, await res.arrayBuffer());
  });
});
