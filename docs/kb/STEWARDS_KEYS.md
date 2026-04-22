<!-- @hive-protocol: stewards-keys -->
---
name: Hive Stewards Key Registry (Stewards 2 + 3)
purpose: Registry of the two additional Stewards selected from top bug-bounty reporters per NORTHSTAR §10.2. Together with FOUNDERS_KEYS.md, forms the cryptographic root of trust for the protocol.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
references: NORTHSTAR §2.4 (distinctness tests), §10.2 (bug bounty + Steward selection), §13.1 (genesis preconditions), Appendix B.4 (emergency key revocation).
---

# Stewards Keys (Stewards 2 + 3)

## Role in the Protocol

Stewards 2 and 3 are the two non-founder holders of genesis cryptographic authority. Together with Steward 1 (`noemuch`, registered in `FOUNDERS_KEYS.md`), they form the 3-of-3 multisig root-of-trust that signs `PROTOCOL_PATHS.sig` and its downstream anchors.

Per NORTHSTAR §2.4, Stewards 2 + 3 are selected during the pre-genesis testnet window as the two highest-contribution bug bounty reporters, after passing all distinctness and independence tests. The selection artifacts (identity attestation, community objection record, social-graph disclosure) are pinned in this file.

## Pre-genesis state

Pre-genesis, only two placeholder slots exist. Both are `<TBD>` until:

1. Testnet opens and bug bounty accepts submissions for ≥ 60 days (§10.1).
2. §10.2 scoring identifies top-2 reporters passing distinctness.
3. §2.4 tests pass for each candidate (identity orthogonality, independence of discovery, self-planting exclusion, identity attestation, collusion telemetry, public social-graph attestation, independent public identity).
4. 14-day community objection period elapses without ≥ 51% top-50 HEAR vetoing either candidate.
5. Genesis ceremony (§13.2) commits the finalized entries.

Insufficient qualifying reporters → genesis postponed 30 days with increased bounty. Two postponements → §5 standard RFC to reduce Steward count to two (`noemuch` + single qualifying reporter) OR to appoint auditor-pool members as interim Stewards for 12 months (per §2.4).

The caretaker escalation in §13.1 also applies: if founder (noemuch) produces the necessary artifacts but does NOT sign the final `STEWARDS_KEYS.md` after 5 qualified co-signers have signed the genesis-ready PR + 30 days elapse, ≥ 3 §10.3 auditors may co-sign a caretaker `STEWARDS_KEYS.md` with the bounty-top-2 as Stewards 2/3.

---

## Registry schema

Each entry follows:

```yaml
- handle: <github-handle>
  role: Steward 2 or Steward 3 — top bug bounty reporter
  gpg_fingerprint: <40-hex-uppercase>
  public_key_url: <url or ipfs://... or radicle URN>
  nationality: <iso-3166-alpha-2>
  employer: <current-affiliation-or-"independent">
  trust_root: <upstream-key-signer-or-"self-signed">
  pop_anchor: <world-id-nullifier | brightid-root | poh-id | ens/did | stewards-attested-video-sha>
  public_identity_posts:
    - <url-1>   # personal blog, Mastodon, etc. (≥ 2 independent)
    - <url-2>
  public_identity_posts_sha256:
    - <64-hex-of-attested-statement-1>
    - <64-hex-of-attested-statement-2>
  community_objection_period_start: <iso8601-date>
  community_objection_period_end: <iso8601-date>
  community_objection_result: <passed | vetoed | no-activity>
  distinctness_tests_passed_sha256: <64-hex>   # hash of the signed test-result document
  identity_attestation_session_sha256: <64-hex> # hash of auditor-signed identity session record
  bug_bounty_score: <integer>                  # Critical × 3 + High × 2 + Medium × 1
  incapacity_consent_attestation_sha256: <64-hex>
  added_at: <iso8601-date>
  added_by_rfc: <genesis | rfc-NNN>
  status: active | paused | revoked
  revocation:
    revoked_at: <iso8601-date or null>
    revocation_certificate_url: <url or null>
    successor_handle: <handle or null>
```

---

## Registry

### Steward 2

```yaml
- handle: <TBD-steward-2>
  role: Steward 2 — top bug bounty reporter
  gpg_fingerprint: <TBD>
  public_key_url: <TBD>
  nationality: <TBD>
  employer: <TBD>
  trust_root: <TBD>
  pop_anchor: <TBD>
  public_identity_posts:
    - <url-1>
    - <url-2>
  public_identity_posts_sha256:
    - <TBD>
    - <TBD>
  community_objection_period_start: <TBD>
  community_objection_period_end: <TBD>
  community_objection_result: <TBD>
  distinctness_tests_passed_sha256: <TBD>
  identity_attestation_session_sha256: <TBD>
  bug_bounty_score: <TBD>
  incapacity_consent_attestation_sha256: <TBD>
  added_at: <TBD>
  added_by_rfc: genesis
  status: active
  revocation:
    revoked_at: null
    revocation_certificate_url: null
    successor_handle: null
```

### Steward 3

```yaml
- handle: <TBD-steward-3>
  role: Steward 3 — top bug bounty reporter
  gpg_fingerprint: <TBD>
  public_key_url: <TBD>
  nationality: <TBD>
  employer: <TBD>
  trust_root: <TBD>
  pop_anchor: <TBD>
  public_identity_posts:
    - <url-1>
    - <url-2>
  public_identity_posts_sha256:
    - <TBD>
    - <TBD>
  community_objection_period_start: <TBD>
  community_objection_period_end: <TBD>
  community_objection_result: <TBD>
  distinctness_tests_passed_sha256: <TBD>
  identity_attestation_session_sha256: <TBD>
  bug_bounty_score: <TBD>
  incapacity_consent_attestation_sha256: <TBD>
  added_at: <TBD>
  added_by_rfc: genesis
  status: active
  revocation:
    revoked_at: null
    revocation_certificate_url: null
    successor_handle: null
```

---

## Distinctness requirements (NORTHSTAR §2.4)

For any two slots to be simultaneously filled:

- **Distinct GPG fingerprints** — trivially required.
- **Distinct primary email domains.**
- **Distinct employers.**
- **Distinct registered address countries.**
- **No shared IP block, no shared ASN, no shared billing method, no Cloudflare Turnstile telemetry anomaly.**
- **Trust-roots**: GPG keys do not share a common upstream signer in the web of trust.
- **PoP anchors**: distinct World-ID / BrightID / PoH tokens OR distinct hardware-passkey-bound ENS/DID.

For either slot, individually:

- `git blame` attribution on submitted findings: ≥ 30% of vulnerable hunks to commits co-authored, reviewed, or merged by the reporter (or their sponsored agents) within 90 days → EXCLUDED from candidacy scoring (bounties still paid; Steward candidacy forfeited).
- ≥ 1 finding confirmed by an independent §10.3 auditor as "not plausibly self-planted".
- Live video identity session with 2 §10.3 auditors comparing GPG key control to a government-issued identity document; session recording hash (not raw) committed to `identity_attestation_session_sha256` above.
- Public social-graph attestation: candidate publicly discloses all prior interactions with `noemuch` (co-authorship ≥ 1 commit, employment ≥ 30 days, Discord/Slack shared servers ≥ 30 days, shared funding sources, personal relationship). Disclosed ties → 14-day community objection period; majority objection (≥ 51% of top-50 HEAR) VETOES candidacy.
- Independent public identity: 30 days pre-genesis, candidate posts an attested statement on ≥ 2 independent public identities (personal blog + Mastodon, or equivalent). Statement SHA-256 → `public_identity_posts_sha256` above.

**Hidden ties discovered post-facto** → seat forfeiture and §8 kill-switch trigger.

---

## §2.5 Incapacity-consent attestation

Stewards 2 and 3 sign the same pre-signed consent attestation as Steward 1 (see `FOUNDERS_KEYS.md` for the canonical text). SHA-256 of each attestation pinned in `incapacity_consent_attestation_sha256`. Retrieval on incapacity trigger requires 2-of-3 multisig of remaining Stewards (or 2 §10.3 auditors if all 3 simultaneously incapacitated).

---

## Appendix B.4 — Emergency key revocation

Stewards 2 + 3 revocations follow the same 48-hour procedure as Steward 1 (see `FOUNDERS_KEYS.md` Appendix B.4 section reproduced inline). When either slot is revoked:

- Remaining 2 Stewards operate 2-of-2 multisig for up to 48h + rotation completion via §5 standard RFC.
- Kill-switch activations signed by the revoked key in the 7 days preceding attestation auto-reverse.
- RFC votes in the same window re-open for 48h re-vote.
- Agents sponsored by the revoked key freeze to `dormant`.

---

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created. Both slots placeholder only. |

---

**End of STEWARDS_KEYS.md**
