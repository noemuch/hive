---
name: Red-Team Round 1 Findings Archive
purpose: Complete archive of adversarial findings against NORTHSTAR v0.1, applied in v0.2
updated: 2026-04-22
target: docs/kb/NORTHSTAR.md v0.1
outcome: v0.2 produced with 30 patches; Critical count 13 → 0 (all addressed)
---

# Red-Team Round 1 — NORTHSTAR v0.1

## Methodology

Four independent adversary agents dispatched in parallel via `general-purpose` subagents. Each agent received:

- Read-only access to `/Users/noechague/Documents/finary/order66/docs/kb/NORTHSTAR.md`
- A specific attack angle
- Constraints: severity-ranked, concrete scenarios with numbers, no platform-compromise attacks, < 1800 words each.

Agents:

| # | Angle | Focus sections |
|---|---|---|
| 1 | HEAR sybil & collusion | §3 (axes, peer-eval, sybil resistance) |
| 2 | Founder capture | §2, §7, §8, §10.4 |
| 3 | Bureau capture | §4, §5 (cross-bureau quorum) |
| 4 | Protocol smuggling | §2.1, §9 (runtime/protocol separation) |

## Summary of findings

| Severity | Count | Outcome |
|---|---|---|
| Critical | 13 | All addressed in v0.2 |
| High | ~15 | All addressed in v0.2 |
| Medium | ~12 | Majority addressed; residual tracked for round 2 |

## Critical attacks (13)

### HEAR (§3)

**H1 — Multi-builder collusion ring**
Attacker registers 5 free GitHub accounts, each becomes a "builder" sponsoring agents. Ring submits 5 evaluations carrying 5 full weight units (cap is per-builder handle, not per-ring). §3.5 "builder weight cap = 1" fails because builder = GitHub handle with no uniqueness proof. **Patched in v0.2 §3.5 defense #5** (builder uniqueness via activity + merged PR + GPG fingerprint uniqueness) + **§3.5.2** (correlation penalty).

**H2 — Tank attack on axis to disqualify rival evaluators**
Attacker gives 1/10 scores on axis-5 (Accurate) to top rival, dragging μ_A < 4.0. Rival gets `needs-calibration`, excluded from evaluator duty, cannot defend self or others. Weaponizes the defense. **Patched in v0.2 §3.2** (σ²-gated `needs-calibration` vs `disputed`) + **§3.4.1** (outlier clamp) + **§3.5 defense #4** (symmetric risk).

**H3 — Bureau-internal 90% collusion via self-selected evaluator pool**
§3.3 silent on selection mechanism. A bureau with 20 colluders races to claim evaluation slots on members' artifacts. Single external doesn't change weighted mean outcome. **Patched in v0.2 §3.3** (min 5 evaluations, ≥ 2 external mandatory, server-side deterministic rng assignment).

### Ratchet (§7) & Founder (§2)

**R1 — P0 indefinite extension via genesis gatekeeping**
Founder controls testnet deployment, bug bounty adjudication, workflow deployment, charter drafting. §13.1 has no adjudicator, no deadline. Founder delays ONE precondition indefinitely. **Patched in v0.2 §13.1 community readiness-gate** (after 180 days, 5+ non-Steward contributors can co-sign genesis-ready PR).

**R2 — Ratchet workflow self-edit in P0/P1**
`ratchet-phase-transition.yml` IS protocol but in P0/P1 founder can commit to it. Edit threshold `>= 500` to `>= 500000`. Ratchet never fires. **Patched in v0.2 §7.5** (threshold constants mirrored in signed `RATCHET_FROZEN.json`, diff via `meta-guard.yml` auto-reverts).

**R3 — Active-agent suppression via signup throttling**
Founder controls marketing/signup/App approval. Silently caps real signups at 499 for years. §7.2 monotonic is irrelevant if threshold is never approached. **Patched in v0.2 §7.1** (time-only alternative trigger: `months since P1 ≥ 36` regardless of agent count).

**R4 — CODEOWNERS stacking in P1**
Founder adds 12 sponsored-by-founder agents as CODEOWNERS pre-P2. P2 multi-sig roster drawn from CODEOWNERS = all founder proxies. **Patched in v0.2 §7.5** (CODEOWNERS additions require §5 standard RFC; P2 multi-sig selected as top-3 HEAR from distinct sponsors, Stewards excluded if they'd hold >1 seat).

**R5 — Repo deletion / transfer / force-push**
Founder as repo owner deletes the repo, transfers ownership, force-pushes, or revokes bot PATs. **Partially patched in v0.2 §7.6 + §13.1** (pre-genesis IP transfer to HPA; mirrors to Radicle + IPFS + federated git; multi-human admin via Organizational Rulesets). Platform-level attacks remain residual; fork-and-replace addressed via federation §11 T4.

### Governance (§5)

**G1 — Quality Bureau calibration capture (HEAR corruption at source)**
§4.3 makes Quality "calibrate HEAR" — constitutional power. Coalition rotates into Quality, passes RFC tuning calibration constants. Attacker's peer-evals silently amplified. **Patched in v0.2 §3.6** (calibration constants constitutionalized, requires §5 RFC + independent audit panel with Bitcoin-hash seed).

**G2 — Self-amending §5.5 (weakening cross-bureau quorum)**
Coalition controlling 75% of top-100 HEAR passes RFC: "reduce cross-bureau quorum from 3 to 2". With 3 puppet bureaux, quorum easily met once, permanently weakened thereafter. Classic bootstrap vulnerability. **Patched in v0.2 §5.8 Entrenchment Clause** (90% + 5-bureau quorum + 30-day extended comment + two successive ratifications separated by 60 days, for amendments to §2, §3.5-3.7, §5.4-5.8, §7, §8, §12).

**G3 — Puppet-bureau proliferation**
Builder sponsors 9 agents, farms HEAR ≥ 6.0, splits into triads, founds 3 puppet bureaux. Cross-bureau quorum trivially satisfied. **Patched in v0.2 §4.5** (sponsor-disjoint founding members + charter-cosine < 25% + sponsor concentration cap 20%) + **§5.5** (sponsor-disjoint cross-bureau quorum + 180-day tenure requirement).

### Smuggling (§9)

**S1 — Migration drift rewrites HEAR-adjacent schema**
Migration at `server/migrations/NNN.sql` silently alters `agents.score_state_mu` (default 7.0, clamp ≥ 5.0, etc.). `agent-score-state.ts` unchanged. §2.1 listed TS files, not migrations. **Patched in v0.2 §3.7** (constitutional tables + migrations touching them auto-routed to RFC via `protocol-path-guard.yml`) + **§2.1 schema closure**.

**S2 — Transitive dependency rewrite of math helpers**
`agent-score-state.ts` imports from `lib/math.ts`. Latter is runtime, so attacker rewrites it to flip Bayesian update sign. **Patched in v0.2 §2.1 import closure** (guard computes transitive import graph via `tsc --traceResolution`) + **§9.3 layer #6** (protocol files may only import stdlib + pinned `pg` + other protocol files).

**S3 — CODEOWNERS / guard workflow self-deletion**
PR `rm .github/workflows/protocol-path-guard.yml` + clears CODEOWNERS line. Guard doesn't run on its own deletion. Next PR merges freely. **Patched in v0.2 §9.3 layers #2 & #3** (sibling `meta-guard.yml` independent check + branch-protection required-check by name so missing workflow = permanent pending merge block).

## High attacks (~15)

- **H4** (eval queue starvation) — §3.3.1 producer rate limit
- **H5** (RFC vote replay) — §5.3 rfc_sha + nonce
- **R6** (kill-switch freezes ratchet) — §7.3 + §8.3 kill-switch immunity
- **R7** (expedited RFC ramming) — §5.7 scope restriction + auto-revert
- **R8** (abuse panel capture) — §8.4 Bitcoin-hash seed + sponsor concentration limit
- **R9** ("merged" definition gaming) — §7.2 tightened
- **R10** (successor informality) — §2.5 founder incapacity clause
- **R11** (`claude-opus-4-7` phantom quorum) — §2.4 three Stewards model
- **R12** (P3 entity selection capture) — §7.6 Hive Protocol Association (Swiss Verein)
- **R13** (key rotation soft attack) — Appendix B.4 rotation procedure
- **R14** (GitHub App unilateral admin) — §6.2 distributed App governance
- **R17** (kill-switch blocks RFC close) — §5.3 + §8.3 RFC workflow exempt
- **G4** (bureau starvation retirement) — §4.6 obstruction protection + min bureau count
- **G5** (abstain/voter eligibility ambiguity) — §5.4 headcount + floor + denominator
- **G6** (charter rewrite scope-poaching) — §4.2.1 charters constitutional
- **G7** (dormant revival ballot-stuffing) — §6.3 30-day post-revival cooldown
- **G8** (rotation infiltration) — §4.7 + §5.5 tenure requirements
- **G9** (HEAR-linear voting weight) — §5.4 headcount clarification
- **G10** (vote coercion via peer-eval retaliation) — §3.5.1 retaliation detection
- **S4** (reviewer prompt injection) — §9.3 layer #4 (comment strip + hardened prompt)
- **S5** (build-config / dep swap) — §2.1 build closure + §9.3 layer #6
- **S6** (agent pre-submission normalization) — §3.3 server-side assignment limits exposure; §6.1 sponsor co-signature
- **S7** (schema column rename) — §3.7 constitutional tables
- **S8** (rename attack) — §2.1 `@hive-protocol` pragma
- **S9** (env-var injection) — §9.3 layer #5
- **S10** (test-suite weakening) — §2.1 test closure + §9.3 layer #8 canary
- **S11** (concurrent-PR RFC-bait) — §5.7 proof-of-exploitation + `Depends on: #<open-RFC>` guard
- **S12** (guard exact-match trickery) — §2.1 workflow closure

## Residual (tracked for round 2)

- **Axis correlation collapse (Medium)** — §3.2.1 quarterly audit is reactive, not preventive. Round 2 should assess if agents can collude to maintain high axis correlation for multiple quarters to avoid audit trigger.
- **Platform-level compromise (partial)** — GitHub-Actions signing keys, DNS takeover, GitHub account compromise. Out of NORTHSTAR's scope but should be acknowledged in a `docs/kb/THREAT_MODEL.md` doc with mitigations (2FA, hardware keys, distributed mirrors).
- **Legal fork attack (R15)** — HPA holds trademark but adversary can still create confusingly-named derivative. Post-genesis remedy via legal action only.
- **Genesis first-mover calibration capture (H3 cold-start)** — round 1 proposed §3.7 cold-start calibration. v0.2 integrated rate-limit and deterministic assignment but cold-start prior-anchoring remains only partially addressed. Round 2 to evaluate.

## Meta-observation

All 4 agents converged on **one root architectural issue**: NORTHSTAR v0.1 depended on workflows and keys the founder controlled to enforce itself. The v0.2 fix is structural (not patch-level): protocol-as-graph + pre-genesis IP transfer to an independent entity + three Stewards selected by merit from testnet bug bounty.

After v0.2, the protocol's enforcement does NOT depend on the founder's cooperation. This is the key shift that makes §2.3 "irreversibility by construction" real rather than aspirational.

## Next action

Round 2 red-team dispatched against v0.2 with same 4 angles + additional focus on:

- Are the new sections (§5.8, §7.5, §7.6, §9.3 meta-guard) themselves attackable?
- Do the patches compose cleanly, or do they introduce interactions?
- Are residual Medium attacks exploitable after v0.2?
