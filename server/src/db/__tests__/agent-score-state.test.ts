import { describe, it, expect, mock } from "bun:test";
import { recomputeAgentScoreState } from "../agent-score-state";

const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

describe("recomputeAgentScoreState", () => {
  it("does not hard-code an axis allowlist in SQL (new axes auto-participate in AVG)", async () => {
    let capturedSql = "";
    const mockDb = {
      query: mock(async (sql: string, _params?: unknown[]) => {
        capturedSql = sql;
        return {
          rowCount: 1,
          rows: [
            {
              agent_id: AGENT_ID,
              company_id: COMPANY_ID,
              score_state_mu: "7.00",
              score_state_sigma: "0.80",
              last_evaluated_at: new Date("2026-04-21T10:00:00.000Z"),
            },
          ],
        };
      }),
    };

    // Generic Queryable requires a type assertion for bun:test's concrete Mock type
    await recomputeAgentScoreState(AGENT_ID, mockDb as never);

    expect(capturedSql).toContain("FROM quality_evaluations");
    expect(capturedSql).toContain("AVG(score_state_mu)");
    expect(capturedSql).toContain("DISTINCT ON (axis)");
    expect(capturedSql).not.toContain("adversarial_robustness");
    expect(capturedSql).not.toContain("reasoning_depth");
  });

  it("returns the UPDATE result as a snapshot (numbers parsed, timestamp isoformatted)", async () => {
    const mockDb = {
      query: mock(async (_sql: string, _params?: unknown[]) => ({
        rowCount: 1,
        rows: [
          {
            agent_id: AGENT_ID,
            company_id: COMPANY_ID,
            score_state_mu: "6.80",
            score_state_sigma: "1.10",
            last_evaluated_at: new Date("2026-04-21T10:00:00.000Z"),
          },
        ],
      })),
    };

    const snap = await recomputeAgentScoreState(AGENT_ID, mockDb as never);
    expect(snap).not.toBeNull();
    expect(snap!.agent_id).toBe(AGENT_ID);
    expect(snap!.company_id).toBe(COMPANY_ID);
    expect(snap!.score_state_mu).toBe(6.8);
    expect(snap!.score_state_sigma).toBe(1.1);
    expect(snap!.last_evaluated_at).toBe("2026-04-21T10:00:00.000Z");
  });

  it("returns null when the agent has no non-invalidated rows (no UPDATE row returned)", async () => {
    const mockDb = {
      query: mock(async (_sql: string, _params?: unknown[]) => ({
        rowCount: 0,
        rows: [],
      })),
    };
    const snap = await recomputeAgentScoreState(AGENT_ID, mockDb as never);
    expect(snap).toBeNull();
  });
});
