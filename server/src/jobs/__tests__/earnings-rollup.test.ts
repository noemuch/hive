import { describe, it, expect, mock } from "bun:test";
import { rollupEarnings, annotateUnsettledCalls } from "../earnings-rollup";

type QueryMock = ReturnType<typeof mock>;

function makePool(behavior: {
  annotatedRowCount?: number;
  rollupRowCount?: number;
  agentHireCallsExists?: boolean;
  builderEarningsExists?: boolean;
  throwOn?: string;
}): { query: QueryMock; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = mock(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (behavior.throwOn && sql.includes(behavior.throwOn)) {
      const err = new Error("boom") as Error & { code: string };
      err.code = "42P01";
      throw err;
    }
    if (sql.includes("FROM pg_tables")) {
      const table = String(params[0] ?? "");
      if (table === "agent_hire_calls") {
        return { rows: behavior.agentHireCallsExists === false ? [] : [{ exists: true }] };
      }
      if (table === "builder_earnings") {
        return { rows: behavior.builderEarningsExists === false ? [] : [{ exists: true }] };
      }
    }
    if (sql.includes("UPDATE agent_hire_calls")) {
      return { rowCount: behavior.annotatedRowCount ?? 0, rows: [] };
    }
    if (sql.includes("INSERT INTO builder_earnings")) {
      return { rowCount: behavior.rollupRowCount ?? 0, rows: [] };
    }
    return { rows: [] };
  });
  return { query: query as QueryMock, calls };
}

describe("annotateUnsettledCalls", () => {
  it("skips when agent_hire_calls does not exist (pre-#220)", async () => {
    const pool = makePool({ agentHireCallsExists: false });
    const result = await annotateUnsettledCalls(pool as never, { feeBps: 1000 });
    expect(result.annotated).toBe(0);
    expect(result.skipped).toBe("missing_table");
  });

  it("annotates unsettled calls when the table exists", async () => {
    const pool = makePool({ agentHireCallsExists: true, annotatedRowCount: 42 });
    const result = await annotateUnsettledCalls(pool as never, { feeBps: 1000 });
    expect(result.annotated).toBe(42);
    expect(result.skipped).toBeUndefined();
    // Sanity: the UPDATE must use the bps we pass.
    const update = pool.calls.find((c) => c.sql.includes("UPDATE agent_hire_calls"));
    expect(update?.params).toContain(1000);
  });
});

describe("rollupEarnings", () => {
  it("returns skipped when builder_earnings is missing (migration not run)", async () => {
    const pool = makePool({ builderEarningsExists: false });
    const result = await rollupEarnings(pool as never);
    expect(result.skipped).toBe("missing_table");
    expect(result.rollupRowCount).toBe(0);
  });

  it("skips when agent_hire_calls is missing (no calls to settle yet)", async () => {
    const pool = makePool({ builderEarningsExists: true, agentHireCallsExists: false });
    const result = await rollupEarnings(pool as never);
    expect(result.skipped).toBe("missing_table");
  });

  it("annotates then rolls up when both tables exist", async () => {
    const pool = makePool({
      builderEarningsExists: true,
      agentHireCallsExists: true,
      annotatedRowCount: 5,
      rollupRowCount: 3,
    });
    const result = await rollupEarnings(pool as never);
    expect(result.skipped).toBeUndefined();
    expect(result.annotated).toBe(5);
    expect(result.rollupRowCount).toBe(3);
    // The rollup must INSERT ... ON CONFLICT to be idempotent.
    const insert = pool.calls.find((c) => c.sql.includes("INSERT INTO builder_earnings"));
    expect(insert?.sql).toContain("ON CONFLICT");
  });
});
