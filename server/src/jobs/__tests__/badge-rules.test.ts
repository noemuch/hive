import { describe, it, expect } from "bun:test";
import {
  isThirtyDayProven,
  isNinetyDayProven,
  isPolyglot,
  isThousandArtifacts,
  pickTopTenPctByRole,
  pickMistralChampions,
  type AgentRow,
} from "../badge-rules";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeAgent(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    role: "developer",
    status: "active",
    created_at: new Date(Date.now() - 100 * MS_PER_DAY),
    score_state_mu: 8,
    llm_provider: null,
    displayed_skills_count: 0,
    artifact_count: 0,
    ...over,
  };
}

describe("isThirtyDayProven", () => {
  it("awards when agent is 30d old, score >= 7, and not retired", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 31 * MS_PER_DAY), score_state_mu: 7 });
    expect(isThirtyDayProven(a)).toBe(true);
  });

  it("rejects when younger than 30 days", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 29 * MS_PER_DAY), score_state_mu: 8 });
    expect(isThirtyDayProven(a)).toBe(false);
  });

  it("rejects when score below 7", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 60 * MS_PER_DAY), score_state_mu: 6.9 });
    expect(isThirtyDayProven(a)).toBe(false);
  });

  it("rejects when score is null (not evaluated)", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 60 * MS_PER_DAY), score_state_mu: null });
    expect(isThirtyDayProven(a)).toBe(false);
  });

  it("rejects retired agents", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 60 * MS_PER_DAY), score_state_mu: 8, status: "retired" });
    expect(isThirtyDayProven(a)).toBe(false);
  });
});

describe("isNinetyDayProven", () => {
  it("awards when agent is 90d old, score >= 7.5, and not retired", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 91 * MS_PER_DAY), score_state_mu: 7.5 });
    expect(isNinetyDayProven(a)).toBe(true);
  });

  it("rejects when younger than 90 days", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 80 * MS_PER_DAY), score_state_mu: 9 });
    expect(isNinetyDayProven(a)).toBe(false);
  });

  it("rejects when score below 7.5", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 120 * MS_PER_DAY), score_state_mu: 7.4 });
    expect(isNinetyDayProven(a)).toBe(false);
  });

  it("rejects when score is null", () => {
    const a = makeAgent({ created_at: new Date(Date.now() - 120 * MS_PER_DAY), score_state_mu: null });
    expect(isNinetyDayProven(a)).toBe(false);
  });
});

describe("isPolyglot", () => {
  it("awards when displayed_skills_count >= 3", () => {
    expect(isPolyglot(makeAgent({ displayed_skills_count: 3 }))).toBe(true);
    expect(isPolyglot(makeAgent({ displayed_skills_count: 7 }))).toBe(true);
  });

  it("rejects when < 3 skills", () => {
    expect(isPolyglot(makeAgent({ displayed_skills_count: 2 }))).toBe(false);
    expect(isPolyglot(makeAgent({ displayed_skills_count: 0 }))).toBe(false);
  });
});

describe("isThousandArtifacts", () => {
  it("awards when artifact_count >= 1000", () => {
    expect(isThousandArtifacts(makeAgent({ artifact_count: 1000 }))).toBe(true);
    expect(isThousandArtifacts(makeAgent({ artifact_count: 5000 }))).toBe(true);
  });

  it("rejects when < 1000", () => {
    expect(isThousandArtifacts(makeAgent({ artifact_count: 999 }))).toBe(false);
  });
});

describe("pickTopTenPctByRole", () => {
  it("picks top 10% by score in each role with >= 10 rated peers", () => {
    const agents: AgentRow[] = [];
    for (let i = 0; i < 20; i++) {
      agents.push(makeAgent({ id: `dev-${i}`, role: "developer", score_state_mu: i + 1 }));
    }
    const winners = pickTopTenPctByRole(agents);
    expect(winners.size).toBe(2);
    expect(winners.has("dev-19")).toBe(true);
    expect(winners.has("dev-18")).toBe(true);
    expect(winners.has("dev-17")).toBe(false);
  });

  it("skips roles with fewer than 10 rated peers", () => {
    const agents: AgentRow[] = [];
    for (let i = 0; i < 9; i++) {
      agents.push(makeAgent({ id: `pm-${i}`, role: "pm", score_state_mu: i + 1 }));
    }
    const winners = pickTopTenPctByRole(agents);
    expect(winners.size).toBe(0);
  });

  it("ignores unrated agents (null score) when computing role cohort", () => {
    const agents: AgentRow[] = [];
    for (let i = 0; i < 10; i++) {
      agents.push(makeAgent({ id: `qa-${i}`, role: "qa", score_state_mu: i + 1 }));
    }
    for (let i = 0; i < 20; i++) {
      agents.push(makeAgent({ id: `qa-null-${i}`, role: "qa", score_state_mu: null }));
    }
    const winners = pickTopTenPctByRole(agents);
    expect(winners.size).toBe(1);
    expect(winners.has("qa-9")).toBe(true);
  });

  it("excludes retired agents from consideration", () => {
    const agents: AgentRow[] = [];
    for (let i = 0; i < 10; i++) {
      agents.push(makeAgent({ id: `o-${i}`, role: "ops", score_state_mu: i + 1 }));
    }
    agents[9] = { ...agents[9], status: "retired" };
    const winners = pickTopTenPctByRole(agents);
    expect(winners.has("o-9")).toBe(false);
  });
});

describe("pickMistralChampions", () => {
  it("picks the single highest-scoring mistral agent", () => {
    const agents: AgentRow[] = [
      makeAgent({ id: "m-1", llm_provider: "mistral", score_state_mu: 6 }),
      makeAgent({ id: "m-2", llm_provider: "mistral", score_state_mu: 8.5 }),
      makeAgent({ id: "m-3", llm_provider: "mistral", score_state_mu: 7 }),
      makeAgent({ id: "a-1", llm_provider: "anthropic", score_state_mu: 10 }),
    ];
    const winners = pickMistralChampions(agents);
    expect(winners.size).toBe(1);
    expect(winners.has("m-2")).toBe(true);
  });

  it("picks all tied top scorers", () => {
    const agents: AgentRow[] = [
      makeAgent({ id: "m-1", llm_provider: "mistral", score_state_mu: 8 }),
      makeAgent({ id: "m-2", llm_provider: "mistral", score_state_mu: 8 }),
      makeAgent({ id: "m-3", llm_provider: "mistral", score_state_mu: 7 }),
    ];
    const winners = pickMistralChampions(agents);
    expect(winners.size).toBe(2);
    expect(winners.has("m-1")).toBe(true);
    expect(winners.has("m-2")).toBe(true);
  });

  it("returns empty set when no mistral agents have scores", () => {
    const agents: AgentRow[] = [
      makeAgent({ id: "m-1", llm_provider: "mistral", score_state_mu: null }),
      makeAgent({ id: "a-1", llm_provider: "anthropic", score_state_mu: 9 }),
    ];
    expect(pickMistralChampions(agents).size).toBe(0);
  });

  it("ignores retired agents", () => {
    const agents: AgentRow[] = [
      makeAgent({ id: "m-1", llm_provider: "mistral", score_state_mu: 9, status: "retired" }),
      makeAgent({ id: "m-2", llm_provider: "mistral", score_state_mu: 8 }),
    ];
    const winners = pickMistralChampions(agents);
    expect(winners.size).toBe(1);
    expect(winners.has("m-2")).toBe(true);
  });
});
