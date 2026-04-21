// server/src/engine/rubric-variants.ts
//
// Typed, cached accessor for the `rubric_variants` registry introduced in
// migration 038 (issue #219 / HEAR Family A3). The table is essentially
// static — 6 rows — so we cache for 60 s and fall back to `chat-collab`
// defensively if a lookup misses (e.g. a variant was deleted in-flight).
//
// Used by server/src/engine/peer-evaluation.ts to build variant-aware
// prompts and by scripts/hear/judge.ts to tag evaluations with the correct
// variant.

import pool from "../db/pool";

export type RubricVariant = {
  variant_id: string;
  agent_type: string;
  invariant_axes: string[];
  variant_axes: string[];
  weights: Record<string, number>;
  prompt_template: string;
  version: number;
};

const CACHE_TTL_MS = 60_000;
const DEFAULT_VARIANT_ID = "chat-collab";

type CacheEntry = { value: RubricVariant; expires_at: number };
const cache = new Map<string, CacheEntry>();

type Queryable = {
  query: <R = unknown>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rowCount: number | null; rows: R[] }>;
};

type Row = {
  variant_id: string;
  agent_type: string;
  invariant_axes: string[];
  variant_axes: string[];
  weights: Record<string, number> | string;
  prompt_template: string;
  version: number;
};

function toRubricVariant(row: Row): RubricVariant {
  const weights =
    typeof row.weights === "string"
      ? (JSON.parse(row.weights) as Record<string, number>)
      : row.weights;
  return {
    variant_id: row.variant_id,
    agent_type: row.agent_type,
    invariant_axes: row.invariant_axes,
    variant_axes: row.variant_axes,
    weights,
    prompt_template: row.prompt_template,
    version: row.version,
  };
}

export async function getRubricVariant(
  variantId: string,
  db: Queryable = pool,
): Promise<RubricVariant> {
  const now = Date.now();
  const hit = cache.get(variantId);
  if (hit && hit.expires_at > now) return hit.value;

  const { rows } = await db.query<Row>(
    `SELECT variant_id, agent_type, invariant_axes, variant_axes,
            weights, prompt_template, version
     FROM rubric_variants WHERE variant_id = $1`,
    [variantId],
  );

  if (rows[0]) {
    const value = toRubricVariant(rows[0]);
    cache.set(variantId, { value, expires_at: now + CACHE_TTL_MS });
    return value;
  }

  // Fallback: a malformed FK or race with a delete should not break grading.
  // Log once, serve chat-collab.
  console.warn(
    `[rubric-variants] variant "${variantId}" not found, falling back to "${DEFAULT_VARIANT_ID}"`,
  );
  if (variantId !== DEFAULT_VARIANT_ID) {
    return getRubricVariant(DEFAULT_VARIANT_ID, db);
  }
  throw new Error(
    `default variant "${DEFAULT_VARIANT_ID}" missing from rubric_variants`,
  );
}

export function allAxesFor(variant: RubricVariant): string[] {
  return [...variant.invariant_axes, ...variant.variant_axes];
}

// Test-only — flush the cache between tests to avoid cross-test leakage.
export function __clearRubricVariantsCacheForTests(): void {
  cache.clear();
}
