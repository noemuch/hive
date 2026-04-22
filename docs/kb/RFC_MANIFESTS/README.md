<!-- @hive-protocol: rfc-manifests-index -->
---
name: RFC Manifests — Canonical Vote-Open Snapshots
purpose: Directory scaffold for canonical JSON manifests produced by ratify-rfc.yml at every RFC vote-open. Each manifest is the object voters sign (per NORTHSTAR §5.3); its SHA-256 appears in vote-block `rfc_manifest_sha256` field.
updated: 2026-04-22
anchor_status: this directory is an anchor (§2.1). The README is also anchor as the index. Individual manifest files (`rfc-NNN.json`) become anchors at commit time.
references: NORTHSTAR §5.3 (canonical RFC manifest schema), §5.7 (expedited), §5.8 (entrenchment), HARD-FORK-PROCEDURE.md §2 (comment-parsing grammar), §3 (worked example).
---

# RFC Manifests Directory

## Role in the Protocol

At RFC vote-open, `ratify-rfc.yml` generates one JSON manifest per RFC, named `rfc-NNN.json`. Voters sign SHA-256 of the **canonical JCS form** (RFC 8785) of this file. Any post-vote-open edit to the referenced issue body or PR head SHA invalidates the manifest; `ratify-rfc.yml` nullifies the RFC with an `rfc-tampered` incident (§8.5).

Manifests are signed by the workflow's ephemeral key, itself **Shamir-split across 3 Stewards**. Verification requires 2-of-3 Steward shares to reconstruct. This protects against a single-Steward-compromise silent manifest-forgery.

## File naming

`rfc-NNN.json` where NNN is zero-padded to at least 3 digits (`rfc-001.json`, `rfc-017.json`, `rfc-2041.json`). Monotonic, no reuse.

## Schema (per NORTHSTAR §5.3)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": [
    "issue_number",
    "issue_body_nfc",
    "issue_updated_at",
    "linked_pr_head_sha",
    "vote_opens_at",
    "vote_closes_at",
    "threshold_phase",
    "entrenchment",
    "excluded_scope_check"
  ],
  "properties": {
    "issue_number": {
      "type": "integer",
      "minimum": 1
    },
    "issue_body_nfc": {
      "type": "string",
      "description": "NFC-normalized, CRLF→LF, stripped trailing whitespace issue body at vote-open moment."
    },
    "issue_updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "linked_pr_head_sha": {
      "type": "string",
      "pattern": "^[a-f0-9]{40}$"
    },
    "vote_opens_at": {
      "type": "string",
      "format": "date-time"
    },
    "vote_closes_at": {
      "type": "string",
      "format": "date-time"
    },
    "threshold_phase": {
      "enum": ["P1", "P2", "P3"]
    },
    "entrenchment": {
      "type": "boolean"
    },
    "entrenchment_cycle": {
      "enum": [1, 2, null]
    },
    "excluded_scope_check": {
      "enum": ["passed", "failed"]
    },
    "expedited": {
      "type": "boolean"
    },
    "expedited_auto_revert_deadline": {
      "type": ["string", "null"],
      "format": "date-time"
    },
    "auditor_attesters": {
      "type": "array",
      "description": "Populated only when entrenchment=false AND expedited=true.",
      "items": {
        "type": "object",
        "required": ["handle", "gpg_fingerprint", "employer", "trust_root", "signature"],
        "properties": {
          "handle": { "type": "string" },
          "gpg_fingerprint": { "type": "string", "pattern": "^[A-F0-9]{40}$" },
          "employer": { "type": "string" },
          "trust_root": { "type": "string" },
          "signature": { "type": "string" }
        }
      }
    },
    "bitcoin_block_hash_at_vote_open": {
      "type": "string",
      "description": "External-anchor for replay resistance."
    },
    "workflow_ephemeral_key_shamir_commitment": {
      "type": "string",
      "pattern": "^[a-f0-9]{64}$",
      "description": "Pedersen-style commitment to the Shamir-split key reconstituted for this manifest."
    }
  }
}
```

Canonicalization for signing follows `PROTOCOL_PATHS_SCHEMA.md` rules: remove signatures field (if any), sort object keys recursively lexicographically, serialize with RFC 8785 JCS, UTF-8 encode, SHA-256.

## Files

*(none — no RFCs pre-genesis)*

---

## Update policy

- Manifest files are **write-once**: once committed by `ratify-rfc.yml`, they are never edited. Tampering triggers `rfc-tampered` per §8.5.
- This README (the directory scaffold) may be amended via §5 standard RFC.
- Schema amendments in this file must match NORTHSTAR §5.3; divergence BLOCKs via `meta-guard.yml`.

## Cross-reference

- Vote-block grammar: `HARD-FORK-PROCEDURE.md` §2.
- Worked example of entrenchment RFC using a manifest: `HARD-FORK-PROCEDURE.md` §3.
- RFC_LOG row referencing a manifest: see `RFC_LOG.md` schema (`manifest_sha256` field).

## History

| Date | Event |
|---|---|
| 2026-04-22 | Directory scaffold created. No RFCs pre-genesis. |

---

**End of RFC_MANIFESTS/README.md**
