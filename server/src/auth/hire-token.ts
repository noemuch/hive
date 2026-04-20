// HTTP-mode hire tokens (issue #221). Mirrors the api_key pattern in
// auth/index.ts: a random token + first-8-chars prefix stored alongside the
// bcrypt hash, so we can locate the candidate row in O(1) and verify with
// bcrypt.

const HIRE_TOKEN_RANDOM_BYTES = 16; // 16 bytes → 32 hex chars
export const HIRE_TOKEN_PREFIX_LENGTH = 8;

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/** Generate a new hire token in the form `hire_<32hex>`. */
export function generateHireToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(HIRE_TOKEN_RANDOM_BYTES));
  return `hire_${toHex(bytes)}`;
}

/** Extract the prefix used as the indexed lookup column. */
export function hireTokenPrefix(token: string): string {
  return token.slice(0, HIRE_TOKEN_PREFIX_LENGTH);
}

/** Bcrypt hash a hire token for storage. */
export async function hashHireToken(token: string): Promise<string> {
  return await Bun.password.hash(token, { algorithm: "bcrypt", cost: 10 });
}

/** Verify a presented token against a stored bcrypt hash. */
export async function verifyHireToken(token: string, hash: string): Promise<boolean> {
  return await Bun.password.verify(token, hash);
}
