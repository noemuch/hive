---
name: Pre-Genesis Security Auditor Pool
purpose: Public registry of independent security auditors authorized under NORTHSTAR §5.7 (expedited RFC attestation), §10.2 (bug bounty adjudication + Steward candidacy certification), and §10.3 (formal analysis review).
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
minimum_entries_at_genesis: 8
trust_root_diversity_required: true
---

# Hive Auditor Pool

## Role in the Protocol

Auditors perform three protocol-level functions:

1. **§5.7 expedited-RFC attestation**: a verified security vulnerability post-genesis requires attestation from **≥ 2 auditors** with **distinct employers AND distinct cryptographic trust-roots**. The pair is seeded per-incident by Bitcoin-hash (per §8.4 mechanism).
2. **§10.2 bug bounty adjudication**: confirm a finding is "not plausibly self-planted" as part of Steward candidacy scoring. Live video identity attestation for Steward candidates.
3. **§10.3 formal analysis review**: at least 2 auditors independently review the property-based test suite results before `GENESIS_AUDIT.md` is signed.

Auditors do NOT have merge rights. They attest, they do not decide.

## Distinctness Requirements

For any task requiring multiple auditor signatures, the set of auditors MUST satisfy:

- Distinct employers (no two auditors at the same company).
- Distinct cryptographic trust-roots (no two auditors whose GPG keys share a common upstream signer in the web of trust).
- Distinct nationalities (best effort — reduces single-jurisdiction capture).

## Registry Schema

Each auditor entry follows:

```yaml
handle: <github-handle>
display_name: <human-readable>
gpg_fingerprint: <40-hex>
employer: <current-affiliation-or-"independent">
trust_root: <upstream-key-signer-or-"self-signed">
nationality: <iso-3166-alpha-2>
attestation_scope:
  - expedited-rfc
  - bug-bounty
  - formal-analysis
public_key_url: <url>
added_at: <iso8601>
added_by_rfc: <rfc-nnn-or-"genesis">
status: active | paused | removed
```

## Registry

*To be populated before tag `v1.0.0-genesis` per §13.1 preconditions. Minimum 8 auditors at genesis. Additions post-genesis require §5 standard RFC.*

### Placeholder entries (pre-genesis — to be replaced)

```yaml
- handle: <TBD-1>
  display_name: <TBD>
  gpg_fingerprint: <TBD>
  employer: independent
  trust_root: self-signed
  nationality: <TBD>
  attestation_scope: [expedited-rfc, bug-bounty, formal-analysis]
  public_key_url: <TBD>
  added_at: <TBD>
  added_by_rfc: genesis
  status: active
```

**7 more auditor slots reserved.** Target diversity:
- ≥ 3 different employers (one academia, one industry, one independent minimum)
- ≥ 3 different continents represented
- ≥ 1 auditor with formal-verification background (for §10.3 property tests)
- ≥ 1 auditor with cryptographic protocol background (for RFC 8785 canonicalization + multi-sig)
- ≥ 1 auditor with Swiss law background (for HPA Verein compliance)

## Onboarding Procedure

1. Candidate opens issue in Bureau of Governance labeled `auditor-application`.
2. Application includes: GPG public key, past vulnerability disclosures or audit reports, conflict-of-interest declaration, attestation scope requested.
3. Pre-genesis: `noemuch` reviews + accepts/rejects (P0 admin).
4. Post-genesis: §5 standard RFC required (Appendix C template), with added requirement: 2-auditor attestation of candidate's independence from existing Stewards.
5. On acceptance: entry appended here + PROTOCOL_PATHS.sig re-issued.

## Rotation

Auditors may voluntarily pause (`status: paused`) or fully withdraw (`status: removed`). Removal via misconduct requires:
- §5 standard RFC
- Evidence of conflict-of-interest violation OR false attestation
- ⅔ of remaining active auditors co-sign the removal RFC

## Conflicts of Interest

Auditors MUST recuse from:
- Any finding submitted by a party they've co-authored with in the last 12 months.
- Any RFC touching code they authored or reviewed outside of this pool role.
- Any incident involving their own employer as attacker or attacked.

Recusal is SELF-declared. False non-recusal discovered post-facto triggers §8.4 panel review and potential removal.

## Compensation

Auditors receive:
- Fixed retainer per attestation (amount TBD, set by HPA board post-genesis).
- **No HEAR weight from their auditor role** (cannot self-qualify as Steward via audit fees).
- Published credits in audited artifacts.

## History

| Date | Event | RFC |
|---|---|---|
| 2026-04-22 | Anchor file created (empty pool) | — (pre-genesis bootstrap) |
