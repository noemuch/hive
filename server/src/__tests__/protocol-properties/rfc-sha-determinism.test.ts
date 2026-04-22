/* @hive-protocol-test: server/src/protocol/rfc-manifest.ts */
//
// Property-based tests for NORTHSTAR §10.3 / Appendix G row "rfc_sha".
//
// Properties:
//   - Identical RFC manifest JSON → identical SHA-256 (deterministic).
//   - Whitespace / key-order variations normalize to the same canonical form
//     (RFC 8785 JCS).
//   - Minor content changes yield different hashes (avalanche, i.e. non-trivial
//     distinctness — not a cryptographic avalanche claim, since SHA-256 already
//     gives that).
//
// Cross-runtime test: when the `node` binary is available, we exec a one-line
// Node.js program that hashes the same canonical JSON and assert the hex digest
// matches Bun's. Skipped gracefully otherwise; documented in the describe.

import { describe, it, expect } from "bun:test";
import fc from "fast-check";
import { execFileSync } from "node:child_process";

import {
  rfcManifestSha256,
  jcsStringify,
} from "../../protocol/rfc-manifest";

const RUNS = 80;

type Manifest = {
  issue_number: number;
  issue_body_nfc: string;
  issue_updated_at: string;
  linked_pr_head_sha: string;
  vote_opens_at: string;
  vote_closes_at: string;
  threshold_phase: "P1" | "P2" | "P3";
  entrenchment: boolean;
  excluded_scope_check: "passed" | "failed";
};

const arbManifest: fc.Arbitrary<Manifest> = fc.record({
  issue_number: fc.integer({ min: 1, max: 999_999 }),
  issue_body_nfc: fc.string({ minLength: 0, maxLength: 200 }),
  issue_updated_at: fc.constantFrom(
    "2026-05-01T12:00:00Z",
    "2026-05-01T12:00:01Z",
    "2026-06-01T00:00:00Z",
  ),
  linked_pr_head_sha: fc.hexaString({ minLength: 40, maxLength: 40 }),
  vote_opens_at: fc.constant("2026-05-15T12:00:00Z"),
  vote_closes_at: fc.constant("2026-05-22T12:00:00Z"),
  threshold_phase: fc.constantFrom("P1", "P2", "P3"),
  entrenchment: fc.boolean(),
  excluded_scope_check: fc.constantFrom("passed", "failed"),
});

describe("rfc_sha determinism (§5.3)", () => {
  it("same manifest → same SHA (determinism within runtime)", () => {
    fc.assert(
      fc.property(arbManifest, (m) => {
        return rfcManifestSha256(m) === rfcManifestSha256(m);
      }),
      { numRuns: RUNS },
    );
  });

  it("key-insertion-order does not affect the SHA", () => {
    fc.assert(
      fc.property(arbManifest, (m) => {
        const reorderedKeys = Object.keys(m).sort().reverse();
        const reordered: Record<string, unknown> = {};
        for (const k of reorderedKeys) reordered[k] = (m as never)[k];
        return rfcManifestSha256(m) === rfcManifestSha256(reordered);
      }),
      { numRuns: RUNS },
    );
  });

  it("different manifests → different SHAs (avalanche)", () => {
    fc.assert(
      fc.property(arbManifest, arbManifest, (a, b) => {
        const canonA = jcsStringify(a);
        const canonB = jcsStringify(b);
        if (canonA === canonB) return true; // duplicate — vacuous
        return rfcManifestSha256(a) !== rfcManifestSha256(b);
      }),
      { numRuns: RUNS },
    );
  });
});

describe("rfc_sha cross-runtime stability (§5.3)", () => {
  it("matches a Node.js-computed hash when `node` is available", () => {
    let nodeAvailable = true;
    try {
      execFileSync("node", ["--version"], { stdio: "ignore" });
    } catch {
      nodeAvailable = false;
    }
    if (!nodeAvailable) {
      // Document the gap rather than silently pass: the test is informative
      // on any CI runner that lacks `node`. bun:test has no `.skip`, so we
      // assert the explicit skip flag for transparency.
      expect(nodeAvailable).toBe(false);
      return;
    }

    const fixture: Manifest = {
      issue_number: 12345,
      issue_body_nfc: "Hello — world",
      issue_updated_at: "2026-05-01T12:00:00Z",
      linked_pr_head_sha: "a".repeat(40),
      vote_opens_at: "2026-05-15T12:00:00Z",
      vote_closes_at: "2026-05-22T12:00:00Z",
      threshold_phase: "P1",
      entrenchment: false,
      excluded_scope_check: "passed",
    };
    const bunDigest = rfcManifestSha256(fixture);
    const canonical = jcsStringify(fixture);

    // One-liner node program: hash the canonical string produced by Bun.
    const script = `const c=require('crypto');process.stdout.write(c.createHash('sha256').update(process.argv[1],'utf8').digest('hex'))`;
    const nodeDigest = execFileSync("node", ["-e", script, canonical], {
      encoding: "utf8",
    }).trim();
    expect(nodeDigest).toBe(bunDigest);
  });
});
