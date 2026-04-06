import jwt from "jsonwebtoken";
import pool from "../db/pool";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}
const SECRET = JWT_SECRET || "order66-dev-secret-change-in-prod";

const API_KEY_LENGTH = 64;
const API_KEY_PREFIX_LENGTH = 8; // First 8 chars stored in plaintext for O(1) lookup

/** Generate a cryptographically random API key. */
export function generateApiKey(): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "";
  const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_LENGTH));
  for (let i = 0; i < API_KEY_LENGTH; i++) {
    key += chars[bytes[i] % chars.length];
  }
  return key;
}

/** Extract the prefix (first 8 chars) used for DB lookup */
export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH);
}

/** Hash an API key with bcrypt for secure storage. */
export async function hashApiKey(key: string): Promise<string> {
  return await Bun.password.hash(key, { algorithm: "bcrypt", cost: 10 });
}

/** Hash a password with bcrypt. */
export async function hashPassword(password: string): Promise<string> {
  return await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
}

/** Verify a password against its bcrypt hash. */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return await Bun.password.verify(password, hash);
}

/** Create a JWT token for an authenticated builder. */
export function createBuilderToken(builderId: string): string {
  return jwt.sign({ builder_id: builderId }, SECRET, { expiresIn: "7d" });
}

/** Verify and decode a builder JWT token. Returns null if invalid. */
export function verifyBuilderToken(
  token: string
): { builder_id: string } | null {
  try {
    return jwt.verify(token, SECRET) as { builder_id: string };
  } catch {
    return null;
  }
}

/**
 * Authenticate an agent by API key.
 * Uses a prefix-based lookup (O(1)) instead of scanning all agents (O(n)).
 * The prefix narrows to 1-2 candidates, then bcrypt verifies the full key.
 */
export async function authenticateAgent(
  apiKey: string
): Promise<{
  agent_id: string;
  name: string;
  role: string;
  company_id: string | null;
  builder_id: string;
} | null> {
  const prefix = apiKeyPrefix(apiKey);

  const { rows } = await pool.query(
    `SELECT id, name, role, company_id, builder_id, api_key_hash
     FROM agents
     WHERE api_key_prefix = $1 AND status != 'retired'`,
    [prefix]
  );

  for (const row of rows) {
    if (await Bun.password.verify(apiKey, row.api_key_hash)) {
      return {
        agent_id: row.id,
        name: row.name,
        role: row.role,
        company_id: row.company_id,
        builder_id: row.builder_id,
      };
    }
  }

  return null;
}
