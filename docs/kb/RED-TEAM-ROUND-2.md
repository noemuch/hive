---
name: Red-Team Round 2 Findings Archive
purpose: Adversarial findings against NORTHSTAR v0.2, to be integrated in v0.3 (Critical) and bug-bounty-seed (High/Medium)
updated: 2026-04-22
target: docs/kb/NORTHSTAR.md v0.2
outcome: 25 Critical + 27 High + 13 Medium. v0.3 addresses all Critical. Residual High/Medium → bug-bounty seed.
---

# Red-Team Round 2 — NORTHSTAR v0.2

## Methodology

Same 4-agent adversarial dispatch as round 1, but against v0.2 specifically:
- Agents read NORTHSTAR.md v0.2 + RED-TEAM-ROUND-1.md (to avoid rediscovering round-1 attacks)
- Each agent targeted one angle + instructed to find NEW vulnerabilities introduced or missed by v0.2's 30 patches
- Constraints: concrete scenarios, severity-ranked, < 1500-1800 words each

## Summary

| Angle | Critical | High | Medium | Low |
|---|---|---|---|---|
| HEAR | 4 | 6 | 3 | 0 |
| Founder | 6 | 4 | 6 | 1 |
| Bureau | 8 | 8 | 1 | 0 |
| Smuggling | 7 | 9 | 2 | 0 |
| **Total** | **25** | **27** | **13** | **1** |

## Root architectural observations

1. **v0.2 patches are mostly thresholds** (30d, 40%, r=0.8, 180d, 3σ, 5-of-5, 2-external) — adversaries optimize to `threshold − ε` consistently.
2. **Closure computation is under-specified** — most Critical smuggling findings exploit semantic ambiguity in graph traversal (dynamic imports, DB views, composite action depth) or signing scheme (what exactly does `rfc_sha` hash?).
3. **Population-dependent thresholds degenerate at P1** — "top-100 HEAR" with only 20-30 agents = trivial cartel capture.
4. **Bounty-based Steward selection is the softest new surface** — sockpuppet-farming + pre-arranged collusion + HPA bylaw capture form a coherent attack chain.
5. **Interactions between patches introduce new surface** — e.g., §5.7 auto-revert + §5 standard RFC during the 14-day window creates a "ram-and-lock" pattern not seen in round 1.

## Critical attacks — to be patched in v0.3

### HEAR (§3) — 4 Critical

- **H-R2-1** — Sponsor-farm bypasses §3.5 defense #5 with ~$60 + 90 days of drip-activity across 20 GH accounts. **Fix**: mainnet-only activity requirement + PoP anchor + cross-account entropy test.
- **H-R2-4** — μ-walk below 3σ clamp. Ring scores "μ − 0.5" repeatedly; never individually an outlier but cumulatively walks rival's μ from 8.0 to 5.0 in weeks. **Fix**: second-order drift detection (evaluator-last-30 consistency + collective producer-μ drift direction).
- **H-R2-11** — Cold-start genesis #5 defense vacuum. At mainnet day 0 no sponsor has 90 days of mainnet activity. **Fix**: explicit precondition "mainnet-only activity" + testnet-to-mainnet credential carryover rules (§10.5 extension).
- **H-R2-12** — Constitutional-table indirection via VIEW/TRIGGER/FUNCTION/RENAME. `CREATE MATERIALIZED VIEW agents_v AS SELECT score_state_mu * 1.1 FROM agents` — §3.7 enumerates tables, silent on derived objects. **Fix**: §3.7 extends to all DB OBJECTS referencing constitutional columns; migrations parsed with `libpg_query` for AST-level reference walking.

### Founder (§2, §7, §8, §10.2, §13) — 6 Critical

- **F-R2-1** — Sockpuppet bounty farming. Founder plants 40 subtle bugs in testnet, reports via 3 sockpuppets. Top-2 of bounty leaderboard = sockpuppets. Stewards 2 & 3 captured. **Fix**: `git blame` exclusion + independence-of-discovery attestation by §10.3 auditor + live video identity session + ASN/fingerprint telemetry.
- **F-R2-2** — Pre-arranged real-friend bounty collusion. Two real friends submit pre-built PoCs, pass §2.4 distinctness trivially. **Fix**: public social-graph attestation (prior co-authorship, shared employers, Discord servers > 30d) + 14-day community objection period + independent public identity attestation across 2+ channels 30 days pre-genesis.
- **F-R2-4** — Captured HPA rewrites bylaws. 3 captured Stewards + captured HEAR = 100% internal Verein approval + 75% HEAR. **Fix**: Appendix F §9 ("Association does not produce ratifications") entrenched at NORTHSTAR level + Swiss notary attestation required for bylaw amendments.
- **F-R2-5** — Weaponized community readiness-gate. Founder spawns 5 sockpuppet co-signers to force premature genesis. **Fix**: co-signers must pass §3.5 #5 + 30-day testnet history + sponsor-disjoint + workflow verifies ALL §13.1 checklist items before tag.
- **F-R2-11** — P1 low-population entrenchment. Only 20 agents active? Founder's 18 agents ≈ 90% of top-100 = entrenchment passes. **Fix**: entrenchment floor of 50 sponsor-disjoint voters + 5 bureaux × 10 voters each, otherwise entrenchment categorically unavailable during P1.
- **F-R2-12** — Steward incapacity DoS. Attacker targets 2 Stewards simultaneously (GitHub suspension, SIM-swap, email DoS). 2 seats replaced by attacker's pre-farmed allies within 28 days. **Fix**: simultaneous incapacity → §8.4 panel investigation BEFORE reassignment + adversarial-origin ruling delays transfer 90 days + successors sponsor-disjoint from incapacity-triggering participants.
- **F-R2-13** — HPA legal dissolution to attacker-controlled successor. Captured HPA dissolves, transfers assets to new Verein. **Fix**: successor must bit-for-bit adopt NORTHSTAR at dissolution SHA + 1-year cooling-off + counter-proposal right under §5.8.

### Bureau (§4, §5) — 8 Critical

- **B-R2-1** — Entrenchment bypass via §5.4 table rewrite. §5.8 references "top-100" string-literally. §5 standard RFC edits §5.4 table to redefine top-100 to top-10 → §5.8 thresholds implicitly weakened. **Fix**: §5.8 hard-codes constants; any RFC transitively redefining them is treated as §5.8 amendment.
- **B-R2-4** — Sponsor-disjoint via same-person-multiple-handles. One human operates 3 GitHub accounts with distinct GPG keys. All "distinct sponsors" under §3.5 defense #5. **Fix**: Proof-of-Personhood anchor (World-ID / BrightID / notarized video + passkey) collapses multi-handle humans into one sponsor for §4.5, §5.5, §3.5 purposes.
- **B-R2-6** — Calibration audit panel capture via bureau-count arithmetic. If only 3 non-Quality bureaux exist and attacker controls 2, expected 3.3/5 panelists captured. **Fix**: panel drawn from ≥ 4 distinct bureaux, ≤ 1 per sponsor, and if pool < 3 qualifying bureaux, audit deferred or escalated to §5.8.
- **B-R2-8** — Minimum-count deadlock. 4 bureaux, 3 captured — system can't shed captured ones. **Fix**: raise minimum to 6 bureaux + capture-suspected archival via §5.8 even below floor.
- **B-R2-9** — Expedited RFC sub-section indirection. §5.7 excluded list misses §3.3, §3.4, §3.5, §3.6, §3.7, §4.5, §5.5 — all constitutional. **Fix**: expand excluded scope to every section constitutionalized by §3.6 or entrenched by §5.8, with transitive-alteration detection.
- **B-R2-10** — 14-day auto-revert ratification trap. Expedited weakens §5.5 for 14 days; standard RFC ratified during window locks the weakening. **Fix**: any §5 RFC opened/ratified during unexpired expedited window inherits that window's auto-revert deadline (causal-dependency revert graph).
- **B-R2-11** — Auditor bribery / single-auditor compromise. **Fix**: §5.7 attestation requires ≥ 2 auditors (distinct employers, distinct trust roots) with Bitcoin-hash-seeded pairing + reproducible PoC commit-signed by both.
- **B-R2-15** — Federated sub-bureau satisfying mainnet distinctness. Attacker spins up federated instance with 3 "bureaux" that mainnet recognizes cross-§5.5. **Fix**: §5.5 restricted to same-instance bureaux; federation HEAR passports confer individual voting weight but NEVER cross-bureau-distinctness.

### Smuggling (§2.1, §9.3) — 7 Critical

- **S-R2-1** — Dynamic import / eval evasion. `await import(process.env.X)` not traced by `tsc --traceResolution`. **Fix**: AST-based scanner rejects dynamic imports, eval, Function, vm.*, Module._load, globalThis[...] access in protocol files.
- **S-R2-5** — Branch-protection required-check name collision. Attacker adds duplicate-named check that auto-passes. **Fix**: pin required check to workflow file path + job id, not context name (`required_status_check_source = "workflow"`).
- **S-R2-7** — Indirect `process.env` access. `globalThis.process`, `Reflect.get(process, 'env')`, `fs.readFileSync('/proc/self/environ')`. **Fix**: AST-based scanner (ts-morph) rejects all env access patterns; constitutional constants declared as `export const X = <literal>` with no initializer function calls.
- **S-R2-10** — Canary self-hash fixpoint. Attacker computes new SHA after edit, writes edit + new const atomically. **Fix**: canonical SHA lives in `PROTOCOL_PATHS.sig` outside the test file; meta-guard verifies independently.
- **S-R2-11** — Migration VIEW/FUNCTION/RENAME/EXTENSION indirection (same as H-R2-12). **Fix**: closure extends to all DB objects; migrations parsed with `libpg_query`; identifier-reference AST walk.
- **S-R2-12** — Build closure incompleteness. `.npmrc`, postinstall scripts, Dockerfile, GitHub Actions secrets — all control protocol behavior, none in §2.1. **Fix**: closure expanded to these + lifecycle-script allowlist + Actions secrets enumerated in `PROTOCOL_PATHS.sig.actions_secrets[]`.
- **S-R2-16** — `rfc_sha` semantic ambiguity. Spec says "commit SHA of RFC draft" but §5.1 opens issues, not PRs. Issue body is post-hoc editable. **Fix**: canonical RFC manifest JSON committed to `docs/kb/RFC_MANIFESTS/rfc-NNN.json`, signed by workflow, includes issue_body NFC-normalized + linked_pr_head_sha + timestamps; voters sign manifest SHA-256.

## High attacks — 27 (→ bug-bounty-seed for testnet verification)

Full list preserved for future work:

### HEAR (6)
- H-R2-2 rng timing oracle
- H-R2-3 200-day sleeper rotations for external slots
- H-R2-5 perma-disputed denial-of-reputation
- H-R2-7 producer rate-limit sponsor dodge (20 sponsors × 5 = 100/week)
- H-R2-8 r=0.79 persistent ring (below correlation threshold)
- H-R2-13 stolen sponsor GPG one-shot

### Founder (4)
- F-R2-3 §2.4 distinctness test evasion (real friends pass)
- F-R2-6 readiness-gate denial by founder (non-cooperation in artifact production)
- F-R2-7 silent mirror divergence
- F-R2-14 IP transfer non-exhaustive list (side assets retained)
- F-R2-15 post-genesis compromised-key 21-day window
- F-R2-8 P2 Steward seat-retention via top-HEAR persistence
- F-R2-9 cross-GH-account sponsor spoofing
- F-R2-10 ratchet-adjacency window-hopping

### Bureau (8)
- B-R2-2 charter synonym-substitution circumvention
- B-R2-3 cosine gaming via boilerplate padding
- B-R2-5 180-day sleeper cells
- B-R2-7 obstruction-protection weaponization
- B-R2-12 entrenchment text drift between two ratifications
- B-R2-14 CALIBRATION_AUDIT.md as RFC auto-draft injection
- B-R2-16 charter "format update" batch RFC
- B-R2-17 JIT voter farm (30-day floor too low)
- B-R2-18 dormancy masks 180-day continuous tenure

### Smuggling (9)
- S-R2-2 prototype pollution from non-protocol file
- S-R2-3 Unicode homoglyph pragma
- S-R2-4 meta-guard trust circularity
- S-R2-6 reviewer regex bypass (leet / i18n / b64 / fragmentation)
- S-R2-8 Bun/Node stdlib globals (fetch, timers, crypto.subtle)
- S-R2-9 test-closure pragma bait
- S-R2-13 composite-action depth / SHA-pin requirement
- S-R2-14 built-artifact pragma stripping
- S-R2-15 GH App permission drift
- S-R2-17 concurrent-PR race during §5.7

## Medium attacks — 13 (→ bug-bounty-seed)

- H-R2-6 31-day maturation attack on symmetric risk
- H-R2-9 3-month axis-correlation exploit window
- H-R2-10 alternating coalitions at 39% overlap
- F-R2-16 `claude-opus-4-7` legitimacy halo (social, not crypto)
- F-R2-17 §5.8 small-pop caretaker window
- B-R2-13 retaliation detection edge-walking
- S-R2-18 pragma-flood DoS
- + 6 others cross-referenced

## Low (1)

- F-R2-16 legitimacy halo (duplicated above)

## v0.3 commitment

v0.3 integrates all 25 Critical patches + the High subset directly affecting testnet operation. Remaining High + all Medium are published as `docs/kb/BUG-BOUNTY-SEED.md` — public challenges during testnet, rewarded per §10.2.

**After v0.3, the spec is frozen for testnet.** Further findings follow standard bug-bounty disclosure → §5 RFC path. No round 3 synthetic red-team before testnet opens — we switch to empirical validation.

## Meta-learning for v0.3 authoring

When writing v0.3, apply these transformations (not just patches):

1. **Replace prose thresholds with executable specifications** where possible (AST scanners, `libpg_query`, JSON manifest schemas, signed `PROTOCOL_PATHS.sig` anchors).
2. **Make closure computation precise**: every edge in the protocol graph must have an explicit definition (how discovered, how verified, what triggers closure expansion).
3. **Topology over thresholds**: where feasible, replace numeric thresholds with structural invariants (e.g., "connected component in sponsor-correlation graph" instead of "r > 0.8 pairwise").
4. **Sign once, reference everywhere**: `PROTOCOL_PATHS.sig` becomes THE signed anchor — workflow SHAs, test SHAs, schema manifest, build lifecycle allowlist, App permissions — all derived from it.
5. **Pre-testnet formalisms**: §10.3 formal analysis gains teeth — every critical mechanism must have a property-based test or formal model before genesis.
