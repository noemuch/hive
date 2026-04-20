import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { recordEvent, recordFirstEvent } from "./events";

// Silence expected console.error from swallow-error cases.
const originalError = console.error;
beforeAll(() => { console.error = () => {}; });
afterAll(() => { console.error = originalError; });

type QueryCall = { sql: string; params: unknown[] };

function makePool(opts: { firstExists?: boolean; throwOn?: "insert" | "select" } = {}) {
  const calls: QueryCall[] = [];
  const query = mock(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.trim().startsWith("SELECT")) {
      if (opts.throwOn === "select") throw new Error("boom select");
      return { rows: opts.firstExists ? [{ "?column?": 1 }] : [] };
    }
    if (opts.throwOn === "insert") throw new Error("boom insert");
    return { rows: [], rowCount: 1 };
  });
  return { query, calls } as const;
}

describe("recordEvent", () => {
  it("inserts with correct columns + defaults", async () => {
    const pool = makePool();
    await recordEvent(pool as any, "builder_registered", {
      builder_id: "b1",
      metadata: { source: "onboarding" },
    });
    expect(pool.calls).toHaveLength(1);
    const call = pool.calls[0];
    expect(call.sql).toContain("INSERT INTO analytics_events");
    expect(call.params[0]).toBe("builder_registered");
    expect(call.params[1]).toBe("b1");
    expect(call.params[2]).toBeNull();
    expect(call.params[3]).toBe(JSON.stringify({ source: "onboarding" }));
  });

  it("defaults builder_id / agent_id to null when absent", async () => {
    const pool = makePool();
    await recordEvent(pool as any, "agent_deployed", {});
    const call = pool.calls[0];
    expect(call.params[1]).toBeNull();
    expect(call.params[2]).toBeNull();
    expect(call.params[3]).toBe("{}");
  });

  it("strips PII-like keys from metadata", async () => {
    const pool = makePool();
    await recordEvent(pool as any, "agent_deployed", {
      agent_id: "a1",
      metadata: {
        role: "engineer",
        email: "leak@example.com",
        Name: "Jane",
        api_key: "sk-secret",
        personality_brief_len: 120,
      },
    });
    const stored = JSON.parse(pool.calls[0].params[3] as string);
    expect(stored).toEqual({ role: "engineer", personality_brief_len: 120 });
  });

  it("swallows errors (analytics never fails the caller)", async () => {
    const pool = makePool({ throwOn: "insert" });
    await expect(recordEvent(pool as any, "agent_deployed", { agent_id: "a1" }))
      .resolves.toBeUndefined();
  });
});

describe("recordFirstEvent", () => {
  it("inserts when no prior event exists", async () => {
    const pool = makePool({ firstExists: false });
    await recordFirstEvent(pool as any, "first_message_sent", { agent_id: "a1" });
    expect(pool.calls).toHaveLength(2);
    expect(pool.calls[0].sql).toContain("SELECT 1 FROM analytics_events");
    expect(pool.calls[1].sql).toContain("INSERT INTO analytics_events");
  });

  it("skips insert when prior event exists", async () => {
    const pool = makePool({ firstExists: true });
    await recordFirstEvent(pool as any, "first_message_sent", { agent_id: "a1" });
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0].sql).toContain("SELECT");
  });

  it("swallows errors (analytics never fails the caller)", async () => {
    const pool = makePool({ throwOn: "select" });
    await expect(
      recordFirstEvent(pool as any, "first_message_sent", { agent_id: "a1" }),
    ).resolves.toBeUndefined();
  });
});
