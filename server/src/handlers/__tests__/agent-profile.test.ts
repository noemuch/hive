import { describe, it, expect, mock } from "bun:test";
import { handleAgentProfile, clearAgentProfileCache } from "../agent-profile";

// Test pattern mirrors agent-badges.test.ts: inject a fake pool whose mock
// `query` function routes each call to a canned response based on an inferred
// query kind (matched against the SQL text). This lets every case exercise
// the whole handler without a real database.

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
const COMPANY_UUID = "22222222-2222-2222-2222-222222222222";
const BUILDER_UUID = "33333333-3333-3333-3333-333333333333";

function baseAgentRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: VALID_UUID,
    name: "Atlas",
    role: "developer",
    personality_brief: "Brief",
    avatar_seed: "atlas",
    llm_provider: "mistral",
    displayed_skills: [{ slug: "typescript", title: "TypeScript" }],
    displayed_tools: [{ slug: "git", title: "Git" }],
    displayed_specializations: ["backend"],
    displayed_languages: ["English"],
    displayed_memory_type: "short-term",
    is_artifact_content_public: false,
    score_state_mu: "7.42",
    score_state_sigma: "0.50",
    last_evaluated_at: "2026-04-15T10:00:00Z",
    status: "active",
    created_at: "2026-01-15T10:00:00Z",
    backdated_joined_at: null,
    company_id: COMPANY_UUID,
    company_name: "Lyse",
    builder_id: BUILDER_UUID,
    builder_name: "Noé",
    ...overrides,
  };
}

function classifyQuery(sql: string): string {
  if (sql.includes("FROM agents a") && sql.includes("LEFT JOIN companies")) return "agent";
  if (sql.includes("DISTINCT ON (axis)")) return "axes";
  if (sql.includes("distinct_axes")) return "evolution";
  if (sql.includes("agent_portfolio_v") || sql.includes("cohort_total")) return "portfolio";
  if (sql.includes("FROM artifacts ar") && sql.includes("ORDER BY ar.created_at DESC")) return "artifacts";
  if (sql.includes("peer_evaluations") && sql.includes("evidence_quotes")) return "citations";
  return "unknown";
}

describe("handleAgentProfile", () => {
  it("returns 404 for invalid UUID without touching the pool", async () => {
    clearAgentProfileCache();
    const pool = makePool(() => []);
    const res = await handleAgentProfile("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 when agent row is missing", async () => {
    clearAgentProfileCache();
    const pool = makePool((sql) => {
      if (classifyQuery(sql) === "agent") return [];
      return [];
    });
    const res = await handleAgentProfile(VALID_UUID, pool as never);
    expect(res.status).toBe(404);
  });

  it("returns 404 when agent is retired", async () => {
    clearAgentProfileCache();
    const pool = makePool((sql) => {
      if (classifyQuery(sql) === "agent") return [baseAgentRow({ status: "retired" })];
      return [];
    });
    const res = await handleAgentProfile(VALID_UUID, pool as never);
    expect(res.status).toBe(404);
  });

  it("returns full payload shape for a fully-graded agent", async () => {
    clearAgentProfileCache();
    const pool = makePool((sql) => {
      switch (classifyQuery(sql)) {
        case "agent":
          return [baseAgentRow()];
        case "axes":
          return [
            { axis: "reasoning_depth", score_state_mu: "8.2", score_state_sigma: "0.4" },
            { axis: "decision_wisdom", score_state_mu: "7.1", score_state_sigma: "0.5" },
          ];
        case "evolution":
          return [
            { date: "2026-04-01", mu: 7.3, sigma: 0.6 },
            { date: "2026-04-10", mu: 7.5, sigma: 0.55 },
          ];
        case "portfolio":
          return [{
            artifact_count: 12,
            peer_evals_received: 8,
            cohort_total: 30,
            cohort_ahead: 4,
          }];
        case "artifacts":
          return [
            { id: "aaa", type: "spec", title: "Spec A", created_at: "2026-04-18T10:00:00Z", score: 8.1 },
            { id: "bbb", type: "ticket", title: "Ticket B", created_at: "2026-04-17T10:00:00Z", score: null },
          ];
        case "citations":
          return [
            {
              evidence_quotes: ["clear and decisive", "well-scoped"],
              evaluator_name: "Nova",
              evaluator_role: "pm",
              confidence: "8.0",
            },
            {
              evidence_quotes: ["solid reasoning"],
              evaluator_name: "Orbit",
              evaluator_role: "developer",
              confidence: "7.2",
            },
          ];
        default:
          return [];
      }
    });

    const res = await handleAgentProfile(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agent.id).toBe(VALID_UUID);
    expect(body.agent.name).toBe("Atlas");
    expect(body.agent.brief).toBe("Brief");
    expect(body.agent.company).toEqual({ id: COMPANY_UUID, name: "Lyse" });
    expect(body.agent.builder).toEqual({ id: BUILDER_UUID, display_name: "Noé" });
    expect(body.agent.llm_provider).toBe("mistral");
    expect(body.agent.llm_model_label).toBeDefined();
    expect(body.agent.avatar_seed).toBe("atlas");
    expect(body.agent.joined_at).toBe("2026-01-15T10:00:00Z"); // backdated null → created_at
    expect(body.agent.displayed_skills).toEqual([{ slug: "typescript", title: "TypeScript" }]);
    expect(body.agent.displayed_tools).toEqual([{ slug: "git", title: "Git" }]);
    expect(body.agent.displayed_specializations).toEqual(["backend"]);
    expect(body.agent.displayed_languages).toEqual(["English"]);
    expect(body.agent.displayed_memory_type).toBe("short-term");

    expect(body.stats.score_state_mu).toBeCloseTo(7.42);
    expect(body.stats.score_state_sigma).toBeCloseTo(0.5);
    expect(body.stats.last_evaluated_at).toBe("2026-04-15T10:00:00Z");
    expect(body.stats.cohort_rank).toEqual({ rank: 5, total: 30, role_label: "developer" });
    expect(body.stats.artifact_count).toBe(12);
    expect(body.stats.peer_evals_received).toBe(8);
    expect(typeof body.stats.days_active).toBe("number");
    expect(body.stats.top_axis).toEqual({ name: "reasoning_depth", score: 8.2 });

    expect(body.axes_breakdown).toHaveLength(2);
    expect(body.axes_breakdown[0]).toEqual({ axis: "reasoning_depth", mu: 8.2, sigma: 0.4 });

    expect(body.score_evolution).toHaveLength(2);
    expect(body.score_evolution[0].date).toBe("2026-04-01");
    expect(body.score_evolution[0].mu).toBeCloseTo(7.3);

    expect(body.recent_artifacts_preview).toHaveLength(2);
    expect(body.recent_artifacts_preview[0].title).toBe("Spec A");
    expect(body.recent_artifacts_preview[0].score).toBeCloseTo(8.1);
    expect(body.recent_artifacts_preview[1].score).toBeNull();

    // Flatten evidence quotes into at most 5 citation entries.
    expect(body.citations).toHaveLength(3);
    expect(body.citations[0]).toEqual({
      quote: "clear and decisive",
      evaluator_name: "Nova",
      evaluator_role: "pm",
      score: 8.0,
    });

    expect(body.is_artifact_content_public).toBe(false);
  });

  it("returns empty stats/axes/evolution for an agent with no HEAR data", async () => {
    clearAgentProfileCache();
    const pool = makePool((sql) => {
      switch (classifyQuery(sql)) {
        case "agent":
          return [baseAgentRow({
            score_state_mu: null,
            score_state_sigma: null,
            last_evaluated_at: null,
          })];
        case "axes":
          return [];
        case "evolution":
          return [];
        case "portfolio":
          return [{
            artifact_count: 0,
            peer_evals_received: 0,
            cohort_total: 0,
            cohort_ahead: 0,
          }];
        case "artifacts":
          return [];
        case "citations":
          return [];
        default:
          return [];
      }
    });

    const body = await (await handleAgentProfile(VALID_UUID, pool as never)).json();
    expect(body.stats.score_state_mu).toBeNull();
    expect(body.stats.score_state_sigma).toBeNull();
    expect(body.stats.last_evaluated_at).toBeNull();
    expect(body.stats.cohort_rank).toBeNull();
    expect(body.stats.top_axis).toBeNull();
    expect(body.axes_breakdown).toEqual([]);
    expect(body.score_evolution).toEqual([]);
    expect(body.recent_artifacts_preview).toEqual([]);
    expect(body.citations).toEqual([]);
  });

  it("uses backdated_joined_at when present", async () => {
    clearAgentProfileCache();
    const pool = makePool((sql) => {
      if (classifyQuery(sql) === "agent") {
        return [baseAgentRow({ backdated_joined_at: "2025-11-01T00:00:00Z" })];
      }
      if (classifyQuery(sql) === "portfolio") {
        return [{ artifact_count: 0, peer_evals_received: 0, cohort_total: 1, cohort_ahead: 0 }];
      }
      return [];
    });
    const body = await (await handleAgentProfile(VALID_UUID, pool as never)).json();
    expect(body.agent.joined_at).toBe("2025-11-01T00:00:00Z");
  });

  it("serves the second call from cache without re-querying", async () => {
    clearAgentProfileCache();
    const pool = makePool((sql) => {
      if (classifyQuery(sql) === "agent") return [baseAgentRow()];
      if (classifyQuery(sql) === "portfolio") {
        return [{ artifact_count: 0, peer_evals_received: 0, cohort_total: 1, cohort_ahead: 0 }];
      }
      return [];
    });
    await handleAgentProfile(VALID_UUID, pool as never);
    const callsAfterFirst = pool.query.mock.calls.length;
    await handleAgentProfile(VALID_UUID, pool as never);
    expect(pool.query.mock.calls.length).toBe(callsAfterFirst);
  });
});
