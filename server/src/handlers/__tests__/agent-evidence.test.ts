import { describe, it, expect, mock } from "bun:test";
import { handleAgentEvidence } from "../agent-evidence";

// Same pool-mock pattern as agent-profile.test.ts — classify each SQL by
// substring and return canned rows.

const AGENT_UUID = "11111111-1111-1111-1111-111111111111";

type FakeRows = Record<string, unknown>[];

function classify(sql: string): string {
  if (/FROM\s+agents\s+WHERE\s+id/i.test(sql)) return "agent";
  if (/FROM\s+peer_evaluations\s+pe/i.test(sql)) return "evidence";
  return "unknown";
}

function makePool(rows: { agent?: FakeRows; evidence?: FakeRows }) {
  return {
    query: mock(async (sql: string, _params: unknown[]) => {
      const kind = classify(sql);
      if (kind === "agent") return { rows: rows.agent ?? [] };
      if (kind === "evidence") return { rows: rows.evidence ?? [] };
      return { rows: [] };
    }),
  };
}

describe("handleAgentEvidence", () => {
  it("returns 404 for invalid UUID without querying", async () => {
    const pool = makePool({});
    const res = await handleAgentEvidence("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 when agent is missing", async () => {
    const pool = makePool({ agent: [] });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    expect(res.status).toBe(404);
  });

  it("returns 404 when agent is retired", async () => {
    const pool = makePool({ agent: [{ status: "retired" }] });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    expect(res.status).toBe(404);
  });

  it("buckets legacy flat evidence into the 'general' axis", async () => {
    const pool = makePool({
      agent: [{ status: "active" }],
      evidence: [
        {
          evaluation_id: "eval-1",
          evidence_quotes: ["flat quote A", "flat quote B"],
          scores: { reasoning_depth: 7 },
          confidence: 7,
          completed_at: "2026-04-20T10:00:00Z",
          evaluator_name: "Eve",
          evaluator_role: "reviewer",
        },
      ],
    });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.axes).toHaveLength(1);
    expect(body.axes[0].axis).toBe("general");
    expect(body.axes[0].quotes).toHaveLength(2);
    expect(body.axes[0].quotes[0]).toEqual({
      quote: "flat quote A",
      evaluator_name: "Eve",
      evaluator_role: "reviewer",
      score: 7,
    });
  });

  it("distributes per-axis evidence across axis buckets, each quote scored by its axis", async () => {
    const pool = makePool({
      agent: [{ status: "active" }],
      evidence: [
        {
          evaluation_id: "eval-1",
          evidence_quotes: {
            reasoning_depth: ["deep reasoning sample"],
            communication_clarity: ["very clear"],
          },
          scores: { reasoning_depth: 8, communication_clarity: 6 },
          confidence: 7,
          completed_at: "2026-04-20T10:00:00Z",
          evaluator_name: "Eve",
          evaluator_role: "reviewer",
        },
      ],
    });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    const body = await res.json();
    const byAxis = Object.fromEntries(
      body.axes.map((g: { axis: string; quotes: unknown }) => [g.axis, g.quotes])
    );
    expect(byAxis.reasoning_depth[0].score).toBe(8);
    expect(byAxis.communication_clarity[0].score).toBe(6);
  });

  it("sorts axes alphabetically with 'general' last", async () => {
    const pool = makePool({
      agent: [{ status: "active" }],
      evidence: [
        {
          evaluation_id: "e1",
          evidence_quotes: { reasoning_depth: ["q"] },
          scores: { reasoning_depth: 7 },
          confidence: 5,
          completed_at: "2026-04-20T10:00:00Z",
          evaluator_name: "A",
          evaluator_role: "r",
        },
        {
          evaluation_id: "e2",
          evidence_quotes: ["legacy"],
          scores: { decision_wisdom: 6 },
          confidence: 5,
          completed_at: "2026-04-19T10:00:00Z",
          evaluator_name: "B",
          evaluator_role: "r",
        },
        {
          evaluation_id: "e3",
          evidence_quotes: { communication_clarity: ["q"] },
          scores: { communication_clarity: 8 },
          confidence: 5,
          completed_at: "2026-04-18T10:00:00Z",
          evaluator_name: "C",
          evaluator_role: "r",
        },
      ],
    });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    const body = await res.json();
    const axisNames = body.axes.map((g: { axis: string }) => g.axis);
    expect(axisNames).toEqual([
      "communication_clarity",
      "reasoning_depth",
      "general",
    ]);
  });

  it("caps each axis bucket at MAX_QUOTES_PER_AXIS (7)", async () => {
    // One evaluation with 10 quotes on the same axis — should truncate to 7.
    const pool = makePool({
      agent: [{ status: "active" }],
      evidence: [
        {
          evaluation_id: "e1",
          evidence_quotes: {
            reasoning_depth: Array.from({ length: 10 }, (_, i) => `q${i}`),
          },
          scores: { reasoning_depth: 7 },
          confidence: 5,
          completed_at: "2026-04-20T10:00:00Z",
          evaluator_name: "A",
          evaluator_role: "r",
        },
      ],
    });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    const body = await res.json();
    expect(body.axes[0].quotes).toHaveLength(7);
  });

  it("parses jsonb delivered as a raw string (fallback codec)", async () => {
    const pool = makePool({
      agent: [{ status: "active" }],
      evidence: [
        {
          evaluation_id: "e1",
          evidence_quotes: JSON.stringify({ reasoning_depth: ["stringified"] }),
          scores: JSON.stringify({ reasoning_depth: 7 }),
          confidence: 5,
          completed_at: "2026-04-20T10:00:00Z",
          evaluator_name: "A",
          evaluator_role: "r",
        },
      ],
    });
    const res = await handleAgentEvidence(AGENT_UUID, pool as never);
    const body = await res.json();
    expect(body.axes).toHaveLength(1);
    expect(body.axes[0].quotes[0].quote).toBe("stringified");
    expect(body.axes[0].quotes[0].score).toBe(7);
  });
});
