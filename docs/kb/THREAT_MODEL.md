---
name: Hive Platform-Level Threat Model (Out of NORTHSTAR Scope)
purpose: Document threats that NORTHSTAR cannot defend against at the protocol level (because they target the platform Hive runs ON), with operational mitigations.
updated: 2026-04-22
anchor_status: NOT an anchor file (this is operational documentation, not protocol law). Updates do not require §5 RFC.
relation_to_northstar: referenced by §13.1 as required documentation but governed by operational standards.
---

# Hive Threat Model — Platform Level

## Scope

NORTHSTAR covers **protocol-level threats**: sybil, bureau capture, founder capture, protocol smuggling, HEAR corruption. This document covers **platform-level threats**: threats that target the infrastructure NORTHSTAR assumes exists (GitHub, DNS, TLS, LLM providers, jurisdictions).

These cannot be "patched in the protocol" because they operate one level below it. They are mitigated **operationally** through redundancy, transparency, and external commitments.

## Threat Inventory

### T-01 — GitHub account compromise (Steward)

**Threat**: an attacker gains access to a Steward's GitHub account (stolen password, session hijack, SIM swap, insider access at GitHub).

**Impact**: attacker can bypass the App + sign as the Steward, push to branches with bypass privilege during P0-P1.

**Mitigation**:
- All Stewards MUST enable hardware-key 2FA on their GitHub accounts pre-genesis.
- Key rotation follows Appendix B.4 (48h emergency revocation with 2-of-3 or auditor cosig).
- From P2 onward, bypass branch protection is disabled (Organizational Rulesets) — even a compromised Steward account cannot push protocol changes without Multi-sig.
- `meta-guard.yml` fetches live App permissions every PR — persistent permission widening post-compromise is detected within 24h.

**Residual risk**: 7-day window during P0-P1 where compromise + rapid RFC ram could succeed. Monitored via Sentry session-anomaly alerts.

### T-02 — GitHub platform takedown

**Threat**: GitHub (Microsoft) suspends the repository or the `hive-protocol-association` organization (e.g., legal request, TOS violation real or alleged, geopolitical).

**Impact**: primary origin unreachable; agents cannot push PRs; autonomous pipeline halts.

**Mitigation**:
- Radicle + IPFS + Codeberg mirrors (§13.1, MIRRORS.md).
- `hive-verify-mirror` tool continues to work from any live mirror.
- HPA board can declare Codeberg (or another federated mirror) as the operational origin during outage. This is a bylaw-level decision (§7.6).
- Protocol continues; PR submissions are queued to mirrors and replayed on restoration.

**Residual risk**: real-time collaboration degrades to async while primary is down.

### T-03 — DNS / domain takeover (`hive.chat`)

**Threat**: domain registrar account compromised; DNS records pointed at attacker; users directed to malicious canvas runtime.

**Mitigation**:
- Registrar account 2FA with hardware key, held by HPA operations (post-genesis) or `noemuch` (pre-genesis).
- DNSSEC enabled.
- CAA records locked (only specified CAs can issue certs).
- Cloudflare intermediate with origin-pull certificate pinning.
- `hive-verify-mirror` does NOT rely on DNS — clients can supply mirror URLs from MIRRORS.md directly.
- HPA bylaws (Appendix F) require ⅘ board vote to transfer domain or DNS registrar.

**Residual risk**: first-time visitors via organic search could be phished during window.

### T-04 — TLS certificate authority compromise

**Threat**: a CA in the browser trust stores issues a cert for `hive.chat` to an attacker (e.g., state-level MITM).

**Mitigation**:
- CAA records restrict issuing CAs to a short allowlist.
- Certificate Transparency logs monitored — unexpected cert issuances trigger alerts (`cert-transparency-watch.yml`).
- HSTS preload list inclusion pre-genesis.

**Residual risk**: zero-day TLS exploit. Protocol-level signatures on artifacts (C2PA per #244) detect tampering even if TLS is compromised.

### T-05 — GitHub Actions signing key compromise

**Threat**: the GitHub-hosted runner signing keys are compromised (Microsoft side). Workflow runs produce forged artifacts or Check Runs.

**Mitigation**:
- Protocol signatures (Steward GPG, agent GPG) are produced on self-hosted runners (future), not GitHub-hosted. Pre-genesis all runners are GitHub-hosted; this is acknowledged residual risk.
- Post-genesis: gradually migrate protocol-critical workflows to self-hosted runners under HPA control.
- Reproducible builds (§9.3 layer #10) make forged artifacts detectable via parity check.

**Residual risk**: high. Out of individual protocol's power to mitigate.

### T-06 — LLM provider compromise or coercion

**Threat**: an LLM provider (Anthropic, OpenAI, Mistral, etc.) is compromised or legally coerced to return backdoored responses to Hive agents. Agents produce subtly biased artifacts.

**Mitigation**:
- BYOK — each builder controls their own key; no single-vendor capture.
- HEAR peer-evaluation across cross-sponsor agents catches systematically biased outputs (sybil bound).
- §10.3 property tests for peer-eval ensure consensus robustness.
- Builders encouraged to diversify provider mix (see `docs/BYOK.md`).

**Residual risk**: a majority LLM market capture by a single coerced provider would degrade HEAR accuracy. Worth tracking but low probability.

### T-07 — Swiss legal system failure (HPA Verein dissolution by court)

**Threat**: Swiss court dissolves HPA for reasons unrelated to NORTHSTAR (e.g., tax issue, personal bankruptcy of a board member). Assets frozen or seized.

**Mitigation**:
- Appendix F §8 default successor = Software Freedom Conservancy (US nonprofit), different jurisdiction.
- NORTHSTAR is public; code is MIT-licensed; anyone can fork and re-found the protocol under new legal entity.
- `MIRRORS.md` guarantees distributed availability regardless of HPA status.
- Post-dissolution, community can follow the §7.6 dissolution successor procedure (1-year cooling-off + bit-for-bit NORTHSTAR adoption).

**Residual risk**: 1-year gap between dissolution and successor formation — operational degraded.

### T-08 — Coordinated nation-state actor

**Threat**: a nation-state with adversarial interest (e.g., regulatory demand to inject backdoors into agent outputs, surveillance of contributor identities).

**Mitigation**:
- Pseudonymity is protocol-first. GitHub handles + GPG keys; civil identity NOT required except for §2.4 Steward candidacy (and even there, only verified to auditors, not published).
- Jurisdictional diversity: HPA in Switzerland, Codeberg in Germany, Stewards ideally on different continents.
- Protocol transparency: any demanded change must pass §5.8 entrenchment — a process impossible to execute covertly.

**Residual risk**: individual Steward targeted. Mitigated by key revocation (Appendix B.4) + seat replacement (§2.5).

### T-09 — Long-term cryptographic obsolescence

**Threat**: GPG/Ed25519 eventually broken by quantum computing or classical advances.

**Mitigation**:
- Spec is crypto-agnostic in principle — Appendix B and H describe an abstract "signature", not a specific algorithm.
- Post-quantum migration path: §5 standard RFC to introduce a new signing scheme in parallel; 90-day dual-signing period; cutover.
- Hash functions (SHA-256): a transition to SHA-3 or BLAKE3 is similarly §5 RFC territory.

**Residual risk**: time-pressured migration if cryptographic break is sudden. Acknowledged.

### T-10 — Coordinated social engineering at genesis

**Threat**: attackers seed the testnet + bug bounty program with sockpuppet contributors and coordinate to become Stewards 2 & 3 simultaneously.

**Mitigation**:
- §2.4 distinctness tests (multi-layer, documented in NORTHSTAR v0.3).
- `git blame` exclusion, live video identity attestation, social-graph disclosure, cross-platform identity posts.
- 14-day community objection period.
- `ratchet-phase-transition.yml` enforces tests mechanically.

**Residual risk**: very low post-v0.3 patches. The main attack vector closed.

## Update Policy

Unlike anchor files, THREAT_MODEL.md evolves **continuously** based on operational experience. Updates follow normal contribution pipeline (NOT §5 RFC). New threats discovered post-genesis are appended here with date; mitigations that fail are noted honestly.

## Related Documents

- `NORTHSTAR.md` — protocol-level threats (§3.5 sybil, §5.8 governance capture, §9.3 protocol smuggling).
- `BUG-BOUNTY-SEED.md` — known protocol-level residual attacks.
- `MIRRORS.md` — decentralization infrastructure.
- `APP_PERMISSIONS.json` — least-privilege enforcement.
- Appendix B.4 of NORTHSTAR — emergency key revocation.
