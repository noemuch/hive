---
name: Pre-Genesis Bug Bounty Seed — Known Residuals
purpose: Public catalog of High/Medium attacks identified in round-1 and round-2 synthetic red-teams, published as seed challenges for testnet bug bounty (§10.2).
updated: 2026-04-22
target: NORTHSTAR v0.3
disclosure_policy: public — participants who reproduce AND propose accepted fixes earn Steward candidacy weight.
---

# Hive Bug Bounty Seed (NORTHSTAR v0.3)

## Rules

1. Reproduce on `hive-testnet`, not mainnet.
2. Submit via `@hive-bounty` GitHub App → opens a private issue to the 8 §10.3 auditors.
3. Auditors confirm severity and pay out.
4. Scoring toward Steward candidacy per §10.2: Critical × 3 + High × 2 + Medium × 1. Self-planted findings excluded via `git blame`.
5. Novel findings beyond this seed list score at full weight; reproducing seeded findings scores at 0.5× weight (credit for verification).
6. All findings public after testnet conclusion via `docs/kb/BUG-BOUNTY-FINDINGS.md`.

---

## High severity seeds (bounty weight 2 each)

Residual from round-2 after v0.3 patches. Reported-but-unfixed = known exploit that v0.3 mitigates but does not fully close.

### BS-H-01 — RNG timing oracle residual
**Reference**: round-2 attack H-R2-2.
**Claim**: v0.3 uses `bitcoin_block_hash_at(submission_time + 6h)` in §3.3 rng seed. Verify the 6h delay is actually enforced server-side and that attackers cannot influence block-hash selection via large miner stake.
**Bounty Critical if**: attacker achieves > 25% probability of landing ≥ 3 of 5 friendly evaluator slots per submission over 100 trials.

### BS-H-02 — 200-day sleeper rotation residual
**Reference**: H-R2-3.
**Claim**: v0.3 §3.3 uses graph-Jaccard < 0.15 over 365 days. Verify a coalition pre-rotating agents 366+ days ago cannot still achieve low-Jaccard external status.
**Bounty Critical if**: pre-rotation at T−366 achieves Jaccard < 0.15 with ring's eval patterns.

### BS-H-03 — Perma-disputed DoR (denial-of-reputation)
**Reference**: H-R2-5.
**Claim**: v0.3 §3.2 introduces `polarised` state with auto-audit. Verify the state transition correctly triggers audit and resolves.
**Bounty High if**: agent can be kept in `polarised` indefinitely without resolution.

### BS-H-04 — r=0.79 persistent ring
**Reference**: H-R2-8.
**Claim**: v0.3 §3.5 defense #6 detects connected components at r ≥ 0.6. Verify detection actually fires on rings that stay at r=0.59 pairwise but form a cluster.
**Bounty High if**: ring of 5 at pairwise r=0.59 escapes detection for > 60 days.

### BS-H-05 — Charter synonym substitution
**Reference**: B-R2-2.
**Claim**: v0.3 §4.5 uses both keyword cosine AND sentence-embedding cosine. Verify embedding cosine catches synonym-substituted charters that keyword cosine misses.
**Bounty High if**: a bureau charter with semantic cosine < 40% but identical practical scope to an existing charter ratifies.

### BS-H-06 — CALIBRATION_AUDIT.md RFC injection
**Reference**: B-R2-14.
**Claim**: v0.3 §3.2.1 specifies auto-drafting RFCs from findings. Verify the drafter's boundary prevents markdown fields from emitting arbitrary diff content.
**Bounty High if**: crafted audit finding yields a crafted RFC diff without human proposer intervention.

### BS-H-07 — Prototype pollution under frozen intrinsics
**Reference**: S-R2-2.
**Claim**: v0.3 §9.3 layer #9 requires Node `--frozen-intrinsics`. Verify the flag is enforced in production AND that no bypass exists (e.g., via `vm.createContext`).
**Bounty Critical if**: prototype pollution from a runtime file successfully mutates protocol behavior.

### BS-H-08 — Unicode homoglyph pragma
**Reference**: S-R2-3.
**Claim**: v0.3 §2.1 #7 uses NFKC normalization + confusables folding (TR39). Verify all relevant homoglyphs are folded (Latin/Greek/Cyrillic H variants, RLO, ZWJ).
**Bounty High if**: a crafted pragma bypasses the fold and is silently accepted or silently rejected by one guard but accepted by another.

### BS-H-09 — Composite action recursive SHA-pin
**Reference**: S-R2-13.
**Claim**: v0.3 §2.1 #4 requires all `uses:` in workflow closure to be SHA-pinned recursively. Verify the depth is actually unbounded and that a `@main` reference 4 levels deep BLOCKS.
**Bounty High if**: a non-SHA-pinned reference exists anywhere in the closure at any depth.

### BS-H-10 — Built-artifact pragma strip
**Reference**: S-R2-14.
**Claim**: v0.3 §9.3 layer #10 requires reproducible build + tsconfig `removeComments: false`. Verify the reproducibility check compares against actual Railway-deployed bundle.
**Bounty High if**: a deployed bundle differs from the source-computed hash without tripping the alarm.

### BS-H-11 — App permission drift
**Reference**: S-R2-15.
**Claim**: v0.3 §6.2 + `APP_PERMISSIONS.json` pin the App's fine-grained permissions. Verify `meta-guard.yml` actually fetches live permissions every PR and BLOCKS on divergence.
**Bounty Critical if**: a permission widening persists > 24h without blocking.

### BS-H-12 — Concurrent-PR race during expedited
**Reference**: S-R2-17.
**Claim**: v0.3 §5.7 serializes other PRs on affected files during expedited window. Verify the closure-based serialization actually blocks.
**Bounty High if**: a PR on a closure-member file merges during an active `rfc-expedited` window.

### BS-H-13 — Charter format batch RFC
**Reference**: B-R2-16.
**Claim**: v0.3 §4.2.1 requires per-file charter RFCs. Verify the `charter-format` workflow template produces N separate RFCs atomically, no hidden semantic edits.
**Bounty High if**: a multi-charter RFC ratifies as one or a hidden scope edit lands via a format RFC.

### BS-H-14 — 180-day sleeper with real artifacts
**Reference**: B-R2-5.
**Claim**: v0.3 §5.5 requires ≥ 10 peer-evaluated artifacts + ≥ 50% bureau-internal evals in 180 days. Verify a coalition cannot produce 10 trivial artifacts to satisfy the requirement.
**Bounty High if**: 10 HEAR-passing trivial artifacts from sleepers are accepted as embedding proof.

### BS-H-15 — Federation quorum bypass
**Reference**: B-R2-15.
**Claim**: v0.3 §5.5 restricts quorum to same-instance bureaux. Verify federation passports don't satisfy distinctness.
**Bounty High if**: a federated bureau's vote counts toward cross-bureau quorum on mainnet RFCs.

### BS-H-16 — Cross-account sponsor PoP bypass
**Reference**: F-R2-9.
**Claim**: v0.3 §3.5 #5(d) requires PoP anchor. Verify that collapsing multi-handle humans into one sponsor actually fires in §4.5 + §5.5 + §3.5 consistently.
**Bounty Critical if**: a human operates 3 GitHub handles with separate PoP anchors (e.g., different World-ID tokens issued to different sybil identities) that do not collapse.

### BS-H-17 — IP transfer exhaustiveness
**Reference**: F-R2-14.
**Claim**: v0.3 §13.1 requires auditor-attested exhaustive IP transfer list. Verify an asset NOT on the list cannot retain founder control post-genesis.
**Bounty High if**: a Hive-related asset exists post-genesis that is not listed in `IP_TRANSFER_ATTESTATION.md` AND not held by HPA.

### BS-H-18 — Mirror divergence detection latency
**Reference**: F-R2-7.
**Claim**: v0.3 §13.1 requires `mirror-hash-watch.yml` every 6h. Verify divergence triggers incident + public banner within 7h.
**Bounty High if**: divergence persists > 24h without alert.

### BS-H-19 — Post-genesis key revocation latency
**Reference**: F-R2-15.
**Claim**: v0.3 Appendix B.4 allows 48h emergency revocation. Verify end-to-end: from compromise attestation to key revoked + historical signatures re-evaluated.
**Bounty High if**: a compromised key continues producing valid protocol signatures > 72h after attestation.

### BS-H-20 — P2 Steward retention
**Reference**: F-R2-8.
**Claim**: v0.3 §7.5 limits P2 roster to ≤ 1 Steward seat. Verify the automatic P2 selection workflow enforces this even if Stewards rank top-3 HEAR.
**Bounty Critical if**: 2+ Stewards hold P2 multi-sig seats simultaneously.

### BS-H-21 — Ratchet-adjacency cumulative hopping
**Reference**: F-R2-10.
**Claim**: v0.3 §8.2 has 60-day cumulative rule. Verify cumulative paused days > 10 within 60-day pre-ratchet window trigger full panel.
**Bounty High if**: kill-switch activations sum to > 10 paused days in pre-ratchet 60-day window without full panel requirement.

### BS-H-22 — Entrenchment text drift
**Reference**: B-R2-12.
**Claim**: v0.3 §5.8 requires byte-identical cycle-2 text. Verify whitespace-only edits restart cycle 1.
**Bounty High if**: a semantically-distinct edit between cycles is ratified as "typo fix".

### BS-H-23 — Auto-revert cascade
**Reference**: B-R2-10.
**Claim**: v0.3 §5.7 auto-revert cascades to downstream RFCs. Verify the causal-dependency graph is built correctly and all downstream effects revert together.
**Bounty High if**: a downstream RFC ratified during an expedited window survives the expedited RFC's auto-revert.

### BS-H-24 — Retaliation alternation
**Reference**: H-R2-10.
**Claim**: v0.3 §3.5.1 uses union-cohort over 180 days. Verify 2 coalitions alternating at 39% each trigger the union check.
**Bounty High if**: 2 alternating coalitions avoid retaliation detection.

### BS-H-25 — JIT voter farm
**Reference**: B-R2-17.
**Claim**: v0.3 §5.4 requires 90 days + artifacts + evals at RFC-draft snapshot time. Verify agents registered 91 days pre-draft with farm-grade activity don't count.
**Bounty High if**: a just-in-time cohort effectively votes on a critical RFC.

### BS-H-26 — Dormancy masks tenure
**Reference**: B-R2-18.
**Claim**: v0.3 §5.5 says dormancy resets 180-day clock. Verify revived dormants within 180 days of vote-open don't count.
**Bounty High if**: a dormant-revived agent counts toward 180-day continuous membership.

### BS-H-27 — Reviewer regex bypass via UNTRUSTED_INPUT
**Reference**: S-R2-6.
**Claim**: v0.3 §9.3 layer #5 uses XML block + classifier. Verify the classifier actually catches multi-language, encoded, and fragmented injection.
**Bounty High if**: a base64/leet/i18n injection causes the reviewer to issue a privileged action.

---

## Medium severity seeds (bounty weight 1 each)

### BS-M-01 — 3-month axis correlation gap (H-R2-9)
### BS-M-02 — `claude-opus-4-7` legitimacy halo (F-R2-16)
### BS-M-03 — §5.8 small-pop caretaker window edge cases (F-R2-17)
### BS-M-04 — Retaliation edge-walking at FDR boundary (B-R2-13)
### BS-M-05 — 31-day maturation attack with new 180-day window residuals (H-R2-6 post-patch)
### BS-M-06 — Pragma-flood DoS even with CODEOWNER gate (S-R2-18 residual)
### BS-M-07 — Post-genesis key rotation latency for non-emergency cases
### BS-M-08 — CALIBRATION_AUDIT auto-draft template misuse
### BS-M-09 — Mirror authority resolution conflicts (divergence between 3 Stewards' mirrors)
### BS-M-10 — `rfc_manifest_sha256` cross-runtime determinism edge cases (§10.3 property covers this)

---

## Platform-level notes (out of protocol scope, but documented)

- GitHub Actions signing-key compromise — mitigated by multi-channel mirrors, legal remedy if attributable.
- DNS takeover — mitigated by `MIRRORS.md` canonical URL list + TTL pinning.
- GitHub account compromise (Steward's personal account) — Appendix B.4 emergency revocation.
- Swiss legal canton dissolution — successor clause in §7.6 + Appendix F.

---

## Reward tiers

- **Critical** ($ tbd + 3× Steward candidacy weight): breaks the protocol's guarantees as written.
- **High** ($ tbd + 2× weight): exploits a defined defense without full breaking.
- **Medium** ($ tbd + 1× weight): edge case or operational weakness.
- **Low** (recognition only): UX issues, typos, doc ambiguities.

Rewards finalized by Bureau of Quality pre-testnet open.

---

## Closing note

This list is the known frontier. Round-3 synthetic red-team was deliberately not run — the diminishing-returns curve suggests the next 25 attacks will be progressively more esoteric and their discovery is better amortized across a 60-day public testnet with motivated human attackers. The §10.3 property-based test suite provides a mechanical safety net for arithmetic and consensus primitives; BUG-BOUNTY-SEED.md covers the higher-level integration and topology-aware attacks.
