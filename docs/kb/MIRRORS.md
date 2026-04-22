---
name: Canonical Hive Repository Mirrors
purpose: Steward-signed registry of authoritative mirrors. Tools refuse mirrors not listed here. `mirror-hash-watch.yml` polls every 6h for divergence.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
---

# Hive Protocol — Canonical Mirrors

## Role in the Protocol

Per NORTHSTAR §13.1, Hive maintains **3 independent mirrors** of the repository to prevent GitHub-level capture (takedown, account suspension, platform compromise). Each mirror's admin key is held by **one** of the three Stewards, so no single Steward can silently diverge the canonical state without the others detecting.

`mirror-hash-watch.yml` runs every 6 hours and compares SHA-256 of `NORTHSTAR.md` and `PROTOCOL_PATHS.sig` across all mirrors against the GitHub-hosted origin. Divergence → `priority:critical` incident issue + public banner on `hive.chat`.

Client tooling (`hive-verify-mirror`) refuses to pull from any URL not listed here.

## Canonical Origin

- **Host**: GitHub
- **URL**: `https://github.com/hive-protocol-association/hive`
- **Default branch**: `main`
- **Status**: canonical. This is the mutable reference — mirrors shadow it.

## Mirrors

### Mirror 1: Radicle

- **Host**: Radicle (peer-to-peer git via IPFS-adjacent stack)
- **Project URN**: `rad:<TO-BE-GENERATED-AT-GENESIS>`
- **Seed node**: `<TO-BE-ASSIGNED-AT-GENESIS>`
- **Admin key holder**: Steward 1 (`noemuch`)
- **Sync frequency**: every 6h via `mirror-sync.yml`
- **Discovery**: published to Radicle network at tag time

### Mirror 2: IPFS (pinned)

- **Host**: IPFS network, pinned via Pinata (enterprise SLA)
- **CID of latest signed NORTHSTAR**: `<TO-BE-GENERATED-AT-GENESIS>`
- **CID of PROTOCOL_PATHS.sig**: `<TO-BE-GENERATED-AT-GENESIS>`
- **Admin key holder**: Steward 2
- **Sync frequency**: every 6h via `mirror-sync.yml`
- **Pinning service fallback**: Fleek + Web3.Storage (redundant pins, different financial sponsors)

### Mirror 3: Federated Git

- **Host**: Codeberg (Gitea-based, European non-profit, jurisdiction-diverse from GitHub)
- **URL**: `https://codeberg.org/hive-protocol-association/hive`
- **Default branch**: `main`
- **Admin key holder**: Steward 3
- **Sync frequency**: every 6h via `mirror-sync.yml`
- **Pull-request-equivalent discovery**: Codeberg native PRs proxied as read-only to `origin/main` — PRs are NOT accepted on this mirror; it's read-mirror only.

## Divergence Policy

If `mirror-hash-watch.yml` detects divergence between any mirror and origin:

1. Incident issue opened on `origin` with `priority:critical` + `source:mirror-watch`.
2. Public banner posted on `hive.chat` homepage within 1 hour.
3. `STEWARDS_KEYS.md` consulted — the Steward holding the divergent mirror's key is notified.
4. **If intentional** (e.g., emergency publication during GitHub outage): Steward publishes a signed statement on ≥ 2 independent channels, cosigned by at least one other Steward. Incident closed.
5. **If unintentional / silent**: §8.4 Emergency Response Panel investigation. If 5-of-7 rule adversarial divergence → Steward key revoked per Appendix B.4, seat transfers per §2.5.

## Client Verification

The canonical CLI tool `hive-verify-mirror`:

1. Fetches `MIRRORS.md` from origin (GitHub).
2. Verifies Steward signature on the file (GPG).
3. Pulls NORTHSTAR.md + PROTOCOL_PATHS.sig from each listed mirror.
4. Verifies all three mirrors agree on SHA-256.
5. Verifies PROTOCOL_PATHS.sig signatures against published Steward keys.
6. Exits 0 only if all checks pass. Any divergence → exit 1 + human-readable report.

No mirror listed here is authoritative on its own. The canonical state is the agreement between all three mirrors + origin.

## Revocation and Rotation

- A mirror may be paused (`status: paused`) by the Steward holding its admin key, or by ⅔ Steward vote.
- A new mirror replacing a paused one requires: §5 standard RFC (not expedited; this is governance infrastructure), 14-day observation on testnet, and Steward signing ceremony.
- No mirror is permanent by name. The protocol is hosted on whatever 3 mirrors the Stewards can verify at any given time; this file is the current snapshot.

## Genesis Procedure

At the genesis ceremony (§13.2):

1. Repository content tagged `v1.0.0-genesis` on GitHub origin.
2. Radicle URN generated, initial push from origin, Steward 1 holds admin key.
3. IPFS CID computed from tagged tree, pinned by Pinata under HPA billing, Steward 2 holds admin key.
4. Codeberg mirror initialized, Steward 3 holds admin key.
5. This file (MIRRORS.md) updated with final URNs/CIDs/URLs.
6. All three Stewards GPG-sign this file.
7. SHA-256 of signed file → PROTOCOL_PATHS.sig.
8. Initial `mirror-hash-watch.yml` run passes (baseline).

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created (mirrors TBD at genesis) |
