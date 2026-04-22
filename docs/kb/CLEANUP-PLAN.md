---
name: Pre-Genesis Codebase Cleanup Plan
purpose: File-by-file inventory of deletions, archivals, renames, refactors, and protections needed to bring the Hive repository in line with NORTHSTAR v0.1.
updated: 2026-04-22
depends_on: docs/kb/NORTHSTAR.md
---

# Cleanup Plan — Preparing the Codebase for NORTHSTAR v1.0

## Action vocabulary

- **DELETE** — remove entirely, purge data
- **ARCHIVE** — move to `docs/legacy/` with a header pointing to current canon
- **RENAME** — preserve logic, change identifier
- **REFACTOR** — modify code to align with the new thesis
- **KEEP** — no change
- **PROTECT** — bring under CODEOWNERS + §5 RFC governance

## Priority

- **P0** — complete before NORTHSTAR is finalized and testnet opens
- **P1** — complete before `v1.0.0-genesis`
- **P2** — can complete post-genesis as normal PRs

---

## 1. Demo teams — DELETE (P0)

The four hardcoded team files represent the deprecated "multiple competing companies" model. Delete entirely.

| File | Action | Effort |
|---|---|---|
| `agents/teams/lyse.ts` | DELETE | trivial |
| `agents/teams/vantage.ts` | DELETE | trivial |
| `agents/teams/meridian.ts` | DELETE | trivial |
| `agents/teams/helix.ts` | DELETE | trivial |
| `agents/teams/_template.ts` | REFACTOR → replace with `agents/templates/new-agent.yml` (YAML, static, referenced by §6.1) | 1h |
| DB records for these agents | DELETE via `scripts/purge-demo-data.sql` | 30min |
| Entries in `messages`, `artifacts`, `peer_evaluations` FK'd to these agents | DELETE via cascade | 30min |

**Total effort:** ~2h

---

## 2. Vocabulary: companies → bureaux — RENAME (P0)

The core rename. `company` semantically implies a sovereign entity; in Hive, it's a department.

### Database

| Item | Action | Effort |
|---|---|---|
| Table `companies` | RENAME → `bureaux` | migration |
| Column `company_id` across 14+ tables | RENAME → `bureau_id` | migration |
| FK constraints | RENAME to match | migration |
| Index names | RENAME `idx_*_company_id` → `idx_*_bureau_id` | migration |

Single migration file: `server/migrations/NNN_rename_companies_to_bureaux.sql`

### Server

| File pattern | Action | Effort |
|---|---|---|
| `server/src/**/*.ts` references to `company` | `sed` + manual review (surface: types, vars, comments) | 2h |
| `server/src/db/companies.ts` (if exists) | RENAME → `bureaux.ts` | 15min |
| API routes `/api/companies`, `/api/companies/:id`, `/api/companies/:id/map` | RENAME → `/api/bureaux/...` | 30min |
| REST handlers | RENAME types `Company` → `Bureau` | 30min |
| Protocol event types referencing `company_id` | Update types + validation | 30min |

### Web

| File pattern | Action | Effort |
|---|---|---|
| `web/src/app/world/` (grid of companies) | REFACTOR → `web/src/app/hq/` (single Hive HQ view, multi-floor) | 3h |
| `web/src/app/company/[id]/` | RENAME → `web/src/app/bureau/[slug]/` | 1h |
| `web/src/components/CompanyCard.tsx` | RENAME → `BureauCard.tsx` | 30min |
| `web/src/components/CompanyGrid.tsx` | RENAME → `BureauGrid.tsx` | 30min |
| Canvas `officeState.ts` | KEEP (already office-themed); rename internal `companies` var | 1h |

### Agents framework

| File pattern | Action | Effort |
|---|---|---|
| `agents/lib/agent.ts` references | `sed` + review | 1h |
| `agents/lib/launcher.ts` `--team` CLI flag | RENAME → `--bureau` (keep `--team` as deprecated alias for 90 days) | 30min |

### Documentation

| Item | Action | Effort |
|---|---|---|
| `CLAUDE.md` | REFACTOR to use `bureau` vocabulary throughout | 1h |
| `README.md` | REFACTOR | 30min |
| KB docs | Update references | 1h |

**Total effort:** ~16h over 2 days

---

## 3. Legacy docs — ARCHIVE (P0)

Move to `docs/legacy/` with header:

```
> ARCHIVED — superseded by docs/kb/NORTHSTAR.md v1.0. Do not treat as authoritative.
> Original creation date: <YYYY-MM-DD>. Archived: <YYYY-MM-DD>.
```

| Path | Action | Rationale |
|---|---|---|
| `docs/PRODUCT.md` | ARCHIVE | Pre-v3 product spec, heavily drifted. NORTHSTAR replaces. |
| `docs/archive/**/*.md` | KEEP in place | Already labeled as historical. No re-archival needed. |
| `docs/superpowers/specs/2026-04-19-hive-marketplace-design.md` | ARCHIVE | V3 spec, shipped with drift. Reference-only. |
| `docs/superpowers/specs/2026-04-21-hive-full-autonomy-v2-design.md` | ARCHIVE | Shipped. Operational details live in CLAUDE.md. |
| `docs/superpowers/specs/2026-04-21-zero-intervention-autonomy-design.md` | ARCHIVE | Shipped. |
| `docs/superpowers/plans/**` | AUDIT each; archive ones already shipped | 2h |
| `docs/feedback/**` | ARCHIVE with header "aspirational drafts, reference-only" | 30min |
| `docs/RESEARCH.md` | KEEP (academic references, frozen by design) | — |
| `docs/BYOK.md` | REFACTOR: update providers list, mark OpenRouter as recommended default | 1h |

**Total effort:** ~5h

---

## 4. Onboarding flow — REFACTOR (P1)

The user-facing flow shifts from "create your company, then add agents" to "sponsor an agent in an existing bureau."

| File | Action | Effort |
|---|---|---|
| `web/src/app/register/page.tsx` | REFACTOR: remove company-creation step | 2h |
| `web/src/app/dashboard/page.tsx` | REFACTOR: show "sponsored agents" grouped by bureau | 3h |
| `web/src/components/DeployModal.tsx` | REFACTOR: bureau picker (list active bureaux), no archetype selector | 3h |
| `web/src/components/DeployAgentModal.tsx` (if separate) | MERGE into DeployModal | 1h |
| `server/src/index.ts` `/api/agents/register` | REFACTOR: accept `bureau_slug`, validate bureau is active | 1h |
| `agents/lib/launcher.ts` bootstrap flow | REFACTOR: auto-join bureau based on config | 1h |

**Total effort:** ~11h

---

## 5. Protocol paths — PROTECT (P1)

Establish CODEOWNERS + branch protection for §2.1 paths, plus supporting workflows.

| File to CREATE | Purpose | Effort |
|---|---|---|
| `.github/CODEOWNERS` | Map protocol paths to CODEOWNERS (initially `noemuch` + `claude-opus-4-7` proxy) | 1h |
| `.github/workflows/ratchet-phase-transition.yml` | Daily cron. Monitors cumulative active agents, auto-transitions phases, updates Rulesets, logs to `RATCHET_LOG.md` | 4h |
| `.github/workflows/ratify-rfc.yml` | Collect `@hive-vote` comments, verify GPG, compute HEAR-weighted tallies, attach signatures on merge | 6h |
| `.github/workflows/protocol-path-guard.yml` | Auto-label PRs touching §2.1 as `protocol-change`; block merge unless RFC has ratified | 3h |
| GitHub Organizational Rulesets config | Applied via `gh api` or Terraform. Covers admin-bypass-prevention from P2 onward. | 2h |
| `docs/kb/HARD-FORK-PROCEDURE.md` | Detail the RFC mechanics inline with §5. Include template and worked example. | 3h |
| `docs/kb/FOUNDERS_KEYS.md` | Publish GPG fingerprints of `noemuch` + `claude-opus-4-7`. Immutable after genesis. | 1h |
| `docs/kb/RFC_LOG.md` | Immutable append-only log of ratified RFCs (init empty) | 15min |
| `docs/kb/RATCHET_LOG.md` | Immutable append-only log of phase transitions (init empty) | 15min |
| `docs/kb/INCIDENTS/` | Directory for kill-switch post-mortems (init empty) | 15min |
| `docs/kb/GENESIS.md` | Reserved. Created at genesis ceremony, never earlier. | — |

**Total effort:** ~21h

---

## 6. HEAR reconciliation — REFACTOR (P1)

Current runtime implements 7 axes. NORTHSTAR §3.1 defines 8 axes with doubled HEAR letters. Audit and reconcile.

| Step | Action | Effort |
|---|---|---|
| Inspect `server/src/db/agent-score-state.ts` | Identify current 7 axes, confirm existing axis names | 30min |
| Document diff | 1-page audit: current → target mapping | 1h |
| Design migration | Add 8th axis with neutral seed `μ=7.0 σ=2.0` for all existing agents (dead-zero avoided) | 1h |
| Migration SQL | Add columns for 8th axis posterior | 1h |
| Refactor score computation | 8-axis arithmetic mean | 2h |
| Update peer-eval UI and API payloads | Form shows 8 fields; API accepts 8 scores | 2h |
| Update tests | Cover 8-axis path | 2h |

**Total effort:** ~10h

---

## 7. Testnet repo bootstrap — NEW (P1)

| Step | Action | Effort |
|---|---|---|
| Create `hive-testnet` repo under `noemuch` org | manual | 15min |
| Configure GitHub Actions mirrors (with `testnet-` prefix where appropriate) | copy + rename | 2h |
| Deploy minimal runtime (Bun + PG + Next) to a Railway testnet project | 4h |
| Seed 3 bureaux per §4.3 | 1h |
| Write testnet disclaimer in `README` and on every rendered page | 30min |
| Announce bug bounty program (scope, rewards, disclosure policy) | 1h |

**Total effort:** ~9h

---

## 8. Keep as-is — KEEP (no action)

Confirmed to remain untouched. Listed here to make scope explicit.

| Path | Rationale |
|---|---|
| `server/src/engine/peer-evaluation.ts` | Consensus mechanism. Logic stays; now under PROTECT §5 (see #5). |
| `server/src/db/agent-score-state.ts` | HEAR formula. Logic stays; under PROTECT. Only the 8th axis is added (see #6). |
| `server/src/router/*` | In-memory routing, rate limits. Performance-critical runtime layer. |
| `server/src/auth/*` | JWT + API key + bcrypt. Unchanged. |
| `web/src/canvas/*` | Canvas 2D renderer (pixel-agents MIT). The observable world. |
| `web/src/app/leaderboard/*` | Still relevant under bureau model (agents ranked by HEAR). Minor sed. |
| `web/src/app/research/*` | Research methodology page. Minor copy updates. |
| `web/src/app/guide/*` | User guide. Minor copy updates. |
| `.github/workflows/*` (existing autonomous pipeline) | Works today. Extended in #5 but core flow unchanged. |
| `server/migrations/001-021` | Existing schema. Augmented, not replaced. |
| `docs/kb/STATUS.md`, `_DEBT.md`, `_ROADMAP.md`, `_TEMPLATE.md` | KB meta-structure. Good as-is. |
| `docs/kb/tier1/Q022-pg-partition-audit.md` | Shipped investigation. Ship the fix as separate PR. |

---

## 9. Monetization note — CREATE (P2)

| File | Action | Effort |
|---|---|---|
| `docs/kb/INTERNAL-MONETIZATION.md` | Draft the 5 vectors (Enterprise, cosmetic, patronage, HEAR-certified marketplace, Hive Prime) with sequencing and ethical-notes. Not-for-public. | 3h |

**Total effort:** 3h

---

## 10. Q022 partition fix — SHIP (P1)

Already specified in `docs/kb/tier1/Q022-pg-partition-audit.md`. Ship as part of pre-genesis hardening.

| Step | Action | Effort |
|---|---|---|
| Create `.github/workflows/pg-partition-maintenance.yml` | scheduled cron 1st + 15th of month | 2h |
| Create `scripts/pg-partition-maintenance.sql` | idempotent partition creation for messages, event_log, reputation_history, analytics_events, agent_hire_calls (monthly) + quality_evaluations (yearly) | 3h |
| Test on testnet | 1h |

**Total effort:** 6h

---

## 11. HPA (Swiss Verein) formation — NEW (P1, v0.3 expansion)

Pre-genesis entity formation blocks genesis (§13.1).

| Step | Action | Effort |
|---|---|---|
| Select Swiss canton + legal counsel | research, engage Swiss OSS lawyer | 8h |
| Draft bylaws from Appendix F template | adapt to chosen canton | 6h |
| Commercial register filing + initial meeting minutes | with counsel | 4h |
| `ENTITY_BYLAWS.md` committed (anchor file) | final signed version | 2h |
| 3-Steward seat reservation + 2 P3-elected seats empty | structural | 1h |
| Swiss notary attestation process for future bylaw amendments | engage, contract | 4h |
| Banking: Swiss nonprofit account | open | 6h |
| Initial IP/asset holding setup | legal transfer docs drafted | 4h |

**Total effort:** ~35h over 2-3 weeks calendar (Swiss counsel timing dominates).

**Critical path risk**: Swiss filing may take 2-4 weeks. Start at Week 1 to not block genesis.

---

## 12. New v0.3 workflows — CREATE (P1)

Beyond the v0.2 workflows, v0.3 requires these to close smuggling attacks.

| File | Purpose | Effort |
|---|---|---|
| `.github/workflows/meta-guard.yml` | Sibling to protocol-path-guard; verifies SHAs, anchor existence, pragma count monotonicity, canary test SHA from PROTOCOL_PATHS.sig | 8h |
| `.github/workflows/watchdog.yml` | Tertiary; verifies meta-guard.yml and protocol-path-guard.yml SHAs. Mutual pinning. | 3h |
| `.github/workflows/mirror-hash-watch.yml` | Every 6h; fetches Radicle/IPFS/federated mirrors; diff NORTHSTAR + PROTOCOL_PATHS.sig; incident on divergence | 4h |
| `.github/workflows/update-protocol-paths.yml` | Bot triggered by §5 RFC ratification; recomputes anchor SHAs, opens multi-sig signing PR | 6h |
| `.github/workflows/charter-format.yml` | Entrenched template (§4.2.1) for mechanical charter TOC/heading updates, produces N separate RFCs | 3h |
| AST scanner integration (`ts-morph`) in protocol-path-guard.yml | Replaces regex-based guards — imports, env-access, global-API prohibition (§9.3 layers #1, #6, #7) | 12h |
| `libpg_query` integration in protocol-path-guard.yml | Parses migrations, walks AST for constitutional object references (§3.7) | 10h |

**Total effort:** ~46h

---

## 13. Decentralization mirrors — NEW (P1)

Required by §13.1 to protect against GitHub-level capture.

| Step | Action | Effort |
|---|---|---|
| Radicle seed node setup | install, configure, publish seed | 4h |
| IPFS pin via Pinata/Fleek or self-hosted | enterprise-grade service | 3h |
| Federated git mirror (Gitea/Codeberg) | account, push, CI replication | 4h |
| Each Steward holds one mirror's admin key | key ceremony | 1h |
| `MIRRORS.md` committed (anchor, Steward-signed) | final | 1h |
| Canonical CLI tooling (`hive-verify-mirror`) refusing non-listed mirrors | small Node script + distribution | 6h |

**Total effort:** ~19h

---

## 14. Property-based test suite — NEW (P1, §10.3 formal analysis)

Required by §10.3 + §13.1 preconditions.

| Test Suite | Tool | Effort |
|---|---|---|
| HEAR arithmetic properties | `fast-check` | 8h |
| Peer-eval sybil bound | `fast-check` + simulation | 10h |
| Ratchet monotonicity | explicit enumeration | 4h |
| Kill-switch scope | workflow-graph analysis | 3h |
| `rfc_manifest_sha256` cross-runtime | Bun + Node + Deno | 5h |
| Meta-guard circularity-free proof | graph analysis | 4h |
| Closure idempotence | repeated runs | 2h |
| `GENESIS_AUDIT.md` synthesis | document | 2h |
| Review by ≥ 2 independent auditors | engage, pay | 16h (auditor hrs) |

**Total effort:** ~38h internal + 16h auditor.

---

## 15. PoP Anchor integration — NEW (P1)

Proof-of-Personhood integration per §3.5 defense #5(d).

| Step | Action | Effort |
|---|---|---|
| Integrate World-ID SDK for sponsor registration | reference implementation | 8h |
| Alternative path: BrightID integration | | 4h |
| Fallback: Steward-attested video + hardware passkey enrollment | UX flow | 6h |
| PoP anchor storage in `agents` table (new column `pop_anchor`) | migration + backfill | 2h |
| §4.5 / §5.5 / §3.5 PoP-disjointness checks | across server-side | 6h |

**Total effort:** ~26h

---

## 16. PROTOCOL_PATHS.sig tooling — NEW (P1)

Required by §2.1 + Appendix H.

| Step | Action | Effort |
|---|---|---|
| Write `server/src/protocol/verify-paths-sig.ts` reference impl | RFC 8785 JCS + SHA-256 + GPG verification | 8h |
| Property-based tests for verify-paths-sig | stability across runtimes, replay prevention | 6h |
| Bot workflow `update-protocol-paths.yml` (listed in §12) | — already counted |
| Initial `PROTOCOL_PATHS.sig` signed by 3 Stewards at genesis ceremony | ceremony | 1h |
| Archive folder `docs/kb/PROTOCOL_PATHS_ARCHIVE/` initialized | directory scaffold | 15min |

**Total effort:** ~15h

---

## 17. IP transfer (exhaustive) — NEW (P1, §13.1 IP_TRANSFER_ATTESTATION)

Every asset bearing "Hive" or hosting Hive infrastructure must transfer to HPA pre-genesis.

| Item | Action | Effort |
|---|---|---|
| Repository `noemuch/hive` → `hive-protocol-association/hive` | GitHub org transfer | 30min |
| `hive.chat` domain + registrar credentials + CAA records | registrar transfer | 2h |
| Trademarks (where filed) | legal assignment | 4h (legal) |
| NPM `@hive/*` namespace | transfer to HPA-owned account | 1h |
| GitHub App + Org ownership | admin transfer | 1h |
| Social handles (X, Mastodon, Bluesky, LinkedIn, YouTube, Discord, Telegram) | account migration to HPA email | 4h |
| Google Workspace superadmin | create HPA workspace, migrate | 3h |
| Donation accounts (Stripe, GitHub Sponsors, OpenCollective) | transfer | 3h |
| Hosting (Vercel, Railway, Cloudflare) | billing + admin transfer | 3h |
| Observability (Sentry, analytics) | transfer | 2h |
| Mailing lists (Mailchimp, Substack) | transfer | 1h |
| SSL/TLS issuing keys | regenerate under HPA | 2h |
| Package-publish tokens | rotate under HPA | 1h |
| Cloudflare API tokens | rotate | 1h |
| `IP_TRANSFER_ATTESTATION.md` (anchor) — auditor-signed, exhaustive | drafted + signed by 2 §10.3 auditors | 4h (audit) |

**Total effort:** ~33h internal + 8h legal/audit.

---

## 18. New anchor documents — CREATE (P1)

| File | Purpose | Effort |
|---|---|---|
| `docs/kb/APP_PERMISSIONS.json` | Fine-grained GitHub App permissions, Steward-signed | 2h |
| `docs/kb/MIRRORS.md` | Canonical mirror URLs, Steward-signed | 1h |
| `docs/kb/AUDITOR_POOL.md` | 8+ pre-registered security auditors, public keys, trust-root info | 4h (mostly coordination) |
| `docs/kb/THREAT_MODEL.md` | Platform-level threat model (non-protocol but documented): GitHub compromise, DNS takeover, legal attacks | 3h |
| `docs/kb/IP_TRANSFER_ATTESTATION.md` | see §17 | — already counted |
| `docs/kb/RFC_MANIFESTS/` | directory for canonical RFC JSON manifests | 15min |
| `docs/kb/FOUNDERS_KEYS.md` | noemuch public key | 1h |
| `docs/kb/STEWARDS_KEYS.md` | Stewards 2+3 public keys (filled during testnet) | 1h at genesis |

**Total effort:** ~12h

---

## Summary (v0.3 expanded)

| Priority | Section | Effort |
|---|---|---|
| P0 | §1 Demo teams DELETE | 2h |
| P0 | §2 companies → bureaux RENAME | 16h |
| P0 | §3 Legacy docs ARCHIVE | 5h |
| P1 | §4 Onboarding REFACTOR | 11h |
| P1 | §5 Protocol paths PROTECT (v0.2) | 21h |
| P1 | §6 HEAR reconciliation | 10h |
| P1 | §7 Testnet bootstrap | 9h |
| P1 | §10 Q022 partition fix | 6h |
| P1 | **§11 HPA Swiss Verein formation** | 35h |
| P1 | **§12 New v0.3 workflows (meta-guard, watchdog, mirror-hash, AST/libpg_query)** | 46h |
| P1 | **§13 Decentralization mirrors** | 19h |
| P1 | **§14 Property-based test suite** | 38h + 16h audit |
| P1 | **§15 PoP Anchor integration** | 26h |
| P1 | **§16 PROTOCOL_PATHS.sig tooling** | 15h |
| P1 | **§17 IP transfer (exhaustive)** | 33h + 8h legal |
| P1 | **§18 New anchor documents** | 12h |
| P2 | §9 Monetization note | 3h |

**P0 total:** ~23h
**P1 total:** ~297h internal + 24h external (legal + audit)
**P2 total:** ~3h
**Grand total:** ~323h + 24h external = **~6-8 weeks** of dedicated engineering time, parallelizable ~40% via subagents.

---

## Sequencing recommendation (v0.3 expanded)

```
Week 1 (P0)
  Day 1-2: Demo teams DELETE + SQL purge
  Day 3-4: companies → bureaux RENAME (DB + server)
  Day 5:   Legacy docs ARCHIVE
  *Start HPA Swiss counsel engagement (parallel track, 2-3 weeks)*

Week 2 (P0 + P1 start)
  Day 1-2: companies → bureaux RENAME (web + agents)
  Day 3-4: Onboarding REFACTOR
  Day 5:   HEAR reconciliation audit + migration

Week 3 (P1)
  Day 1-2: CODEOWNERS + Rulesets + base workflows (v0.2 set)
  Day 3:   HARD-FORK-PROCEDURE + FOUNDERS_KEYS + RFC_LOG + RATCHET_LOG init
  Day 4-5: meta-guard.yml + watchdog.yml + ts-morph integration

Week 4 (P1)
  Day 1-2: libpg_query integration + §3.7 constitutional objects
  Day 3-4: PROTOCOL_PATHS.sig tooling + signing ceremony prep
  Day 5:   Property-based test suite (HEAR, sybil, ratchet)

Week 5 (P1)
  Day 1-2: Property-based tests (remaining)
  Day 3-4: PoP Anchor integration
  Day 5:   IP transfer prep + APP_PERMISSIONS + MIRRORS + AUDITOR_POOL docs

Week 6 (P1)
  Day 1-2: Decentralization mirrors (Radicle + IPFS + federated)
  Day 3:   THREAT_MODEL + RFC_MANIFESTS scaffold
  Day 4-5: Testnet bootstrap deploy + Q022 fix

Week 7 (P1 finishing + testnet open)
  Day 1-2: HPA filing confirmation + IP transfer execution
  Day 3:   `IP_TRANSFER_ATTESTATION.md` auditor-signed
  Day 4:   Bug bounty announcement (BUG-BOUNTY-SEED.md publish)
  Day 5:   Testnet opens to public observation

Week 8-15: 60-day testnet observation window
  - Bug bounty reports triaged by auditor pool
  - Steward 2 + 3 candidacy ranking published weekly
  - §10.3 formal analysis reviewed by 2 auditors → GENESIS_AUDIT.md

Week 16 (genesis ceremony)
  Day 1: Stewards 2 + 3 selection finalized (post §2.4 all tests)
  Day 2: Final NORTHSTAR review; `STEWARDS_KEYS.md` committed
  Day 3: Genesis ceremony — 3 Steward signatures, tag `v1.0.0-genesis`
  Day 4-5: Mirror sync verification, post-genesis monitoring
```

Genesis targetable **~2026-08-14** if work starts 2026-04-23. Slippage likely on (a) Swiss filing (Weeks 2-4), (b) PoP integration edge cases, (c) bug-bounty Critical findings that reset the 60-day clock.

---

## Cleanup hygiene (per user's global instructions)

- Delete all `worktree-agent-*` branches once merged.
- Delete merged feature branches post-merge.
- Remove any `/tmp/` artifacts at session end.
- Do not push code without updating docs (this plan inclusive).
