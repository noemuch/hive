import { describe, it, expect, mock } from "bun:test";
import { handleAgentActivity } from "./agent-activity";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

type Row = {
  type: string;
  timestamp: Date | string;
  payload: Record<string, unknown>;
  total: string | number;
};

// Single-query mock: the handler emits one UNION ALL query whose rows are
// already-shaped events. Tests feed the result set and assert the handler's
// response shape + pagination math.
function makePool(rows: Row[], existsRow: Record<string, unknown> | null = { id: VALID_UUID }) {
  return {
    query: mock(async (sql: string, _params: unknown[]) => {
      if (sql.includes("FROM agents") && sql.includes("WHERE id")) {
        return { rows: existsRow === null ? [] : [existsRow] };
      }
      return { rows };
    }),
  };
}

function url(agentId: string, qs: string = "") {
  return new URL(`http://test/api/agents/${agentId}/activity${qs}`);
}

describe("handleAgentActivity", () => {
  it("returns 404 for invalid UUID", async () => {
    const pool = makePool([]);
    const res = await handleAgentActivity("not-a-uuid", url("not-a-uuid"), pool as any);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when agent does not exist", async () => {
    const pool = makePool([], null);
    const res = await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any);
    expect(res.status).toBe(404);
  });

  it("returns empty events + total=0 + has_more=false for agent with no activity", async () => {
    const pool = makePool([]);
    const res = await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.has_more).toBe(false);
  });

  it("returns artifact_created event with only title + type + score (no content)", async () => {
    const pool = makePool([
      {
        type: "artifact_created",
        timestamp: "2026-04-20T10:00:00.000Z",
        payload: {
          artifact_id: "22222222-2222-2222-2222-222222222222",
          title: "Q2 Planning Doc",
          type: "document",
          score: 8.4,
        },
        total: 1,
      },
    ]);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any)).json();
    expect(body.events).toHaveLength(1);
    const ev = body.events[0];
    expect(ev.type).toBe("artifact_created");
    expect(ev.timestamp).toBe("2026-04-20T10:00:00.000Z");
    expect(ev.payload.artifact_id).toBe("22222222-2222-2222-2222-222222222222");
    expect(ev.payload.title).toBe("Q2 Planning Doc");
    expect(ev.payload.type).toBe("document");
    expect(ev.payload.score).toBe(8.4);
    expect(ev.payload.content).toBeUndefined();
    expect(body.total).toBe(1);
  });

  it("returns peer_eval_received event with evaluator_name, score, citation", async () => {
    const pool = makePool([
      {
        type: "peer_eval_received",
        timestamp: "2026-04-19T15:30:00.000Z",
        payload: {
          eval_id: "33333333-3333-3333-3333-333333333333",
          evaluator_name: "Kai from Vantage",
          score: 7.5,
          citation: "The decision rationale is well-structured but underestimates the latency cost.",
        },
        total: 1,
      },
    ]);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any)).json();
    const ev = body.events[0];
    expect(ev.type).toBe("peer_eval_received");
    expect(ev.payload.eval_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(ev.payload.evaluator_name).toBe("Kai from Vantage");
    expect(ev.payload.score).toBe(7.5);
    expect(ev.payload.citation).toContain("decision rationale");
  });

  it("returns milestone event with kind + value", async () => {
    const pool = makePool([
      {
        type: "milestone",
        timestamp: "2026-03-12T08:00:00.000Z",
        payload: { kind: "artifacts_count", value: 100 },
        total: 1,
      },
    ]);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any)).json();
    const ev = body.events[0];
    expect(ev.type).toBe("milestone");
    expect(ev.payload.kind).toBe("artifacts_count");
    expect(ev.payload.value).toBe(100);
  });

  it("returns joined_company event with company_id + company_name", async () => {
    const pool = makePool([
      {
        type: "joined_company",
        timestamp: "2026-01-05T12:00:00.000Z",
        payload: {
          company_id: "44444444-4444-4444-4444-444444444444",
          company_name: "Lyse",
        },
        total: 1,
      },
    ]);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any)).json();
    const ev = body.events[0];
    expect(ev.type).toBe("joined_company");
    expect(ev.payload.company_id).toBe("44444444-4444-4444-4444-444444444444");
    expect(ev.payload.company_name).toBe("Lyse");
  });

  it("has_more=true when total > offset + limit", async () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      type: "artifact_created",
      timestamp: new Date(2026, 3, 20 - i).toISOString(),
      payload: { artifact_id: VALID_UUID, title: `art-${i}`, type: "document", score: null },
      total: 50,
    }));
    const pool = makePool(rows);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID, "?limit=20&offset=0"), pool as any)).json();
    expect(body.total).toBe(50);
    expect(body.events).toHaveLength(20);
    expect(body.has_more).toBe(true);
  });

  it("has_more=false when offset + limit >= total", async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      type: "artifact_created",
      timestamp: new Date(2026, 3, 20 - i).toISOString(),
      payload: { artifact_id: VALID_UUID, title: `art-${i}`, type: "document", score: null },
      total: 25,
    }));
    const pool = makePool(rows);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID, "?limit=20&offset=20"), pool as any)).json();
    expect(body.total).toBe(25);
    expect(body.events).toHaveLength(5);
    expect(body.has_more).toBe(false);
  });

  it("clamps limit to 100 max when caller requests more", async () => {
    const pool = makePool([]);
    await handleAgentActivity(VALID_UUID, url(VALID_UUID, "?limit=999"), pool as any);
    // Second call is the UNION query (first is the exists-check)
    const unionCall = pool.query.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UNION ALL")
    );
    expect(unionCall).toBeTruthy();
    // Params are [agent_id, limit, offset]
    expect(unionCall![1]).toEqual([VALID_UUID, 100, 0, [100, 300, 500, 1000]]);
  });

  it("uses default limit=20 and offset=0 when query params missing", async () => {
    const pool = makePool([]);
    await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any);
    const unionCall = pool.query.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UNION ALL")
    );
    expect(unionCall![1]).toEqual([VALID_UUID, 20, 0, [100, 300, 500, 1000]]);
  });

  it("clamps negative offset to 0 and negative limit to 1", async () => {
    const pool = makePool([]);
    await handleAgentActivity(VALID_UUID, url(VALID_UUID, "?limit=-5&offset=-3"), pool as any);
    const unionCall = pool.query.mock.calls.find((c: any[]) =>
      typeof c[0] === "string" && c[0].includes("UNION ALL")
    );
    expect(unionCall![1]).toEqual([VALID_UUID, 1, 0, [100, 300, 500, 1000]]);
  });

  it("events are returned in the order the SQL produces (desc by timestamp is enforced in SQL)", async () => {
    // The handler trusts the SQL's ORDER BY; this test just confirms the handler
    // doesn't re-sort or drop rows.
    const pool = makePool([
      { type: "artifact_created", timestamp: "2026-04-20T10:00:00.000Z", payload: { artifact_id: "a", title: "", type: "document", score: null }, total: 3 },
      { type: "peer_eval_received", timestamp: "2026-04-19T09:00:00.000Z", payload: { eval_id: "b", evaluator_name: "x", score: 7, citation: null }, total: 3 },
      { type: "joined_company", timestamp: "2026-01-01T00:00:00.000Z", payload: { company_id: "c", company_name: "d" }, total: 3 },
    ]);
    const body = await (await handleAgentActivity(VALID_UUID, url(VALID_UUID), pool as any)).json();
    expect(body.events.map((e: any) => e.type)).toEqual([
      "artifact_created",
      "peer_eval_received",
      "joined_company",
    ]);
  });
});
