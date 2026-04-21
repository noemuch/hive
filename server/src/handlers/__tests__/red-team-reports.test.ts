import { describe, it, expect, mock } from "bun:test";
import { handleRedTeamReports } from "../red-team-reports";

// Fake pool that returns canned rows based on a router function. Mirrors the
// pattern used by agent-manifest.test.ts — keeps tests pool-agnostic.
type FakeRows = Record<string, unknown>[];
type QueryRouter = (sql: string, params: unknown[]) => FakeRows;

function makePool(router: QueryRouter, throwOnQuery = false) {
  return {
    query: mock(async (sql: string, params: unknown[]) => {
      if (throwOnQuery) throw new Error("db down");
      const rows = router(sql, params);
      return { rows, rowCount: rows.length };
    }),
  };
}

describe("handleRedTeamReports", () => {
  it("returns 200 with the documented response shape", async () => {
    const pool = makePool(() => []);
    const res = await handleRedTeamReports(pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("reports");
    expect(body).toHaveProperty("total_canaries");
    expect(body).toHaveProperty("argus_active");
    expect(Array.isArray(body.reports)).toBe(true);
    expect(typeof body.total_canaries).toBe("number");
    expect(typeof body.argus_active).toBe("boolean");
  });

  it("reports total_canaries as 52 (matches existing canary watermarking)", async () => {
    const pool = makePool(() => []);
    const body = await (await handleRedTeamReports(pool as never)).json();
    expect(body.total_canaries).toBe(52);
  });

  it("seeds the 2026-Q2 launch report with zeros (Argus just launched)", async () => {
    const pool = makePool(() => []);
    const body = await (await handleRedTeamReports(pool as never)).json();
    expect(body.reports.length).toBeGreaterThanOrEqual(1);
    const q2 = body.reports.find(
      (r: { quarter: string }) => r.quarter === "2026-Q2",
    );
    expect(q2).toBeDefined();
    expect(q2.attacks_attempted).toBe(0);
    expect(q2.attacks_successful).toBe(0);
    expect(q2.patches_applied).toBe(0);
    expect(Array.isArray(q2.patterns_discovered)).toBe(true);
    expect(q2.patterns_discovered).toEqual([]);
    expect(typeof q2.published_at).toBe("string");
    // published_at must be ISO-8601 parseable
    expect(Number.isNaN(new Date(q2.published_at).getTime())).toBe(false);
  });

  it("sets argus_active=true when the Argus company has an online agent", async () => {
    const pool = makePool(() => [{ one: 1 }]);
    const body = await (await handleRedTeamReports(pool as never)).json();
    expect(body.argus_active).toBe(true);
  });

  it("sets argus_active=false when no online Argus agent exists", async () => {
    const pool = makePool(() => []);
    const body = await (await handleRedTeamReports(pool as never)).json();
    expect(body.argus_active).toBe(false);
  });

  it("uses parameterized SQL with $1/$2 placeholders (no interpolation) and LIMIT 1", async () => {
    let capturedSql = "";
    let capturedParams: unknown[] = [];
    const pool = {
      query: mock(async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [], rowCount: 0 };
      }),
    };
    await handleRedTeamReports(pool as never);
    expect(capturedSql).toMatch(/\$1/);
    expect(capturedSql).toMatch(/\$2/);
    expect(capturedSql).toMatch(/LIMIT\s+1/i);
    // Argus + online must be parameters, never embedded in the SQL string.
    expect(capturedSql).not.toMatch(/'Argus'/);
    expect(capturedSql).not.toMatch(/'online'/);
    expect(capturedParams).toEqual(["Argus", "online"]);
  });

  it("returns argus_active=false on DB error (public endpoint must not 500)", async () => {
    const pool = makePool(() => [], /* throwOnQuery */ true);
    const res = await handleRedTeamReports(pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.argus_active).toBe(false);
    // Seed reports + canary count must still be present even when the DB is down.
    expect(body.total_canaries).toBe(52);
    expect(body.reports.length).toBeGreaterThanOrEqual(1);
  });

  it("does not use SELECT *", async () => {
    let capturedSql = "";
    const pool = {
      query: mock(async (sql: string) => {
        capturedSql = sql;
        return { rows: [], rowCount: 0 };
      }),
    };
    await handleRedTeamReports(pool as never);
    expect(capturedSql).not.toMatch(/SELECT\s+\*/i);
  });
});
