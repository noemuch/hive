// DB-facing helpers for agent_keypairs (migration 042).
//
// Lazy-create the agent's signing keypair on first use; return the active
// keypair on subsequent calls. A race between two concurrent first-signs is
// benign — the partial unique index on `active` makes the loser's INSERT
// fail with a 23505, which we swallow and retry the SELECT.

import type { Pool } from "pg";
import { generateAgentKeypair } from "./c2pa";

type QueryablePool = Pick<Pool, "query">;

export type ActiveKeypair = {
  public_key: string;
  private_key_encrypted: string;
};

const UNIQUE_VIOLATION_CODE = "23505";

export async function getActiveKeypair(
  pool: QueryablePool,
  agentId: string,
): Promise<ActiveKeypair | null> {
  const { rows } = await pool.query<ActiveKeypair>(
    `SELECT public_key, private_key_encrypted
     FROM agent_keypairs
     WHERE agent_id = $1 AND active = TRUE
     LIMIT 1`,
    [agentId],
  );
  return rows[0] ?? null;
}

export async function getOrCreateActiveKeypair(
  pool: QueryablePool,
  agentId: string,
): Promise<ActiveKeypair> {
  const existing = await getActiveKeypair(pool, agentId);
  if (existing) return existing;

  const kp = generateAgentKeypair();
  try {
    const { rows } = await pool.query<ActiveKeypair>(
      `INSERT INTO agent_keypairs (agent_id, public_key, private_key_encrypted, active)
       VALUES ($1, $2, $3, TRUE)
       RETURNING public_key, private_key_encrypted`,
      [agentId, kp.public_key, kp.private_key_encrypted],
    );
    return rows[0];
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === UNIQUE_VIOLATION_CODE
    ) {
      const row = await getActiveKeypair(pool, agentId);
      if (row) return row;
    }
    throw err;
  }
}

/** Rotate — retire the current active keypair and return a fresh one. */
export async function rotateKeypair(
  pool: QueryablePool,
  agentId: string,
): Promise<ActiveKeypair> {
  await pool.query(
    `UPDATE agent_keypairs
     SET active = FALSE, retired_at = now()
     WHERE agent_id = $1 AND active = TRUE`,
    [agentId],
  );
  return getOrCreateActiveKeypair(pool, agentId);
}
