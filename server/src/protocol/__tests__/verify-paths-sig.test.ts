/* @hive-protocol-test: verify-paths-sig */
/**
 * Property-based tests for PROTOCOL_PATHS.sig verification.
 *
 * Spec: docs/kb/PROTOCOL_PATHS_SCHEMA.md (Appendix H).
 *
 * Runs under `bun test`. Uses `fast-check` for property-based testing.
 * We do NOT exercise the real GPG path here — shelling out is integration
 * territory — instead we test schema, canonicalization, anchor-sha, and
 * expiry paths, which is where protocol-layer bugs most often hide.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fc from "fast-check";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin, dirname } from "node:path";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@noble/hashes/utils";

import {
  canonicalize,
  loadPathsSig,
  payloadHashHex,
  payloadOf,
  validateSchema,
  verifyAll,
  verifyAnchorShas,
  verifyExpiry,
  type PathsSig,
  type PathsSigPayload,
} from "../verify-paths-sig";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const SHA_ZEROS = "0".repeat(64);
const SHA_ONES = "a".repeat(64);

function validPayload(): PathsSigPayload {
  return {
    version: "1.0.0",
    issued_at: "2026-04-22T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
    anchor_files: {
      "docs/kb/NORTHSTAR.md": SHA_ZEROS,
      "docs/kb/APP_PERMISSIONS.json": SHA_ONES,
    },
    pragma_roles: ["verify-paths-sig", "meta-guard"],
    actions_secrets: ["secrets.NOEMUCH_PAT", "vars.AUTOMATION_LOG_ISSUE"],
    lifecycle_allowlist: [],
    reproducible_build_hash: SHA_ZEROS,
    canary_test_sha256: SHA_ZEROS,
    app_permissions_sha256: SHA_ONES,
    mirrors_sha256: SHA_ZEROS,
  };
}

function validSig(): PathsSig {
  return {
    ...validPayload(),
    signatures: [
      {
        steward: "noemuch",
        gpg_fingerprint: "A".repeat(40),
        signature: "-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n",
      },
      {
        steward: "steward-2",
        gpg_fingerprint: "B".repeat(40),
        signature: "-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n",
      },
      {
        steward: "steward-3",
        gpg_fingerprint: "C".repeat(40),
        signature: "-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP SIGNATURE-----\n",
      },
    ],
  };
}

// -----------------------------------------------------------------------------
// Schema validation — example-based
// -----------------------------------------------------------------------------

describe("validateSchema", () => {
  test("accepts a well-formed .sig", () => {
    expect(validateSchema(validSig())).toEqual([]);
  });

  test("rejects non-object input", () => {
    expect(validateSchema(null).length).toBeGreaterThan(0);
    expect(validateSchema("not-an-object").length).toBeGreaterThan(0);
    expect(validateSchema([]).length).toBeGreaterThan(0);
  });

  test("rejects missing required fields", () => {
    const s = validSig();
    // @ts-expect-error — testing runtime schema rejection
    delete s.version;
    const errors = validateSchema(s);
    expect(errors.some((e) => e.includes("version"))).toBe(true);
  });

  test("rejects malformed version string", () => {
    const s = validSig();
    s.version = "not-semver";
    expect(validateSchema(s).some((e) => e.includes("version"))).toBe(true);
  });

  test("rejects bad SHA-256 length", () => {
    const s = validSig();
    s.reproducible_build_hash = "abc";
    expect(validateSchema(s).some((e) => e.includes("reproducible_build_hash"))).toBe(true);
  });

  test("rejects fewer than 3 signatures", () => {
    const s = validSig();
    s.signatures = s.signatures.slice(0, 2);
    expect(validateSchema(s).some((e) => e.includes("signatures"))).toBe(true);
  });

  test("rejects invalid steward name", () => {
    const s = validSig();
    // @ts-expect-error
    s.signatures[0].steward = "steward-999";
    expect(validateSchema(s).some((e) => e.includes("steward"))).toBe(true);
  });

  test("rejects invalid fingerprint format", () => {
    const s = validSig();
    s.signatures[0].gpg_fingerprint = "not-hex";
    expect(validateSchema(s).some((e) => e.includes("gpg_fingerprint"))).toBe(true);
  });

  test("rejects reserved prototype-pollution keys in anchor_files", () => {
    for (const badKey of ["__proto__", "constructor", "prototype"]) {
      const s = validSig();
      // @ts-expect-error — deliberately injecting a reserved key to test runtime guard
      s.anchor_files = { [badKey]: SHA_ZEROS };
      const errors = validateSchema(s);
      expect(errors.some((e) => e.includes(badKey))).toBe(true);
    }
  });
});

// -----------------------------------------------------------------------------
// Canonicalization — example-based sanity
// -----------------------------------------------------------------------------

describe("canonicalize", () => {
  test("produces no whitespace", () => {
    const out = canonicalize(validPayload());
    expect(out.includes(" ")).toBe(false);
    expect(out.includes("\n")).toBe(false);
    expect(out.includes("\t")).toBe(false);
  });

  test("escapes control characters per RFC 8785", () => {
    const payload = validPayload();
    payload.anchor_files = { "withctrl": SHA_ZEROS };
    const out = canonicalize(payload);
    expect(out.includes("\\u0001")).toBe(true);
  });

  test("produces sorted keys at top level", () => {
    const out = canonicalize(validPayload());
    // First key alphabetically by UTF-16 code unit in our payload is
    // `actions_secrets` ("actions" < "anchor" at position 1: 'c' < 'h').
    expect(out.startsWith('{"actions_secrets":')).toBe(true);
    // And `anchor_files` comes second.
    const idxActions = out.indexOf('"actions_secrets"');
    const idxAnchor = out.indexOf('"anchor_files"');
    expect(idxActions).toBeLessThan(idxAnchor);
  });

  test("distinct inputs produce distinct hashes", () => {
    const a = validSig();
    const b = validSig();
    b.version = "1.0.1";
    expect(payloadHashHex(a)).not.toEqual(payloadHashHex(b));
  });

  test("signatures field ignored by payloadHashHex", () => {
    const a = validSig();
    const b = validSig();
    b.signatures[0].signature = "tampered";
    expect(payloadHashHex(a)).toEqual(payloadHashHex(b));
  });
});

// -----------------------------------------------------------------------------
// PROPERTY TESTS (fast-check) — required minimum 6
// -----------------------------------------------------------------------------

/** Generator: valid SHA-256 hex string. */
const shaArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((bytes) => bytesToHex(bytes));

/** Generator: valid semver. */
const versionArb = fc
  .tuple(
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
    fc.integer({ min: 0, max: 99 }),
  )
  .map(([a, b, c]) => `${a}.${b}.${c}`);

/** Generator: plausible ISO 8601 timestamp, always in the future of `now`. */
function futureIsoArb(now: Date) {
  return fc
    .integer({ min: 1, max: 10 * 365 })
    .map((days) => new Date(now.getTime() + days * 86_400_000).toISOString());
}

function pastIsoArb(now: Date) {
  return fc
    .integer({ min: 1, max: 10 * 365 })
    .map((days) => new Date(now.getTime() - days * 86_400_000).toISOString());
}

/** Generator: valid PathsSigPayload. */
function payloadArb(): fc.Arbitrary<PathsSigPayload> {
  const now = new Date("2026-04-22T00:00:00Z");
  return fc
    .record({
      version: versionArb,
      issued_at: fc.constant("2026-04-22T00:00:00Z"),
      expires_at: futureIsoArb(now),
      anchor_files: fc.dictionary(
        fc.stringMatching(/^[a-z0-9/_.-]{1,60}$/).filter(
          (k) => k !== "__proto__" && k !== "constructor" && k !== "prototype",
        ),
        shaArb,
        { minKeys: 1, maxKeys: 5 },
      ),
      pragma_roles: fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,20}$/), {
        minLength: 1,
        maxLength: 5,
      }),
      actions_secrets: fc.uniqueArray(
        fc.stringMatching(/^(secrets|vars)\.[A-Z][A-Z0-9_]{0,20}$/),
        { minLength: 0, maxLength: 4 },
      ),
      lifecycle_allowlist: fc.constant([]),
      reproducible_build_hash: shaArb,
      canary_test_sha256: shaArb,
      app_permissions_sha256: shaArb,
      mirrors_sha256: shaArb,
    })
    .filter((p) => {
      // Drop payloads whose anchor_files keys violated the custom pattern
      // constraint (defense in depth).
      return Object.keys(p.anchor_files).every((k) => k.length > 0);
    });
}

function sigArb(): fc.Arbitrary<PathsSig> {
  return payloadArb().map((payload) => ({
    ...payload,
    signatures: [
      { steward: "noemuch" as const, gpg_fingerprint: "A".repeat(40), signature: "sig-a" },
      { steward: "steward-2" as const, gpg_fingerprint: "B".repeat(40), signature: "sig-b" },
      { steward: "steward-3" as const, gpg_fingerprint: "C".repeat(40), signature: "sig-c" },
    ],
  }));
}

describe("property: schema validation", () => {
  test("prop #1 — any generated valid payload+sig passes validateSchema", () => {
    fc.assert(
      fc.property(sigArb(), (sig) => {
        return validateSchema(sig).length === 0;
      }),
      { numRuns: 80 },
    );
  });

  test("prop #2 — dropping any required field triggers a schema error", () => {
    const requiredFields = [
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

    fc.assert(
      fc.property(
        sigArb(),
        fc.constantFrom(...requiredFields),
        (sig, field) => {
          const mutated: Record<string, unknown> = { ...sig };
          delete mutated[field];
          return validateSchema(mutated).length > 0;
        },
      ),
      { numRuns: 50 },
    );
  });

  test("prop #3 — wrong signature count (<3) always rejected", () => {
    fc.assert(
      fc.property(sigArb(), fc.integer({ min: 0, max: 2 }), (sig, count) => {
        const mutated = { ...sig, signatures: sig.signatures.slice(0, count) };
        return validateSchema(mutated).some((e) => e.includes("signatures"));
      }),
      { numRuns: 50 },
    );
  });
});

describe("property: canonicalization", () => {
  test("prop #4 — canonicalize is deterministic (same input → same bytes)", () => {
    fc.assert(
      fc.property(payloadArb(), (payload) => {
        return canonicalize(payload) === canonicalize(payload);
      }),
      { numRuns: 100 },
    );
  });

  test("prop #5 — canonicalize is key-order independent (shuffled keys → same output)", () => {
    fc.assert(
      fc.property(payloadArb(), (payload) => {
        // Create a "shuffled" version by rebuilding the object with reversed key order.
        const src = payload as unknown as Record<string, unknown>;
        const keys = Object.keys(src).reverse();
        const shuffled: Record<string, unknown> = {};
        for (const k of keys) {
          shuffled[k] = src[k];
        }
        // Also shuffle anchor_files keys.
        // Use Object.create(null) so assigning a key named "__proto__"
        // creates an own data property instead of triggering the setter.
        const afKeys = Object.keys(payload.anchor_files).reverse();
        const shuffledAf = Object.create(null) as Record<string, string>;
        for (const k of afKeys) shuffledAf[k] = payload.anchor_files[k]!;
        shuffled.anchor_files = shuffledAf;
        return canonicalize(payload) === canonicalize(shuffled as unknown as PathsSigPayload);
      }),
      { numRuns: 60 },
    );
  });

  test("prop #6 — payloadHashHex ignores signatures tampering", () => {
    fc.assert(
      fc.property(sigArb(), fc.string({ minLength: 1, maxLength: 50 }), (sig, tamper) => {
        const original = payloadHashHex(sig);
        const tampered = { ...sig, signatures: sig.signatures.map((s) => ({ ...s, signature: tamper })) };
        return payloadHashHex(tampered) === original;
      }),
      { numRuns: 60 },
    );
  });

  test("prop #7 — different payload → different hash (collision-free in test domain)", () => {
    fc.assert(
      fc.property(payloadArb(), payloadArb(), (a, b) => {
        // Skip the edge case where fast-check generated structurally identical payloads.
        const ac = canonicalize(a);
        const bc = canonicalize(b);
        if (ac === bc) return true; // vacuous
        return payloadHashHex(a) !== payloadHashHex(b);
      }),
      { numRuns: 60 },
    );
  });
});

describe("property: expiry", () => {
  test("prop #8 — future expires_at always accepted, past always rejected", () => {
    fc.assert(
      fc.property(sigArb(), fc.boolean(), (sig, future) => {
        const now = new Date("2026-04-22T00:00:00Z");
        const expires = future
          ? new Date(now.getTime() + 86_400_000).toISOString()
          : new Date(now.getTime() - 86_400_000).toISOString();
        const mutated: PathsSig = { ...sig, expires_at: expires };
        return verifyExpiry(mutated, now) === future;
      }),
      { numRuns: 60 },
    );
  });
});

describe("property: anchor SHA tampering", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(pathJoin(tmpdir(), "hive-anchor-sha-"));
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  test("prop #9 — any byte-level tamper on an anchor file is detected", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 8, maxLength: 256 }),
        fc.integer({ min: 0 }),
        async (content, offsetSeed) => {
          const relPath = "anchor-file.txt";
          const absPath = pathJoin(tmpDir, relPath);
          await mkdir(dirname(absPath), { recursive: true });
          await writeFile(absPath, content);

          const originalHex = bytesToHex(sha256(content));
          const sig = validSig();
          sig.anchor_files = { [relPath]: originalHex };

          // Baseline: no mismatch.
          const baseline = await verifyAnchorShas(sig, tmpDir);
          expect(baseline).toEqual([]);

          // Tamper one byte and rewrite.
          const tampered = new Uint8Array(content);
          const idx = offsetSeed % tampered.length;
          tampered[idx] = (tampered[idx]! ^ 0xff) & 0xff;
          await writeFile(absPath, tampered);

          const mismatches = await verifyAnchorShas(sig, tmpDir);
          // Either (a) tamper flipped nothing (shouldn't happen post-xor), or
          // (b) mismatch detected.
          return mismatches.length === 1 && mismatches[0]!.reason === "mismatch";
        },
      ),
      { numRuns: 20 },
    );
  });

  test("missing anchor file reported as `missing`", async () => {
    const sig = validSig();
    sig.anchor_files = { "nonexistent/path.txt": SHA_ZEROS };
    const mismatches = await verifyAnchorShas(sig, tmpDir);
    expect(mismatches.length).toBe(1);
    expect(mismatches[0]?.reason).toBe("missing");
  });
});

// -----------------------------------------------------------------------------
// loadPathsSig — round-trip via real file
// -----------------------------------------------------------------------------

describe("loadPathsSig", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(pathJoin(tmpdir(), "hive-load-sig-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  test("loads a valid .sig file and returns typed object", async () => {
    const sig = validSig();
    const path = pathJoin(dir, "PROTOCOL_PATHS.sig");
    await writeFile(path, JSON.stringify(sig));
    const loaded = await loadPathsSig(path);
    expect(loaded.version).toBe(sig.version);
    expect(loaded.signatures.length).toBe(3);
  });

  test("rejects malformed JSON", async () => {
    const path = pathJoin(dir, "bad.sig");
    await writeFile(path, "{ not valid json");
    await expect(loadPathsSig(path)).rejects.toThrow(/JSON parse failed/);
  });

  test("rejects schema-invalid file", async () => {
    const bad = validSig() as Partial<PathsSig>;
    delete bad.version;
    const path = pathJoin(dir, "bad-schema.sig");
    await writeFile(path, JSON.stringify(bad));
    await expect(loadPathsSig(path)).rejects.toThrow(/schema validation failed/);
  });
});

// -----------------------------------------------------------------------------
// verifyAll — orchestrator
// -----------------------------------------------------------------------------

describe("verifyAll", () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await mkdtemp(pathJoin(tmpdir(), "hive-verify-all-"));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  });

  test("reports expired sig with failures=['expired', ...]", async () => {
    const sig = validSig();
    sig.expires_at = "2000-01-01T00:00:00Z";
    sig.anchor_files = {}; // avoid sha mismatch noise.
    const result = await verifyAll(sig, tmp, new Map());
    expect(result.failures.includes("expired")).toBe(true);
    expect(result.ok).toBe(false);
  });

  test("reports signature_count when <3", async () => {
    const sig = validSig();
    sig.signatures = sig.signatures.slice(0, 1);
    sig.anchor_files = {};
    const result = await verifyAll(sig, tmp, new Map());
    expect(result.failures.includes("schema_invalid") || result.failures.includes("signature_count")).toBe(true);
  });

  test("anchor_mismatch listed when files diverge", async () => {
    const sig = validSig();
    const relPath = "file-that-will-mismatch.txt";
    const abs = pathJoin(tmp, relPath);
    await writeFile(abs, "real content");
    sig.anchor_files = { [relPath]: SHA_ZEROS }; // intentionally wrong hash
    const result = await verifyAll(sig, tmp, new Map());
    expect(result.failures.includes("anchor_mismatch")).toBe(true);
    expect(result.sha_mismatches.length).toBe(1);
  });

  test("round-trip: canonicalize → hash → mock-sign → mock-verify flow", () => {
    const sig = validSig();
    const payload = payloadOf(sig);
    const canonical = canonicalize(payload);
    const hashHex = bytesToHex(sha256(new TextEncoder().encode(canonical)));

    // Recompute via payloadHashHex — must match.
    expect(payloadHashHex(sig)).toBe(hashHex);

    // Mutate a non-signature field → hash changes.
    sig.version = "1.0.1";
    expect(payloadHashHex(sig)).not.toBe(hashHex);
  });
});
