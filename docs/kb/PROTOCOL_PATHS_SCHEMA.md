---
name: PROTOCOL_PATHS.sig — JSON Schema and Semantics
purpose: Specification of the singular signed canonical anchor file from which all cryptographic anchors derive.
updated: 2026-04-22
anchor_status: this document is itself NOT an anchor (it's a schema spec); PROTOCOL_PATHS.sig is the anchor.
references: NORTHSTAR.md §2.1, Appendix H.
---

# PROTOCOL_PATHS.sig — Canonical Anchor Specification

## Role in the Protocol

`PROTOCOL_PATHS.sig` is the **single signed canonical file** from which all other cryptographic anchors in the Hive protocol derive. It pins, in one signed artifact:

- SHA-256 of every anchor file (§2.1).
- The pragma role allowlist (`@hive-protocol: <role>`).
- The Actions secrets allowlist (`secrets.*` / `vars.*` references in anchor workflows).
- The `package.json` lifecycle script allowlist (`preinstall`/`install`/`postinstall`/`prepare`).
- The reproducible-build hash (`bun run build` output).
- The canary test SHA (`protocol-invariants.test.ts`).
- The `APP_PERMISSIONS.json` SHA.
- The `MIRRORS.md` SHA.
- Steward signatures.

Every other signed constant in NORTHSTAR resolves via `PROTOCOL_PATHS.sig`. This means:

- If an attacker forges any single anchor, they must also forge `PROTOCOL_PATHS.sig` — and that requires forging 3 Steward GPG signatures (multi-sig), which is the fundamental security assumption of the protocol.
- Rotating one anchor without going through §5 is detectable because its SHA in `PROTOCOL_PATHS.sig` would no longer match.

## JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
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
    "signatures"
  ],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^[0-9]+\\.[0-9]+\\.[0-9]+(-[a-z0-9-]+)?$",
      "description": "Protocol version this .sig corresponds to. Matches NORTHSTAR semver."
    },
    "issued_at": {
      "type": "string",
      "format": "date-time"
    },
    "expires_at": {
      "type": "string",
      "format": "date-time",
      "description": "After this date, .sig must be re-issued via §5 RFC. Prevents indefinite use of stale signatures."
    },
    "protocol_version_predecessor_sig_sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "SHA of the previous PROTOCOL_PATHS.sig for chain integrity. Null at genesis."
    },
    "anchor_files": {
      "type": "object",
      "description": "SHA-256 of each anchor file. Keys are paths, values are 64-hex-char hashes.",
      "patternProperties": {
        "^.+$": {
          "type": "string",
          "pattern": "^[a-f0-9]{64}$"
        }
      }
    },
    "pragma_roles": {
      "type": "array",
      "description": "Allowlist of roles for @hive-protocol pragma.",
      "items": { "type": "string", "pattern": "^[a-z][a-z0-9-]*$" },
      "uniqueItems": true
    },
    "actions_secrets": {
      "type": "array",
      "description": "GitHub Actions secrets/vars consumed by anchor workflows. Protocol-relevant only.",
      "items": { "type": "string", "pattern": "^(secrets|vars)\\.[A-Z][A-Z0-9_]*$" },
      "uniqueItems": true
    },
    "lifecycle_allowlist": {
      "type": "array",
      "description": "Allowed npm/bun lifecycle scripts. Empty by default.",
      "items": {
        "type": "object",
        "required": ["hook", "command"],
        "properties": {
          "hook": { "enum": ["preinstall", "install", "postinstall", "prepare"] },
          "command": { "type": "string" }
        }
      }
    },
    "reproducible_build_hash": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "SHA-256 of the deterministic `bun run build` output tree, computed per the reproducible build spec (pinned Bun version, pinned deps, pinned build flags)."
    },
    "canary_test_sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "SHA-256 of protocol-invariants.test.ts. Used by §9.3 layer #11 for external-anchor canary verification."
    },
    "app_permissions_sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "SHA-256 of APP_PERMISSIONS.json."
    },
    "mirrors_sha256": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "SHA-256 of MIRRORS.md."
    },
    "required_status_checks": {
      "type": "array",
      "description": "Branch-protection required status checks, pinned by workflow file path + job id (not context name).",
      "items": {
        "type": "object",
        "required": ["workflow_path", "job_id"],
        "properties": {
          "workflow_path": { "type": "string", "pattern": "^\\.github/workflows/.+\\.ya?ml$" },
          "job_id": { "type": "string" }
        }
      }
    },
    "signatures": {
      "type": "array",
      "minItems": 3,
      "description": "GPG signatures from all three Stewards over the canonical JSON form of this document (excluding signatures field).",
      "items": {
        "type": "object",
        "required": ["steward", "gpg_fingerprint", "signature"],
        "properties": {
          "steward": { "enum": ["noemuch", "steward-2", "steward-3"] },
          "gpg_fingerprint": { "type": "string", "pattern": "^[A-F0-9]{40}$" },
          "signature": { "type": "string", "description": "ASCII-armored GPG signature" }
        }
      }
    }
  }
}
```

## Canonicalization rules (for signing)

To produce the signing payload:

1. Remove the `signatures` field.
2. Sort all object keys recursively in lexicographic order.
3. Serialize with RFC 8785 JSON Canonicalization Scheme (JCS).
4. UTF-8 encode.
5. SHA-256 over the canonical bytes = the value each Steward signs.

This guarantees signature reproducibility across Bun/Node/Deno runtimes and prevents signature drift from key-ordering or whitespace.

## Verification procedure

`meta-guard.yml` runs on every PR:

1. Load `PROTOCOL_PATHS.sig`.
2. Validate schema (this document).
3. Recompute canonical payload.
4. Verify all 3 Steward GPG signatures against fingerprints registered in `FOUNDERS_KEYS.md` / `STEWARDS_KEYS.md`.
5. For each anchor file: recompute SHA-256, compare to `anchor_files[path]`. Mismatch → BLOCK PR.
6. Check `expires_at` not elapsed. If elapsed → BLOCK PR with "PROTOCOL_PATHS.sig expired, §5 RFC required to re-issue".
7. Verify `required_status_checks` against live branch protection via GH API. Drift → BLOCK.

## Update procedure

`PROTOCOL_PATHS.sig` is itself an anchor. Updates require §5 RFC (standard, not expedited, since it alters the verification foundation).

**Genesis case**: the first `PROTOCOL_PATHS.sig` is produced at genesis ceremony (§13.2 step 2) and signed by all three Stewards; the tag `v1.0.0-genesis` commits include this signed file.

**Routine updates** (new anchor file added, pragma role added, etc.):
1. §5 standard RFC proposes the change.
2. RFC passes.
3. A bot workflow (`update-protocol-paths.yml`) recomputes SHAs, updates `PROTOCOL_PATHS.sig` body, opens a signing PR.
4. All 3 Stewards sign (multi-sig); signed file committed.
5. `RFC_LOG.md` records the SHA of the new `PROTOCOL_PATHS.sig`.
6. Old `PROTOCOL_PATHS.sig` is archived at `docs/kb/PROTOCOL_PATHS_ARCHIVE/<version>.sig` (also anchor files, for audit trail).

**Expiry**: `expires_at` default is `issued_at + 365 days`. Annual renewal forces regular Steward re-affirmation of the protocol state.

## Attack surface analysis

| Attack | Mitigation |
|---|---|
| Single anchor SHA forgery | `signatures[]` multi-sig (3 Stewards) required |
| Steward key compromise | Appendix B.4 emergency revocation within 48h |
| Stale .sig used post-expiry | `expires_at` forces annual §5 RFC renewal |
| Canonical serialization ambiguity | RFC 8785 JCS + SHA-256 pin |
| Circular trust (meta-guard verifies itself) | `watchdog.yml` verifies meta-guard independently (§9.3 layer #3) |
| Signature replay across versions | `protocol_version_predecessor_sig_sha256` chains versions |

## Non-goals

This schema does NOT specify:

- Post-quantum cryptography (future RFC).
- Threshold signatures beyond 3-of-3 (future RFC for larger Steward councils).
- Time-locked commit proofs (future RFC if bitcoin-adjacency evolves).
- Application-layer semantics (that's NORTHSTAR's job; this schema is purely about anchor integrity).

## Reference implementation

Will live at `server/src/protocol/verify-paths-sig.ts` (to be written). Property-based tests in `server/src/__tests__/protocol-properties/paths-sig.test.ts` verify:

- Schema validation catches malformed input.
- Signature verification rejects forged sigs.
- Canonicalization is stable across 3 runtimes (Bun, Node, Deno).
- Expiry enforcement.

---

**End of PROTOCOL_PATHS_SCHEMA.md**
