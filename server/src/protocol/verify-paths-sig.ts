/* @hive-protocol: verify-paths-sig */
/**
 * Reference implementation for PROTOCOL_PATHS.sig verification.
 *
 * Spec: docs/kb/PROTOCOL_PATHS_SCHEMA.md (Appendix H).
 *
 * Runtime: Bun-native. Uses node:fs/promises + node:path + node:child_process
 * (available in Bun via its Node-compat layer). No Node-only ESM-vs-CJS
 * assumptions; no Deno-specific globals.
 *
 * This file is the canonical reference for the verification procedure
 * described in PROTOCOL_PATHS_SCHEMA.md §"Verification procedure" and is
 * used by `meta-guard.yml` on every PR. It is intentionally self-contained
 * (no cross-module DB imports) so it can also run in CI with a minimal
 * Bun install.
 *
 * The pragma at the top of this file (`@hive-protocol: verify-paths-sig`)
 * marks it as protocol-relevant; the pragma is rename-proof via
 * PROTOCOL_PATHS.sig#pragma_roles.
 */

import { readFile } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";
import { exec as execCb, type ExecException } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

const exec = promisify(execCb);

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface LifecycleAllowEntry {
  hook: "preinstall" | "install" | "postinstall" | "prepare";
  command: string;
}

export interface RequiredStatusCheck {
  workflow_path: string;
  job_id: string;
}

export interface StewardSignature {
  steward: "noemuch" | "steward-2" | "steward-3";
  gpg_fingerprint: string;
  signature: string;
}

/**
 * Payload = PathsSig minus `signatures`. This is what gets canonicalized and
 * signed by each Steward. Kept as a dedicated type so callers can't
 * accidentally canonicalize the full signed document.
 */
export interface PathsSigPayload {
  version: string;
  issued_at: string;
  expires_at: string;
  protocol_version_predecessor_sig_sha256?: string;
  anchor_files: Record<string, string>;
  pragma_roles: string[];
  actions_secrets: string[];
  lifecycle_allowlist: LifecycleAllowEntry[];
  reproducible_build_hash: string;
  canary_test_sha256: string;
  app_permissions_sha256: string;
  mirrors_sha256: string;
  required_status_checks?: RequiredStatusCheck[];
}

export interface PathsSig extends PathsSigPayload {
  signatures: StewardSignature[];
}

export interface ShaMismatch {
  path: string;
  expected: string;
  actual: string | null; // null when file missing
  reason: "mismatch" | "missing";
}

export interface SignatureVerifyResult {
  steward: StewardSignature["steward"];
  gpg_fingerprint: string;
  ok: boolean;
  reason?: string;
}

export interface VerifyResult {
  ok: boolean;
  per_signature: SignatureVerifyResult[];
  /** If GPG is unavailable on the host, `ok=false` and `gpg_available=false`. */
  gpg_available: boolean;
}

export type FailureReason =
  | "schema_invalid"
  | "expired"
  | "signature_count"
  | "signature_invalid"
  | "gpg_unavailable"
  | "anchor_mismatch";

export interface FullVerifyResult {
  ok: boolean;
  failures: FailureReason[];
  sha_mismatches: ShaMismatch[];
  signature_result?: VerifyResult;
  schema_errors: string[];
  expired: boolean;
}

// -----------------------------------------------------------------------------
// Schema validation (lightweight — does NOT pull json-schema validator)
// -----------------------------------------------------------------------------

const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[a-z0-9-]+)?$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const FP_RE = /^[A-F0-9]{40}$/;
const ROLE_RE = /^[a-z][a-z0-9-]*$/;
const SECRET_REF_RE = /^(secrets|vars)\.[A-Z][A-Z0-9_]*$/;
const WORKFLOW_PATH_RE = /^\.github\/workflows\/.+\.ya?ml$/;
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const VALID_STEWARDS = new Set(["noemuch", "steward-2", "steward-3"]);
const VALID_HOOKS = new Set(["preinstall", "install", "postinstall", "prepare"]);

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/**
 * Validate an unknown value against the PROTOCOL_PATHS.sig JSON schema.
 * Returns the list of human-readable errors (empty = valid).
 * We hand-roll validation to keep the protocol dependency graph minimal
 * (no ajv / json-schema-validator — supply-chain surface reduction).
 */
export function validateSchema(input: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return ["root: not an object"];
  }
  const requiredTop = [
    "version",
    "issued_at",
    "expires_at",
    "anchor_files",
    "pragma_roles",
    "actions_secrets",
    "lifecycle_allowlist",
    "reproducible_build_hash",
    "canary_test_sha256",
    "app_permissions_sha256",
    "mirrors_sha256",
    "signatures",
  ] as const;
  for (const key of requiredTop) {
    if (!(key in input)) errors.push(`missing required field: ${key}`);
  }

  if (typeof input.version === "string" && !VERSION_RE.test(input.version)) {
    errors.push(`version: does not match semver pattern`);
  } else if ("version" in input && typeof input.version !== "string") {
    errors.push(`version: not a string`);
  }

  for (const dtField of ["issued_at", "expires_at"] as const) {
    if (dtField in input) {
      const v = input[dtField];
      if (typeof v !== "string" || !ISO_DATETIME_RE.test(v)) {
        errors.push(`${dtField}: not an ISO 8601 date-time string`);
      }
    }
  }

  if ("protocol_version_predecessor_sig_sha256" in input) {
    const v = input.protocol_version_predecessor_sig_sha256;
    if (v !== null && v !== undefined) {
      if (typeof v !== "string" || !SHA256_RE.test(v)) {
        errors.push(`protocol_version_predecessor_sig_sha256: not 64-hex-char SHA-256`);
      }
    }
  }

  if ("anchor_files" in input) {
    if (!isPlainObject(input.anchor_files)) {
      errors.push("anchor_files: not an object");
    } else {
      for (const [path, sha] of Object.entries(input.anchor_files)) {
        if (typeof path !== "string" || path.length === 0) {
          errors.push(`anchor_files: empty key`);
        }
        if (typeof sha !== "string" || !SHA256_RE.test(sha)) {
          errors.push(`anchor_files[${path}]: not 64-hex-char SHA-256`);
        }
      }
    }
  }

  for (const [field, re] of [
    ["pragma_roles", ROLE_RE] as const,
    ["actions_secrets", SECRET_REF_RE] as const,
  ]) {
    if (field in input) {
      const v = (input as Record<string, unknown>)[field];
      if (!Array.isArray(v)) {
        errors.push(`${field}: not an array`);
      } else {
        const seen = new Set<string>();
        for (const item of v) {
          if (typeof item !== "string" || !re.test(item)) {
            errors.push(`${field}: item does not match pattern`);
          } else if (seen.has(item)) {
            errors.push(`${field}: duplicate ${item}`);
          } else {
            seen.add(item);
          }
        }
      }
    }
  }

  if ("lifecycle_allowlist" in input) {
    const v = input.lifecycle_allowlist;
    if (!Array.isArray(v)) {
      errors.push("lifecycle_allowlist: not an array");
    } else {
      for (const entry of v) {
        if (!isPlainObject(entry)) {
          errors.push("lifecycle_allowlist: entry not object");
          continue;
        }
        if (typeof entry.hook !== "string" || !VALID_HOOKS.has(entry.hook)) {
          errors.push("lifecycle_allowlist: hook invalid");
        }
        if (typeof entry.command !== "string") {
          errors.push("lifecycle_allowlist: command not a string");
        }
      }
    }
  }

  for (const shaField of [
    "reproducible_build_hash",
    "canary_test_sha256",
    "app_permissions_sha256",
    "mirrors_sha256",
  ] as const) {
    if (shaField in input) {
      const v = (input as Record<string, unknown>)[shaField];
      if (typeof v !== "string" || !SHA256_RE.test(v)) {
        errors.push(`${shaField}: not 64-hex-char SHA-256`);
      }
    }
  }

  if ("required_status_checks" in input) {
    const v = input.required_status_checks;
    if (v !== undefined) {
      if (!Array.isArray(v)) {
        errors.push("required_status_checks: not an array");
      } else {
        for (const entry of v) {
          if (!isPlainObject(entry)) {
            errors.push("required_status_checks: entry not object");
            continue;
          }
          if (typeof entry.workflow_path !== "string" || !WORKFLOW_PATH_RE.test(entry.workflow_path)) {
            errors.push("required_status_checks: workflow_path invalid");
          }
          if (typeof entry.job_id !== "string" || entry.job_id.length === 0) {
            errors.push("required_status_checks: job_id invalid");
          }
        }
      }
    }
  }

  if ("signatures" in input) {
    const v = input.signatures;
    if (!Array.isArray(v)) {
      errors.push("signatures: not an array");
    } else if (v.length < 3) {
      errors.push(`signatures: expected at least 3, got ${v.length}`);
    } else {
      for (const sig of v) {
        if (!isPlainObject(sig)) {
          errors.push("signatures: entry not object");
          continue;
        }
        if (typeof sig.steward !== "string" || !VALID_STEWARDS.has(sig.steward)) {
          errors.push(`signatures: steward invalid (${String(sig.steward)})`);
        }
        if (typeof sig.gpg_fingerprint !== "string" || !FP_RE.test(sig.gpg_fingerprint)) {
          errors.push("signatures: gpg_fingerprint not 40 uppercase hex chars");
        }
        if (typeof sig.signature !== "string" || sig.signature.length === 0) {
          errors.push("signatures: signature empty");
        }
      }
    }
  }

  return errors;
}

// -----------------------------------------------------------------------------
// RFC 8785 JSON Canonicalization Scheme (JCS)
// -----------------------------------------------------------------------------

/**
 * Canonicalize a PathsSigPayload per RFC 8785 (JCS).
 *
 * RFC 8785 compliance notes:
 *  - Object keys sorted lexicographically by UTF-16 code unit (matches
 *    JavaScript's default `.sort()` on strings — which is what JCS requires).
 *  - No insignificant whitespace.
 *  - Strings use canonical JSON escape form (JSON.stringify of a string is
 *    already compliant: \uXXXX for control chars, \" for quote, \\ for
 *    backslash, shortest form for 0x00-0x1F).
 *  - Numbers are serialized per ECMAScript Number#toString, which matches
 *    the RFC 8785 Number canonicalization algorithm (shortest round-trip).
 *  - `null` serialized as `null`. `undefined` fields are dropped (same as
 *    JSON.stringify default behavior).
 *
 * This function must NOT be used with `signatures` present — pass a
 * PathsSigPayload (no signatures), not a PathsSig.
 */
export function canonicalize(obj: PathsSigPayload): string {
  return jcsSerialize(obj);
}

function jcsSerialize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) {
    // Top-level undefined would produce invalid JSON. Caller shouldn't hit this
    // via a typed PathsSigPayload, but be explicit.
    throw new Error("canonicalize: undefined is not a valid JSON value");
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonicalize: non-finite number");
    }
    // ECMAScript Number#toString matches RFC 8785 for finite numbers.
    return String(value);
  }
  if (typeof value === "string") {
    // JSON.stringify of a string returns a valid JCS-encoded string
    // (uses shortest escapes, \uXXXX for control chars).
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      parts.push(jcsSerialize(item));
    }
    return "[" + parts.join(",") + "]";
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort(); // default sort: UTF-16 code unit order, per JCS.
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ":" + jcsSerialize((value as Record<string, unknown>)[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error(`canonicalize: unsupported value type ${typeof value}`);
}

/**
 * Strip `signatures` from a signed document to obtain the canonicalizable
 * payload. Used by both producers (signing) and verifiers.
 */
export function payloadOf(sig: PathsSig): PathsSigPayload {
  const { signatures: _signatures, ...payload } = sig;
  return payload;
}

/**
 * Compute SHA-256 of the canonical payload bytes. This is the value each
 * Steward signs (detach-signed with their GPG key).
 */
export function payloadHashHex(sig: PathsSig | PathsSigPayload): string {
  const payload: PathsSigPayload = "signatures" in sig ? payloadOf(sig as PathsSig) : (sig as PathsSigPayload);
  const canonical = canonicalize(payload);
  const bytes = new TextEncoder().encode(canonical);
  return bytesToHex(sha256(bytes));
}

// -----------------------------------------------------------------------------
// I/O
// -----------------------------------------------------------------------------

/**
 * Load and parse PROTOCOL_PATHS.sig. Validates the schema before returning.
 * Throws on schema violation (callers get early failure vs. confusing downstream errors).
 */
export async function loadPathsSig(path: string): Promise<PathsSig> {
  const absolute = pathResolve(path);
  const raw = await readFile(absolute, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`loadPathsSig: JSON parse failed for ${absolute}: ${(err as Error).message}`);
  }
  const schemaErrors = validateSchema(parsed);
  if (schemaErrors.length > 0) {
    throw new Error(
      `loadPathsSig: schema validation failed:\n  - ${schemaErrors.join("\n  - ")}`,
    );
  }
  return parsed as PathsSig;
}

// -----------------------------------------------------------------------------
// Expiry check
// -----------------------------------------------------------------------------

export function verifyExpiry(sig: PathsSig, now: Date = new Date()): boolean {
  const expires = Date.parse(sig.expires_at);
  if (Number.isNaN(expires)) return false;
  return expires > now.getTime();
}

// -----------------------------------------------------------------------------
// Anchor-file SHA verification
// -----------------------------------------------------------------------------

async function sha256FileHex(absolutePath: string): Promise<string | null> {
  try {
    const buf = await readFile(absolutePath);
    return bytesToHex(sha256(new Uint8Array(buf)));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EISDIR") return null;
    throw err;
  }
}

export async function verifyAnchorShas(
  sig: PathsSig,
  repoRoot: string,
): Promise<ShaMismatch[]> {
  const root = pathResolve(repoRoot);
  const mismatches: ShaMismatch[] = [];
  for (const [rel, expected] of Object.entries(sig.anchor_files)) {
    const abs = pathResolve(root, rel);
    const actual = await sha256FileHex(abs);
    if (actual === null) {
      mismatches.push({ path: rel, expected, actual: null, reason: "missing" });
    } else if (actual !== expected) {
      mismatches.push({ path: rel, expected, actual, reason: "mismatch" });
    }
  }
  return mismatches;
}

// -----------------------------------------------------------------------------
// GPG signature verification
// -----------------------------------------------------------------------------

async function isGpgAvailable(): Promise<boolean> {
  try {
    await exec("gpg --version", { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Verify all Steward signatures over the canonical payload bytes.
 *
 * `stewardKeys` maps steward name -> ASCII-armored public key block.
 * Each signature is treated as an ASCII-armored detached signature over
 * the canonical payload bytes (NOT over the SHA-256 — GPG computes its own
 * digest; we sign the full message).
 *
 * Implementation detail: gpg has no stable programmatic API; we shell out to
 * `gpg --verify` against a temporary ephemeral keyring per-signature.
 */
export async function verifySignatures(
  sig: PathsSig,
  stewardKeys: Map<string, string>,
): Promise<VerifyResult> {
  const gpgOk = await isGpgAvailable();
  if (!gpgOk) {
    return {
      ok: false,
      gpg_available: false,
      per_signature: sig.signatures.map((s) => ({
        steward: s.steward,
        gpg_fingerprint: s.gpg_fingerprint,
        ok: false,
        reason: "gpg binary not found on PATH",
      })),
    };
  }

  const payload = payloadOf(sig);
  const canonical = canonicalize(payload);
  const payloadBytes = new TextEncoder().encode(canonical);

  const per: SignatureVerifyResult[] = [];
  for (const s of sig.signatures) {
    const pubkey = stewardKeys.get(s.steward);
    if (!pubkey) {
      per.push({
        steward: s.steward,
        gpg_fingerprint: s.gpg_fingerprint,
        ok: false,
        reason: `no public key registered for steward=${s.steward}`,
      });
      continue;
    }
    const result = await verifyOne(s, payloadBytes, pubkey);
    per.push(result);
  }
  const ok = per.every((r) => r.ok);
  return { ok, gpg_available: true, per_signature: per };
}

async function verifyOne(
  s: StewardSignature,
  payloadBytes: Uint8Array,
  asciiArmoredPubkey: string,
): Promise<SignatureVerifyResult> {
  let dir: string | null = null;
  try {
    dir = await mkdtemp(pathJoin(tmpdir(), "hive-sig-verify-"));
    const keyringDir = pathJoin(dir, "gnupg");
    await exec(`mkdir -p ${JSON.stringify(keyringDir)} && chmod 700 ${JSON.stringify(keyringDir)}`);

    const pubkeyPath = pathJoin(dir, "pubkey.asc");
    const payloadPath = pathJoin(dir, "payload.bin");
    const sigPath = pathJoin(dir, "payload.sig");

    await writeFile(pubkeyPath, asciiArmoredPubkey, "utf8");
    await writeFile(payloadPath, payloadBytes);
    await writeFile(sigPath, s.signature, "utf8");

    const env = {
      ...process.env,
      GNUPGHOME: keyringDir,
    };

    // Import pubkey.
    await exec(`gpg --batch --import ${JSON.stringify(pubkeyPath)}`, {
      env,
      timeout: 10_000,
    });

    // Verify: detached sig against payload. `--status-fd 1` would give a
    // machine-readable line but `gpg --verify` exit code is sufficient
    // (0 = good sig, non-zero = anything else).
    await exec(
      `gpg --batch --verify ${JSON.stringify(sigPath)} ${JSON.stringify(payloadPath)}`,
      { env, timeout: 10_000 },
    );

    return {
      steward: s.steward,
      gpg_fingerprint: s.gpg_fingerprint,
      ok: true,
    };
  } catch (err) {
    const stderr = (err as ExecException & { stderr?: string }).stderr ?? "";
    return {
      steward: s.steward,
      gpg_fingerprint: s.gpg_fingerprint,
      ok: false,
      reason: `gpg verify failed: ${stderr.slice(0, 400) || (err as Error).message}`,
    };
  } finally {
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

// -----------------------------------------------------------------------------
// Orchestration
// -----------------------------------------------------------------------------

export async function verifyAll(
  sig: PathsSig,
  repoRoot: string,
  stewardKeys: Map<string, string>,
  now: Date = new Date(),
): Promise<FullVerifyResult> {
  const failures: FailureReason[] = [];
  const schema_errors = validateSchema(sig);
  if (schema_errors.length > 0) {
    failures.push("schema_invalid");
  }

  const expired = !verifyExpiry(sig, now);
  if (expired) failures.push("expired");

  if (!Array.isArray(sig.signatures) || sig.signatures.length < 3) {
    failures.push("signature_count");
  }

  let signature_result: VerifyResult | undefined;
  if (!failures.includes("signature_count") && !failures.includes("schema_invalid")) {
    signature_result = await verifySignatures(sig, stewardKeys);
    if (!signature_result.gpg_available) {
      failures.push("gpg_unavailable");
    } else if (!signature_result.ok) {
      failures.push("signature_invalid");
    }
  }

  let sha_mismatches: ShaMismatch[] = [];
  if (!failures.includes("schema_invalid")) {
    sha_mismatches = await verifyAnchorShas(sig, repoRoot);
    if (sha_mismatches.length > 0) failures.push("anchor_mismatch");
  }

  return {
    ok: failures.length === 0,
    failures,
    sha_mismatches,
    signature_result,
    schema_errors,
    expired,
  };
}
