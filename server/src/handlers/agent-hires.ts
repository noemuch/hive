import type { Pool } from "pg";
import { json } from "../http/response";
import { authenticateBuilder, loadOwnedAgent } from "../http/auth-helpers";
import {
  generateHireToken,
  hashHireToken,
  hireTokenPrefix,
} from "../auth/hire-token";
import { encryptLLMKey } from "../security/key-encryption";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 64;
const MAX_EXPIRES_IN_DAYS = 365;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function handleCreateHire(
  req: Request,
  pool: Pool,
  agentId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ error: "validation_error", message: "JSON body required" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    return json(
      { error: "validation_error", message: `name must be 1-${MAX_NAME_LENGTH} chars` },
      400
    );
  }

  const llmApiKeyPlain = typeof body.llm_api_key === "string" ? body.llm_api_key : null;
  const llmBaseUrl = typeof body.llm_base_url === "string" ? body.llm_base_url : null;
  const llmModel = typeof body.llm_model === "string" ? body.llm_model : null;

  let expiresAt: Date | null = null;
  if (body.expires_in_days !== undefined && body.expires_in_days !== null) {
    const days = Number(body.expires_in_days);
    if (!Number.isFinite(days) || days <= 0 || days > MAX_EXPIRES_IN_DAYS) {
      return json(
        { error: "validation_error", message: `expires_in_days must be 1-${MAX_EXPIRES_IN_DAYS}` },
        400
      );
    }
    expiresAt = new Date(Date.now() + days * MS_PER_DAY);
  }

  const token = generateHireToken();
  const tokenHash = await hashHireToken(token);
  const tokenPrefix = hireTokenPrefix(token);

  // AES-256-GCM at rest; decrypted per-invocation inside handleAgentRespond.
  const llmApiKeyEncrypted =
    llmApiKeyPlain !== null ? encryptLLMKey(llmApiKeyPlain) : null;

  const { rows } = await pool.query(
    `INSERT INTO agent_hires (
       agent_id, hiring_builder_id, hire_token_hash, hire_token_prefix,
       llm_api_key_encrypted, llm_base_url, llm_model, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, created_at, expires_at`,
    [agentId, auth.builderId, tokenHash, tokenPrefix, llmApiKeyEncrypted, llmBaseUrl, llmModel, expiresAt]
  );

  const row = rows[0];
  return json(
    {
      hire: {
        id: row.id,
        name,
        agent_id: agentId,
        created_at: row.created_at,
        expires_at: row.expires_at,
      },
      hire_token: token,
      warning: "Save hire_token now — cannot retrieve later.",
    },
    201
  );
}

export async function handleListHires(
  req: Request,
  pool: Pool,
  agentId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  const { rows } = await pool.query(
    `SELECT id, hire_token_prefix, llm_base_url, llm_model,
            created_at, expires_at, revoked_at, calls_count, last_called_at
     FROM agent_hires
     WHERE agent_id = $1
     ORDER BY created_at DESC`,
    [agentId]
  );

  return json({ hires: rows });
}

export async function handleRevokeHire(
  req: Request,
  pool: Pool,
  agentId: string,
  hireId: string
): Promise<Response> {
  const auth = authenticateBuilder(req);
  if (!auth.ok) return auth.response;

  const ownership = await loadOwnedAgent(pool, agentId, auth.builderId);
  if (!ownership.ok) return ownership.response;

  if (!UUID_RE.test(hireId)) {
    return json({ error: "not_found", message: "Hire not found" }, 404);
  }

  const { rows } = await pool.query(
    `UPDATE agent_hires
     SET revoked_at = now()
     WHERE id = $1 AND agent_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [hireId, agentId]
  );

  if (rows.length === 0) {
    return json({ error: "not_found", message: "Hire not found or already revoked" }, 404);
  }

  return new Response(null, {
    status: 204,
    headers: { "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*" },
  });
}
