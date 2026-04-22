/* @hive-protocol */
// server/src/protocol/rfc-manifest.ts
//
// Canonical RFC manifest hashing (NORTHSTAR §5.3).
//
// Produces a runtime-stable SHA-256 over an RFC manifest object using RFC 8785
// (JSON Canonicalization Scheme). The manifest is defined in §5.3 and includes:
//   { issue_number, issue_body_nfc, issue_updated_at, linked_pr_head_sha,
//     vote_opens_at, vote_closes_at, threshold_phase, entrenchment,
//     excluded_scope_check }
//
// Determinism is verified by `rfc-sha-determinism.test.ts` via fast-check; a
// cross-runtime test re-executes the hasher under `node` via child_process when
// available (skipped when node is absent — documented in the test).

import { createHash } from "node:crypto";

// Minimal RFC 8785 implementation — sufficient for JSON values we emit:
// objects, arrays, strings, numbers, booleans, null. Does NOT support NaN/±Infinity
// (JSON has none) nor binary data.
export function jcsStringify(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`jcsStringify: non-finite number ${value}`);
    }
    return serializeNumber(value);
  }
  if (typeof value === "string") return serializeString(value);
  if (Array.isArray(value)) {
    return "[" + value.map(jcsStringify).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => {
      // RFC 8785: sort by UTF-16 code units.
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(serializeString(k) + ":" + jcsStringify(v));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new TypeError(`jcsStringify: unsupported type ${typeof value}`);
}

function serializeNumber(n: number): string {
  if (n === 0) return "0"; // JCS §3.2.2.3
  // ECMA-262 toString() on finite numbers gives the shortest round-trip form,
  // which matches RFC 8785 §3.2.2.3 for the vast majority of values. Edge cases
  // (1e21 boundary) are not used in our manifests.
  return String(n);
}

function serializeString(s: string): string {
  // JSON escape. JCS mandates \u escapes only for control chars + \" and \\.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    if (ch === 0x22) out += '\\"';
    else if (ch === 0x5c) out += "\\\\";
    else if (ch === 0x08) out += "\\b";
    else if (ch === 0x09) out += "\\t";
    else if (ch === 0x0a) out += "\\n";
    else if (ch === 0x0c) out += "\\f";
    else if (ch === 0x0d) out += "\\r";
    else if (ch < 0x20) out += "\\u" + ch.toString(16).padStart(4, "0");
    else out += s[i];
  }
  out += '"';
  return out;
}

export function rfcManifestSha256(manifest: unknown): string {
  const canonical = jcsStringify(manifest);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
