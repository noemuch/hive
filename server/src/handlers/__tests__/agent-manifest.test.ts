import { describe, it, expect, mock } from "bun:test";
import { handleAgentManifest } from "../agent-manifest";

// Mirrors agent-profile.test.ts pattern: fake pool with a router that
// classifies each SQL to a canned row set. Keeps tests pool-agnostic and
// immune to cross-query ordering changes in the handler.

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
const BUREAU_UUID = "22222222-2222-2222-2222-222222222222";
const BUILDER_UUID = "33333333-3333-3333-3333-333333333333";

function baseAgentRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: VALID_UUID,
    name: "Atlas",
    role: "developer",
    personality_brief: "A principled engineer.",
    avatar_seed: "atlas",
    llm_provider: "mistral",
    displayed_skills: [{ slug: "typescript", title: "TypeScript" }],
    displayed_tools: [{ slug: "git", title: "Git" }],
    displayed_languages: ["English", "French"],
    displayed_memory_type: "short-term",
    is_artifact_content_public: false,
    score_state_mu: "7.42",
    score_state_sigma: "0.50",
    status: "active",
    created_at: "2026-01-15T10:00:00Z",
    backdated_joined_at: null,
    builder_id: BUILDER_UUID,
    bureau_id: BUREAU_UUID,
    artifact_count: "12",
    peer_evals_received: "8",
    last_artifact_at: "2026-04-18T10:00:00Z",
    axes_breakdown: [
      { axis: "reasoning_depth", mu: 8.2, sigma: 0.4 },
      { axis: "decision_wisdom", mu: 7.1, sigma: 0.5 },
    ],
    ...overrides,
  };
}

describe("handleAgentManifest", () => {
  it("returns 404 for invalid UUID without touching the pool", async () => {
    const pool = makePool(() => []);
    const res = await handleAgentManifest("not-a-uuid", pool as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
    expect(pool.query).not.toHaveBeenCalled();
  });

  it("returns 404 when agent row is missing", async () => {
    const pool = makePool(() => []);
    const res = await handleAgentManifest(VALID_UUID, pool as never);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 410 Gone for a retired agent", async () => {
    const pool = makePool(() => [baseAgentRow({ status: "retired" })]);
    const res = await handleAgentManifest(VALID_UUID, pool as never);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("gone");
  });

  it("returns a Capability Manifest v1 payload for an active agent", async () => {
    const pool = makePool(() => [baseAgentRow()]);
    const res = await handleAgentManifest(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agent_id).toBe(VALID_UUID);
    expect(body.manifest_version).toBe("1");

    // Identity
    expect(body.identity).toBeDefined();
    expect(body.identity.slug).toBe("Atlas");
    expect(body.identity.display_name).toBe("Atlas");
    expect(body.identity.role).toBe("developer");
    expect(body.identity.avatar_seed).toBe("atlas");
    expect(body.identity.about).toBe("A principled engineer.");
    expect(body.identity.builder_id).toBe(BUILDER_UUID);
    expect(body.identity.bureau_id).toBe(BUREAU_UUID);
    expect(body.identity.joined_at).toBe("2026-01-15T10:00:00Z");
    expect(body.identity.languages).toEqual(["English", "French"]);

    // LLM
    expect(body.llm).toBeDefined();
    expect(body.llm.provider).toBe("mistral");
    expect(body.llm.model).toBeNull();

    // Pattern + memory + instructions
    expect(typeof body.pattern).toBe("string");
    expect(body.memory).toEqual({ type: "short-term" });
    expect(body.instructions_public).toBe(false);
    expect(body.instructions).toBeNull();

    // Declared loadout — surfaces displayed_skills / displayed_tools.
    expect(body.skills).toEqual([{ slug: "typescript", title: "TypeScript" }]);
    expect(body.tools).toEqual([{ slug: "git", title: "Git" }]);

    // Phase-5 / Phase 1.5+ placeholders (empty but present).
    expect(body.mcp_servers).toEqual([]);
    expect(body.handoffs).toEqual([]);
    expect(body.guardrails).toEqual({ input: [], output: [] });

    // Runtime capabilities — constants per spec § 4.3.
    expect(body.runtime_caps.max_tokens_per_response).toBe(1000);
    expect(body.runtime_caps.rate_limit_msgs_per_min).toBe(3);

    // Track record
    expect(body.track_record.artifact_count).toBe(12);
    expect(body.track_record.peer_evals_received).toBe(8);
    expect(body.track_record.score_state_mu).toBeCloseTo(7.42);
    expect(body.track_record.score_state_sigma).toBeCloseTo(0.5);
    expect(body.track_record.reliability_indicator).toBeNull();
    expect(body.track_record.last_artifact_at).toBe("2026-04-18T10:00:00Z");
    expect(body.track_record.axes_breakdown).toEqual([
      { axis: "reasoning_depth", mu: 8.2, sigma: 0.4 },
      { axis: "decision_wisdom", mu: 7.1, sigma: 0.5 },
    ]);

    // Policies
    expect(body.policies.is_artifact_content_public).toBe(false);
    expect(typeof body.policies.is_forkable).toBe("boolean");
    expect(typeof body.policies.is_hireable).toBe("boolean");
  });

  it("sets Cache-Control: public, max-age=60", async () => {
    const pool = makePool(() => [baseAgentRow()]);
    const res = await handleAgentManifest(VALID_UUID, pool as never);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("handles a minimal-fields agent (no score, no portfolio, no provider)", async () => {
    const pool = makePool(() => [
      baseAgentRow({
        llm_provider: null,
        score_state_mu: null,
        score_state_sigma: null,
        artifact_count: null,
        peer_evals_received: null,
        last_artifact_at: null,
        axes_breakdown: null,
        displayed_skills: [],
        displayed_tools: [],
        displayed_languages: ["English"],
        personality_brief: null,
        bureau_id: null,
      }),
    ]);
    const res = await handleAgentManifest(VALID_UUID, pool as never);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.llm.provider).toBeNull();
    expect(body.llm.model).toBeNull();
    expect(body.identity.about).toBeNull();
    expect(body.identity.bureau_id).toBeNull();
    expect(body.skills).toEqual([]);
    expect(body.tools).toEqual([]);
    expect(body.track_record.score_state_mu).toBeNull();
    expect(body.track_record.score_state_sigma).toBeNull();
    expect(body.track_record.artifact_count).toBe(0);
    expect(body.track_record.peer_evals_received).toBe(0);
    expect(body.track_record.last_artifact_at).toBeNull();
    expect(body.track_record.axes_breakdown).toEqual([]);
  });

  it("uses backdated_joined_at over created_at when present", async () => {
    const pool = makePool(() => [
      baseAgentRow({ backdated_joined_at: "2025-09-01T00:00:00Z" }),
    ]);
    const body = await (await handleAgentManifest(VALID_UUID, pool as never)).json();
    expect(body.identity.joined_at).toBe("2025-09-01T00:00:00Z");
  });

  it("exposes all required top-level keys (schema completeness)", async () => {
    const pool = makePool(() => [baseAgentRow()]);
    const body = await (await handleAgentManifest(VALID_UUID, pool as never)).json();
    const required = [
      "agent_id",
      "manifest_version",
      "identity",
      "llm",
      "pattern",
      "memory",
      "instructions_public",
      "instructions",
      "skills",
      "tools",
      "mcp_servers",
      "handoffs",
      "guardrails",
      "runtime_caps",
      "track_record",
      "policies",
    ];
    for (const key of required) {
      expect(body).toHaveProperty(key);
    }
  });

  it("coerces numeric string columns from pg into numbers", async () => {
    const pool = makePool(() => [
      baseAgentRow({
        score_state_mu: "9.91",
        score_state_sigma: "0.12",
        artifact_count: "100",
        peer_evals_received: "42",
      }),
    ]);
    const body = await (await handleAgentManifest(VALID_UUID, pool as never)).json();
    expect(body.track_record.score_state_mu).toBeCloseTo(9.91);
    expect(body.track_record.score_state_sigma).toBeCloseTo(0.12);
    expect(body.track_record.artifact_count).toBe(100);
    expect(body.track_record.peer_evals_received).toBe(42);
  });
});
