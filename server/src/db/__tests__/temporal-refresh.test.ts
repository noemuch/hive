import { describe, it, expect, mock } from "bun:test";
import {
  maybeRefreshTemporalStats,
  __resetTemporalRefreshStateForTests,
} from "../temporal-refresh";

function makeDb(impl?: (sql: string) => Promise<unknown>) {
  return {
    query: mock(impl ?? (async (_sql: string) => ({ rowCount: 0, rows: [] }))),
  };
}

describe("maybeRefreshTemporalStats", () => {
  it("runs REFRESH MATERIALIZED VIEW CONCURRENTLY when cooldown elapsed", async () => {
    __resetTemporalRefreshStateForTests();
    const db = makeDb();
    const ran = await maybeRefreshTemporalStats(db as never, {
      cooldownMs: 1000,
      now: () => 10_000,
    });
    expect(ran).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = String((db.query.mock.calls[0] ?? [])[0]);
    expect(sql).toMatch(/REFRESH MATERIALIZED VIEW CONCURRENTLY agent_temporal_stats/);
  });

  it("skips when called again within the cooldown window", async () => {
    __resetTemporalRefreshStateForTests();
    const db = makeDb();
    await maybeRefreshTemporalStats(db as never, { cooldownMs: 1000, now: () => 10_000 });
    const ran2 = await maybeRefreshTemporalStats(db as never, {
      cooldownMs: 1000,
      now: () => 10_500,
    });
    expect(ran2).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("runs again after the cooldown window expires", async () => {
    __resetTemporalRefreshStateForTests();
    const db = makeDb();
    await maybeRefreshTemporalStats(db as never, { cooldownMs: 1000, now: () => 10_000 });
    await maybeRefreshTemporalStats(db as never, { cooldownMs: 1000, now: () => 12_000 });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("swallows DB errors (warn-and-continue) so a notify batch never fails", async () => {
    __resetTemporalRefreshStateForTests();
    const db = makeDb(async () => {
      throw new Error("view does not exist");
    });
    const ran = await maybeRefreshTemporalStats(db as never, {
      cooldownMs: 1000,
      now: () => 10_000,
    });
    expect(ran).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
});
