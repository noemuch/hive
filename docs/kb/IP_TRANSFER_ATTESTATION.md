<!-- @hive-protocol: ip-transfer-attestation -->
---
name: IP Transfer Attestation — Exhaustive Registry
purpose: Auditor-signed enumeration of every asset transferred from noemuch to Hive Protocol Association (HPA) pre-genesis. Per NORTHSTAR v0.3 §13.1, missing any item → genesis readiness-gate rejected.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
status: pre-genesis template (TBD entries filled during week 7 of CLEANUP-PLAN sequence)
---

# IP Transfer Attestation (Pre-Genesis)

## Purpose

Per NORTHSTAR v0.3 §13.1 and F-R2-14 round-2 patch, the IP transfer
from the founding architect (`noemuch`) to the Hive Protocol
Association (HPA) MUST be **exhaustive**. Any asset bearing the "Hive"
name or hosting Hive infrastructure that remains under founder personal
control post-genesis is a capture vector.

This document is the audited checklist. ≥ 2 auditors from AUDITOR_POOL.md
must sign this file at genesis, attesting that they have verified each
transfer and that no listed asset remains under founder personal
control. Missing any item blocks genesis via `ratchet-phase-transition.yml`.

## Asset Inventory

### A. Source code repositories

| Asset | Pre-Genesis Owner | Post-Genesis Owner | Status | Evidence |
|---|---|---|---|---|
| `github.com/noemuch/hive` | noemuch | `hive-protocol-association/hive` | TBD | Transfer event in GitHub audit log |
| `github.com/noemuch/hive-testnet` | noemuch | `hive-protocol-association/hive-testnet` | TBD | — |
| `github.com/noemuch/hive-fleet` (if applicable) | noemuch | `hive-protocol-association/hive-fleet` | TBD | — |
| GitHub Organization `noemuch` → `hive-protocol-association` | — | HPA-owned org | TBD | — |

### B. Domain names + DNS

| Asset | Registrar | Status | Evidence |
|---|---|---|---|
| `hive.chat` | TBD | TBD | Registrar transfer receipt |
| `hive.chat` DNS control | TBD (Cloudflare) | HPA Cloudflare account | TBD | — |
| DNS CAA records (Let's Encrypt, ISRG) | — | Locked per THREAT_MODEL T-03 | TBD | — |
| DNSSEC | — | Enabled + DS record in registrar | TBD | — |

### C. Trademarks

| Asset | Jurisdiction | Status |
|---|---|---|
| "Hive" trademark filing (if registered) | TBD | TBD — assignment to HPA |
| Stylized Hive logo (if registered) | TBD | TBD |

### D. Package registry namespaces

| Registry | Namespace | Status |
|---|---|---|
| npm | `@hive/*` | TBD — transfer to HPA-owned npm account |
| PyPI | `hive-*` (if used) | TBD |
| crates.io | `hive-*` (if used) | TBD |

### E. GitHub App + Organization

| Asset | Status |
|---|---|
| Hive GitHub App (`hive-protocol`) | TBD — ownership transfer to HPA |
| GitHub App admin rights distributed across 3 Stewards | TBD |
| Organizational Rulesets — Hive App excluded from "bypass branch protection" from P1 | TBD |
| GitHub Sponsors (if any) pointed to HPA | TBD |

### F. Social media handles

| Platform | Handle | Status |
|---|---|---|
| X / Twitter | `@hive_chat` (or equivalent) | TBD — transfer to HPA email |
| Mastodon | `@hive@...` | TBD |
| Bluesky | `@hive.chat` | TBD |
| LinkedIn | Hive Protocol Association company page | TBD |
| YouTube | Hive Protocol channel | TBD |
| Discord | Hive server | TBD — transfer ownership |
| Telegram | Hive announcements channel (if exists) | TBD |

### G. Infrastructure + hosting accounts

| Service | Purpose | Status |
|---|---|---|
| Google Workspace | HPA email (`*@hive.chat`) | TBD — create HPA workspace |
| Vercel | Web frontend deploy (if used) | TBD |
| Railway | Server + DB hosting | TBD — transfer project ownership to HPA billing |
| Cloudflare | CDN, DNS, WAF | TBD |
| Sentry | Error monitoring | TBD |
| Analytics (Plausible / PostHog / other) | Usage metrics | TBD |

### H. Donation / payment accounts

| Service | Purpose | Status |
|---|---|---|
| Stripe | Donation + enterprise billing | TBD — transfer to HPA business entity |
| GitHub Sponsors | Individual contributor sponsors → HPA treasury | TBD |
| Open Collective | Transparent treasury | TBD |
| Direct bank (Swiss) | HPA operational bank account | TBD |

### I. Mailing lists

| Service | Lists | Status |
|---|---|---|
| Mailchimp (or equivalent) | Announcements, digest, security | TBD |
| Substack (if used) | Newsletter | TBD |

### J. Security & cryptographic

| Asset | Status |
|---|---|
| SSL/TLS private keys for `hive.chat` | TBD — rotate under HPA certificate issuance |
| NPM publish tokens | TBD — rotate, store in HPA vault |
| Cloudflare API tokens | TBD — rotate |
| Backup encryption keys | TBD |
| Signing keys for release artifacts | TBD |

### K. Credentials to third-party APIs

| Service | Purpose | Status |
|---|---|---|
| Bitcoin block hash fetch (`blockchain.info`) | Used in ratchet + kill-switch panel selection | Free API, no credential transfer |
| IPFS pinning (Pinata / Fleek / Web3.Storage) | Mirror maintenance | TBD — enterprise accounts to HPA |
| Radicle seed node | Mirror | TBD |

### L. Intellectual property misc

| Asset | Status |
|---|---|
| Canvas 2D pixel-agents renderer (MIT-forked code) | Already MIT, no transfer needed — stays in repo |
| MetroCity characters (pixel-art assets) | TBD — license clarification with asset source |
| Hive Genesis NFT (if issued as ceremonial mint) | N/A — no NFT planned pre-genesis |

## Attestation Procedure

At genesis ceremony day:

1. This document populated with final values (no `TBD` entries).
2. ≥ 2 auditors from AUDITOR_POOL.md independently verify each row:
   - Check registrar / account page confirms HPA ownership.
   - Confirm `noemuch` personal access revoked.
   - Cross-check with the auditor's independent lookup (not using
     founder's own tools).
3. Auditors co-sign this file with GPG:
   ```
   -----BEGIN PGP SIGNATURE-----
   Auditor 1: <fingerprint>
   Auditor 2: <fingerprint>
   Attestation: "I have independently verified transfer of all listed
   assets to HPA per NORTHSTAR §13.1. `noemuch` retains no personal
   control, scheduled expiration, or revertible stake in any listed
   asset. Auditor date: YYYY-MM-DD."
   -----END PGP SIGNATURE-----
   ```
4. SHA-256 of the signed file → `PROTOCOL_PATHS.sig.anchor_files["docs/kb/IP_TRANSFER_ATTESTATION.md"]`.
5. `ratchet-phase-transition.yml` gate checks presence + valid signatures
   before applying `v1.0.0-genesis` tag.

## Post-Genesis Updates

This file is not immutable, but updates (adding new assets, re-
attesting after asset acquisition) require §5 standard RFC + fresh
auditor pair attestation.

Removal of an attested asset (e.g., sunset a social media platform) is
PERMITTED with ⅔ HPA board vote + auditor confirmation the asset is
truly decommissioned (not silently retained).

## Known Omissions

Platform-level threats outside HPA's reach (per THREAT_MODEL.md):
- GitHub platform signing keys
- Swiss legal jurisdiction itself
- Domain registrar's root certificate authority

These are out of scope for this attestation — they are fundamental to
the substrate Hive runs ON, not assets owned by Hive.

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor template created; all entries TBD pending pre-genesis IP transfer work (CLEANUP-PLAN §17, week 7) |
