import { describe, it, expect, beforeEach } from "bun:test";
import {
  getRubricVariant,
  allAxesFor,
  __clearRubricVariantsCacheForTests,
} from "../rubric-variants";

type Row = {
  variant_id: string;
  agent_type: string;
  invariant_axes: string[];
  variant_axes: string[];
  weights: Record<string, number>;
  prompt_template: string;
  version: number;
};

function fixture(variant_id: string, overrides: Partial<Row> = {}): Row {
  return {
    variant_id,
    agent_type: "chat",
    invariant_axes: ["task_fulfillment", "calibration", "cost_efficiency"],
    variant_axes: ["communication_clarity", "initiative_quality", "collaborative_intelligence", "contextual_judgment"],
    weights: { task_fulfillment: 0.25 },
    prompt_template: "prompt",
    version: 1,
    ...overrides,
  };
}

function makeDb(rowsByVariant: Map<string, Row>) {
  let callCount = 0;
  return {
    query: async <R = unknown>(_sql: string, params?: unknown[]) => {
      callCount++;
      const id = (params?.[0] as string) ?? "";
      const row = rowsByVariant.get(id);
      return { rowCount: row ? 1 : 0, rows: row ? [row as unknown as R] : [] };
    },
    get callCount() {
      return callCount;
    },
  };
}

describe("rubric-variants loader", () => {
  beforeEach(() => {
    __clearRubricVariantsCacheForTests();
  });

  it("returns the seeded row for chat-collab", async () => {
    const rows = new Map([["chat-collab", fixture("chat-collab")]]);
    const db = makeDb(rows);
    const variant = await getRubricVariant("chat-collab", db);
    expect(variant.variant_id).toBe("chat-collab");
    expect(variant.invariant_axes.length).toBe(3);
    expect(variant.variant_axes.length).toBe(4);
  });

  it("falls back to chat-collab when the requested variant is missing", async () => {
    const rows = new Map([["chat-collab", fixture("chat-collab")]]);
    const db = makeDb(rows);
    const variant = await getRubricVariant("nonexistent-variant", db);
    expect(variant.variant_id).toBe("chat-collab");
  });

  it("caches lookups within the TTL", async () => {
    const rows = new Map([["code", fixture("code", {
      variant_axes: ["correctness", "idiomatic_style", "security_posture", "maintainability"],
    })]]);
    const db = makeDb(rows);
    await getRubricVariant("code", db);
    await getRubricVariant("code", db);
    await getRubricVariant("code", db);
    // First call hits DB; subsequent calls served from cache.
    expect(db.callCount).toBe(1);
  });

  it("parses JSONB weights from string", async () => {
    const row = fixture("code");
    // Simulate raw jsonb that pg sometimes returns as a string.
    (row as unknown as { weights: string }).weights = JSON.stringify({ correctness: 0.3 });
    const rows = new Map([["code", row]]);
    const db = makeDb(rows);
    const variant = await getRubricVariant("code", db);
    expect(variant.weights.correctness).toBe(0.3);
  });

  it("allAxesFor concatenates invariants + variant axes", async () => {
    const rows = new Map([["code", fixture("code", {
      variant_axes: ["correctness", "idiomatic_style", "security_posture", "maintainability"],
    })]]);
    const db = makeDb(rows);
    const variant = await getRubricVariant("code", db);
    const axes = allAxesFor(variant);
    expect(axes.length).toBe(7);
    expect(axes).toContain("task_fulfillment");
    expect(axes).toContain("correctness");
  });
});
