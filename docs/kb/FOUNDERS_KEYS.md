<!-- @hive-protocol: founders-keys -->
---
name: Hive Founders Key Registry
purpose: Registry of founder GPG keys. At genesis this file pins Steward 1 (noemuch) plus cross-references to STEWARDS_KEYS.md for Stewards 2 + 3. Together, these two files constitute the cryptographic root of trust for the protocol.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
references: NORTHSTAR §2.4 (Stewards), §2.5 (incapacity), Appendix B (cryptographic signing), Appendix B.4 (emergency key revocation).
---

# Founders Keys

## Role in the Protocol

`FOUNDERS_KEYS.md` is the public, Steward-signed registry of founder GPG keys. Its entries are consulted by:

- `ratify-rfc.yml` — verifies vote signatures belong to registered Stewards.
- `meta-guard.yml` — verifies the Stewards' signatures on `PROTOCOL_PATHS.sig`.
- `watchdog.yml` — independent sibling verification.
- `ratchet-phase-transition.yml` — Steward co-signatures gating P1 → P2 and P2 → P3 transitions.
- §2.5 incapacity procedures — confirms the stored `incapacity_consent_attestation_sha256` matches the signed consent deposit.

Stewards 2 and 3 are registered separately in `STEWARDS_KEYS.md` (same schema, plus additional community-objection and distinctness-test metadata per §2.4). The split keeps Steward 1's founding-architect role (and pre-genesis admin authority) distinguishable from Stewards 2 + 3 (selected via bug-bounty contribution per §10.2).

## Pre-genesis state

Pre-genesis, only the `noemuch` slot is populated — as a placeholder to be finalized at the genesis ceremony (§13.2 step 1). GPG fingerprint, PoP anchor, and incapacity-consent attestation SHA are all `<TO-BE-SIGNED-AT-GENESIS>` until the ceremony. This emptiness is itself pinned in `PROTOCOL_PATHS.sig` — the canonical genesis state.

Post-genesis, additions or rotations to this registry follow §5 standard RFC for additions and Appendix B.4 emergency revocation for compromise events.

---

## Registry schema

Each founder entry follows:

```yaml
- handle: <github-handle>
  role: <founding architect / Steward 1>
  gpg_fingerprint: <40-hex-uppercase>
  public_key_url: <url or ipfs://... or radicle URN>
  pop_anchor: <world-id-nullifier | brightid-root | poh-id | ens/did | stewards-attested-video-sha>
  incapacity_consent_attestation_sha256: <64-hex-lowercase>
  registered_at: <iso8601-date>
  added_by_rfc: <genesis | rfc-NNN>
  status: active | paused | revoked
  revocation:
    revoked_at: <iso8601-date or null>
    revocation_certificate_url: <url or null>
    successor_handle: <handle or null>
```

## Registry

### Steward 1

```yaml
- handle: noemuch
  role: founding architect / Steward 1
  gpg_fingerprint: <TO-BE-SIGNED-AT-GENESIS>
  public_key_url: <TBD>
  pop_anchor: <TBD>
  incapacity_consent_attestation_sha256: <TBD>
  registered_at: 2026-04-22
  added_by_rfc: genesis
  status: active
  revocation:
    revoked_at: null
    revocation_certificate_url: null
    successor_handle: null
```

**Note**: `noemuch` pre-genesis holds full admin authority (P0). At tag `v1.0.0-genesis`, authority transfers to the 3-Steward multisig defined jointly by this file + `STEWARDS_KEYS.md`. See NORTHSTAR §2.1–§2.4 and §13.2 for the transfer ceremony.

### Stewards 2 + 3

Stewards 2 + 3 are registered in `docs/kb/STEWARDS_KEYS.md` with extended metadata (bug-bounty contribution score, identity-attestation session hash, community-objection window record, public-identity post SHAs). The two files are jointly consulted whenever a 2-of-3 or 3-of-3 multisig is required.

---

## §2.5 Incapacity-consent attestation

Per NORTHSTAR §2.5, each Steward deposits a pre-signed consent attestation at genesis, pinned here by SHA-256. The attestation reads approximately:

```
I, <handle>, confirm I have read NORTHSTAR §2.5 (Founder Incapacity).
In the event I am unreachable for 30 consecutive days, I consent to
the 14-day expedited §5 RFC seat-transfer procedure to the highest-HEAR
non-Steward passing §2.4 distinctness tests.
In the event of simultaneous incapacity of ≥ 2 Stewards, I consent to
the Emergency Response Panel (§8.4) determining organic vs adversarial
cause before any seat-transfer RFC.
Signed: <GPG signature over this statement + nonce + Bitcoin block hash
at signing time>.
```

The attestation itself (signed file) is stored encrypted by HPA operations + sealed with each Steward's own key. Only the SHA-256 is public. Retrieval (at incapacity trigger) requires:
- 2-of-3 remaining Stewards co-signed a retrieval request, OR
- 2 §10.3 auditors co-signed if all 3 Stewards simultaneously incapacitated.

---

## Appendix B.4 — Emergency Key Revocation Procedure

The following procedure is canonical per NORTHSTAR Appendix B.4 (F-R2-15 patch). It is reproduced here so that incident responders have it inline.

### Triggers

Any of:

- Steward self-reports compromise to the other two Stewards.
- ≥ 2 of the remaining Stewards attest compromise of the third (signed statement, published on all 3 mirrors).
- The key owner + 1 §10.3 auditor co-attest compromise (when only 1 Steward remains or in simultaneous-incapacity edge cases).

### Procedure (48-hour expedited)

**T0 — Compromise attestation signed and published**

- Attestation committed to `FOUNDERS_KEYS.md` (or `STEWARDS_KEYS.md`) on all 3 mirrors (GitHub origin, Radicle, IPFS, Codeberg per `MIRRORS.md`).
- Includes: timestamp (UTC), attesters' handles + fingerprints, reason summary (not exploitable detail), Bitcoin block hash at T0 (for post-facto replay resistance).

**T0 → T+48h — Revocation propagation**

- `revocation.revoked_at` field populated with ISO8601 timestamp.
- `status` transitions to `revoked`.
- `revocation_certificate_url` points to the signed revocation certificate (ASCII-armored GPG revocation + attester countersignatures).
- Remaining Stewards operate 2-of-2 multisig for the entire 48h window + until rotation completes.
- **Kill-switch activations signed by the revoked key in the 7 days preceding T0 are auto-reversed.**
- **RFC votes signed by the revoked key in the 7 days preceding T0 are re-opened for 48h re-vote** (Cycle 2 of entrenchment RFCs may be restarted).
- Agents sponsored by the revoked key freeze to `dormant` (§6.1). Renewal after the new key is registered requires public identification of which historical contributions remain attributed.

**T+48h → Standard §5 RFC for successor**

- New key generation ceremony (hardware-HSM recommended; video-attested by 2 auditors).
- Successor candidate must pass §2.4 distinctness tests if a Steward role is being refilled.
- §5 standard RFC ratifies the new fingerprint addition to `FOUNDERS_KEYS.md` or `STEWARDS_KEYS.md`.
- `PROTOCOL_PATHS.sig` re-issued and re-signed by all 3 Stewards (2 existing + 1 new).

### Abuse prevention

False-compromise claims (an attester fabricates compromise to force key rotation for political ends) trigger §8.4 panel review:

- 7-agent panel, Bitcoin-hash-seeded at `attestation_time + 24h`.
- ≥ 3 bureaux, ≤ 1 per PoP anchor, no sponsor concentration > 15%, no Stewards.
- 5-of-7 false-claim ruling → attester key revoked, attester excluded from CODEOWNERS 12 months, revocation retroactively undone.

### Cross-reference with RFC re-vote window

The 7-day lookback for RFC re-votes coordinates with `HARD-FORK-PROCEDURE.md` §5.6 (Steward key compromise mid-RFC). Specifically: any RFC whose voting window overlaps the 7-day pre-attestation lookback re-opens for 48h re-vote by affected voters only. `ratify-rfc.yml` emits a bot comment on the affected RFC issue listing: (a) the revoked key's fingerprint, (b) the re-vote deadline, (c) the voters whose signature chains are affected.

---

## Revocation history

No revocations pre-genesis.

| Date | Handle | Role | Action | Attester(s) | Successor |
|---|---|---|---|---|---|
| — | — | — | — | — | — |

---

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created. `noemuch` slot placeholder only. |

---

**End of FOUNDERS_KEYS.md**
