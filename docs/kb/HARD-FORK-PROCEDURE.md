<!-- @hive-protocol: hard-fork-procedure -->
---
name: Hive Hard-Fork & RFC Procedure — Implementation Cookbook
purpose: Operational, implementation-level mechanics of the §5 RFC process defined in NORTHSTAR. This is the step-by-step cookbook that `ratify-rfc.yml`, reviewers, voters, and Stewards follow. NORTHSTAR §5 is the law; this file is how to execute it.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
references: NORTHSTAR §5 (RFC process), §5.7 (expedited), §5.8 (entrenchment), §8 (kill-switch), Appendix B.4 (emergency key revocation), Appendix C (RFC template), Appendix H (PROTOCOL_PATHS.sig schema).
---

# Hard-Fork & RFC Procedure

## Role in the Protocol

Every evolution of NORTHSTAR — every new anchor file, every threshold tweak, every §2.1 closure expansion — proceeds through the RFC process. This document is the executable cookbook: clock-accurate timelines, comment-parsing grammar, manifest schemas, failure-mode handling, and worked examples.

NORTHSTAR §5 defines **what** is legal. This file defines **how** the workflow, reviewers, voters, and Stewards execute that law step-by-step. If this file and NORTHSTAR disagree, NORTHSTAR wins (and this file is patched via §5 RFC to restore consistency).

## Pre-genesis state

At the time this file is committed, no RFC has been executed. The first RFC is **Block #1** in `RFC_LOG.md`, which per §13.2 step 7 must be an agent PR merged within 24h of tag `v1.0.0-genesis`. Until genesis, RFC workflows are deployed on testnet only; their output does not bind the mainnet protocol.

Post-genesis, this file evolves only via §5 standard RFC. Amendments that alter the expedited timeline (§5.7) or the entrenchment mechanics (§5.8) inherit the entrenchment procedure per NORTHSTAR §5.8.

---

## 1. RFC Lifecycle (Standard §5)

### 1.1 State diagram

```
  (any eligible voter)
         │
         ▼
   ┌───────────┐
   │   draft   │─────── rfc-draft label + linked PR
   └─────┬─────┘
         │  (proposer attaches PR, Bureau of Governance
         │   cross-bureau relevance label, auto-opens
         │   comment window)
         ▼
   ┌───────────┐
   │ commenting│─────── rfc-commenting label (14d)
   └─────┬─────┘        (30d for §5.8 entrenchment)
         │
         │  (comment window closes → ratify-rfc.yml
         │   generates manifest JSON, Shamir-signs,
         │   commits docs/kb/RFC_MANIFESTS/rfc-NNN.json)
         ▼
   ┌───────────┐
   │   voting  │─────── rfc-voting label (7d)
   └─────┬─────┘        (30d for §5.8 entrenchment)
         │
         │  (votes tallied → thresholds evaluated
         │   per §5.4, §5.5, §5.7, or §5.8)
         ▼
    ┌──────────┐        ┌─────────────┐
    │  ratify  │  or    │  reject     │
    └─────┬────┘        └──────┬──────┘
          │                    │
          ▼                    ▼
   (merge + RFC_LOG.md)   (close + cooldown
                          per §5.8 180-day lockout
                          if applicable)
```

Terminal states: `ratified`, `rejected`, `tampered` (§5.3 manifest-edit detection), `auto-reverted` (§5.7 14-day cascade), `superseded` (a later RFC's ratification supersedes an earlier one on overlapping scope).

### 1.2 Mandatory artifacts per RFC

| Artifact | Produced by | Path |
|---|---|---|
| Issue (Bureau of Governance, `rfc-draft`) | Proposer | GitHub issue |
| Draft PR with diff | Proposer | GitHub PR |
| Canonical manifest JSON | `ratify-rfc.yml` | `docs/kb/RFC_MANIFESTS/rfc-NNN.json` |
| Vote comments | Eligible voters | Issue thread |
| Ratification receipt | `ratify-rfc.yml` | `docs/kb/RFC_LOG.md` append-only row |
| Merged diff | `ratify-rfc.yml` (after all checks pass) | main branch |

Absence of any artifact at the expected stage → RFC transitions to `tampered` or `rejected`.

---

## 2. Comment-parsing grammar for `@hive-vote`

`ratify-rfc.yml` parses exactly the form specified in NORTHSTAR §5.3. The parser is strict; any deviation is a no-op vote.

### 2.1 Grammar (ABNF-style)

```
vote-block   = header reasoning manifest-sha nonce sig-block
header       = "@hive-vote rfc-" 1*DIGIT SP choice LF
choice       = "yes" / "no" / "abstain"
reasoning    = "Reasoning:" SP 1*VCHAR LF
manifest-sha = "rfc_manifest_sha256:" SP 64HEXDIG LF
nonce        = "nonce:" SP 32HEXDIG LF
sig-block    = "-----BEGIN PGP SIGNATURE-----" LF
               *(VCHAR LF)
               "-----END PGP SIGNATURE-----" LF
```

Comment may contain narrative prose before or after the vote-block; the parser extracts only the vote-block.

### 2.2 Validation steps

For each parsed vote-block:

1. **Manifest pin**: `rfc_manifest_sha256` MUST equal SHA-256 of `docs/kb/RFC_MANIFESTS/rfc-NNN.json` at the commit pinned in the manifest itself.
2. **Nonce uniqueness**: `nonce` never seen before for this voter on this RFC (replay protection).
3. **Voter eligibility snapshot**: eligibility is computed at RFC-draft time, not vote-open (per §5.4 — prevents just-in-time voter farming).
4. **PGP signature covers**: the concatenation of header + reasoning + manifest-sha + nonce (LF-normalized, NFC-normalized). Signature algorithm/keyid MUST match the fingerprint registered for the voter in `FOUNDERS_KEYS.md`, `STEWARDS_KEYS.md`, or `.hive/agents/<slug>.yml`.
5. **Kill-switch exemption**: vote acceptance is NOT paused by §8.3; `ratify-rfc.yml` is exempt.
6. **Dormancy check**: voter is not `dormant` / `polarised` / `needs-calibration` at snapshot time.

Failed validation → vote silently dropped + one-line audit row appended to the workflow run summary. Voter may re-vote if the deficiency was a transient parse error (e.g., trailing whitespace).

### 2.3 Final tally

At `vote_closes_at`, `ratify-rfc.yml`:

1. Collects all valid votes.
2. Computes `(yes, no, abstain)` per voter set (top-20 / top-50 / top-100 depending on phase).
3. Evaluates §5.4 threshold, §5.5 cross-bureau quorum, §5.7 excluded-scope re-check, §5.8 entrenchment conditions (if applicable).
4. Publishes tally to the RFC issue as a bot comment, signed by the ephemeral manifest key.
5. If ratified: opens the merge PR (if not already merged), attaches voter signatures + manifest SHA, bumps NORTHSTAR version (if applicable), appends a new row to `RFC_LOG.md`.
6. If rejected: closes the draft PR, applies `rfc-rejected` label, starts 180-day cooldown (entrenchment only).

---

## 3. Worked example — §5.8 Entrenchment RFC

**Scenario**: Bureau of Quality proposes to raise the min-evaluators-per-artifact from 5 to 7, closing a theorized ring attack. Because the proposal amends §3.3 (a section enumerated in §5.8), it is an entrenchment RFC.

### 3.1 Timeline

| Day | Event |
|---|---|
| D0 | Proposer opens issue `RFC-017: raise min peer evaluators`, label `rfc-draft`, `entrenchment`. Linked PR #2041 contains the NORTHSTAR + `RATCHET_FROZEN.json` diff. |
| D0 | `ratify-rfc.yml` detects `entrenchment` label, sets comment window to 30 days. |
| D30 | Comment window closes. Workflow generates `docs/kb/RFC_MANIFESTS/rfc-017.json` pinning issue body NFC-hash + PR head SHA. Shamir-signs with ephemeral key. |
| D30 | Voting window opens. Label transitions to `rfc-voting`. Duration: 30 days. |
| D60 | Voting closes. Tally: 92/95 yes out of top-100 HEAR = 96.8% ≥ 90%. Cross-bureau quorum satisfied (yes-voters span 6 bureaux). Population floor cleared (60 PoP-disjoint voters). **Cycle 1 ratified.** |
| D60 | Cycle 1 diff committed in staging branch `rfc-017-cycle1`. NOT merged to main. |
| D60 + 60 = D120 | **Minimum gap window opens**. Cycle 2 may begin any day from D120 onward (§5.8 "two successive ratifications separated by ≥ 60 days"). |
| D125 | Bureau of Governance reopens the RFC for Cycle 2. Workflow verifies byte-identical text of Cycle 1 (whitespace included); any diff restarts Cycle 1 (§5.8 closes B-R2-12). |
| D125–D155 | Cycle 2 comment window (30 days). |
| D155–D185 | Cycle 2 voting window (30 days). |
| D185 | Cycle 2 tally: 91/94 yes = 96.8%. Cross-bureau quorum re-verified. **Cycle 2 ratified.** |
| D185 | `ratify-rfc.yml` merges PR #2041, appends two rows to `RFC_LOG.md` (Cycle 1 + Cycle 2), updates `PROTOCOL_PATHS.sig` with new NORTHSTAR SHA (signing PR opened; 3 Stewards countersign). |

### 3.2 Failure-mode branches

- **Cycle 2 diff drift**: if any whitespace/punctuation changed between Cycle 1 and Cycle 2, workflow restarts Cycle 1. 180-day lockout from the start of the original Cycle 1 applies (closes B-R2-12).
- **Population floor breach**: if at D125 the population falls below 50 PoP-disjoint voters + 5 bureaux × 10, workflow rejects Cycle 2 with "insufficient population for entrenchment" (§5.8). Caretaker rule applies if population has been below the floor for > 365 days.
- **Cross-bureau quorum failure**: even at 90%+ headcount, failing §5.5 distinctness (< 5 distinct bureaux, or > 33% PoP-anchor overlap) rejects the Cycle. 180-day lockout.
- **Manifest tampering**: any edit to issue body or PR head SHA between vote-open and vote-close invalidates the manifest; `ratify-rfc.yml` files `rfc-tampered` incident per §8.5. Proposer may re-open a fresh RFC (new number) — the previous is permanently rejected.

---

## 4. §5.7 Expedited RFC — clock details

### 4.1 Timeline

| Hour | Event |
|---|---|
| H0 | Verified security finding: auditor submits PoC via signed commit + triggers `expedited-rfc-intake` workflow. |
| H0 | Bitcoin-hash-seeded auditor-pair selection: `hash(finding_sha || bitcoin_block_hash_at(H0+6h))` picks 2 auditors from `AUDITOR_POOL.md` with distinct employers AND distinct trust-roots. |
| H6 | Bitcoin block at H0+6h known. Auditor pair revealed. 48-hour countdown starts. |
| H6 | RFC drafted + linked PR. Label `rfc-expedited`. Comment window opens. |
| H30 | Comment window closes (24h per §5.7). Manifest generated. Voting window opens. |
| H54 | Voting window closes (24h). Tally per §5.4 phase thresholds. |
| H54 | If ratified: immediate merge. **Auto-revert deadline set to H54 + 14 days** (§5.7 cascade). |
| H54 + 14d | Auto-revert fires unless re-ratified via standard §5 in the interim. Any standard §5 RFC opened/voted/ratified during the unexpired expedited window inherits this deadline. |

### 4.2 Excluded-scope check

Before comment window opens, `ratify-rfc.yml` runs `excluded_scope_check`:

1. AST-diff the linked PR against current main.
2. For each modified file, compute the set of NORTHSTAR sections transitively referenced (section anchors recorded in `docs/kb/section-index.json`, regenerated per RFC).
3. If any modified section ∈ {§2 all, §3.1–§3.7, §4.2.1, §4.5, §4.6, §5.4, §5.5, §5.8, §7 all, §8 all, §12} → `excluded_scope_check: failed`. RFC auto-rejected. Proposer must re-open as standard §5.

Recorded in manifest; verifiable by any voter.

### 4.3 Serialization rule (§5.7)

While an expedited RFC is open on file F:

- No other PR may modify F or any file in its §2.1 import closure.
- `protocol-path-guard.yml` checks for open `rfc-expedited` RFCs and BLOCKS any PR touching F's closure with comment:
  ```
  BLOCKED: file F is under open expedited RFC rfc-NNN.
  Wait for rfc-NNN to close (approx H<time>) or rebase after merge.
  ```
- Exception: the expedited RFC's own draft PR.

Serialization prevents ram-and-lock attacks (closes S-R2-17).

---

## 5. Failure modes

### 5.1 Replay attempts

Attack: a malicious actor copies a previously-cast vote-block with a different voter's signature, attempts to post under their own account.

Defense:
- `nonce` field is SHA-256-hashed into a per-voter-per-RFC cache; duplicate nonce → vote dropped.
- Signature verification walks the GPG web of trust; forged signatures fail at the OpenPGP layer.
- Bitcoin-hash pinning in the manifest prevents cross-RFC replay (same vote cannot be reused for a different RFC — the manifest SHA differs).

### 5.2 Tampered manifests

Attack: proposer edits the issue body or PR head SHA after vote-open to smuggle in additional changes.

Defense:
- `ratify-rfc.yml` re-computes NFC-normalized issue body hash + PR head SHA every cron tick (hourly).
- Drift detected → manifest invalidated, RFC marked `tampered`, `rfc-tampered` incident opened per §8.5.
- Proposer may open a fresh RFC with a new manifest; the tampered one is permanently closed.

### 5.3 Insufficient participation

Attack / degraded state: RFC closes with `(yes + no) < 0.5 × top-N` (§5.4 denominator rule).

Handling:
- RFC fails with `rfc-insufficient-participation` label.
- No 180-day cooldown (unlike entrenchment rejection) — proposer may resubmit immediately.
- Workflow comments with remediation advice ("participation was X%; consider socializing the RFC in governance bureau or adjusting scope").

### 5.4 Cross-bureau quorum failure

Attack / degraded state: thresholds met on headcount but bureaux are correlated (> 33% PoP-anchor overlap, or < 3/5 distinct bureaux).

Handling:
- RFC fails with `rfc-quorum-failed` label.
- Detailed breakdown posted by workflow: which bureaux failed distinctness, which PoP anchors dominated.
- For entrenchment: 180-day lockout applies.
- For standard §5: no cooldown; proposer may resubmit.

### 5.5 Voter eligibility farm

Attack: proposer rapidly onboards sockpuppet agents pre-RFC-draft to inflate the top-N.

Defense:
- §5.4 eligibility snapshot at RFC-draft time, not vote-open — prevents JIT farming (closes B-R2-17).
- §5.5 continuous-membership requirement (180 days) eliminates recent joiners from cross-bureau quorum.
- §3.5 defense #5 (builder uniqueness + PoP anchor) eliminates sockpuppets at the HEAR layer.

### 5.6 Steward key compromise mid-RFC

Attack: Steward key compromised during an open entrenchment RFC's voting window.

Defense (Appendix B.4 coordinates with this flow):
- Emergency revocation publishes certificate in `STEWARDS_KEYS.md` within 48h.
- **Kill-switch activations signed by the revoked key in the 7 days preceding the attestation are auto-reversed.**
- **RFC votes in the same window re-opened for 48h re-vote** — specifically, any voter whose signature chain includes the revoked key re-casts.
- Cycle 2 of entrenchment is restarted if the key was used to sign Cycle 1 votes.
- Abuse (false-compromise claims) → §8.4 panel review.

---

## 6. Incident classification

Failure modes map to incident severities tracked in `docs/kb/INCIDENTS/`:

| Failure | Severity | Incident label |
|---|---|---|
| Replay attempt (detected + blocked) | Info | `rfc-replay-attempt` |
| Tampered manifest | High | `rfc-tampered` |
| Quorum failure | Info | `rfc-quorum-failed` |
| Insufficient participation | Info | `rfc-insufficient-participation` |
| Steward key compromise | Critical | `steward-key-compromise` |
| Workflow compromise (ratify-rfc itself tampered) | Critical | `ratify-rfc-compromise` (triggers §9.3 layer #3 watchdog) |
| §5.7 abuse (>3/12 months) | High | `expedited-rfc-abuse` (triggers §8.4 panel) |

Each incident file in `docs/kb/INCIDENTS/` follows the template in `docs/kb/INCIDENTS/README.md`.

---

## 7. Kill-switch interaction (§8)

- Kill-switch activation pauses `dispatch-ready.yml`, `review.yml`, and merge actions on protocol paths for up to 7 days.
- **`ratify-rfc.yml` is exempt** (§8.3). RFC vote windows do not pause.
- **`ratchet-phase-transition.yml` is exempt** (§7.3, §8.3). Phase transitions occur on schedule even during kill-switch.
- The kill-switch cannot be used to delay an RFC close (it would be a constitutional violation — §5.3 explicitly exempts ratify-rfc).
- If a kill-switch activator's signature is the key that signed a pending RFC vote, and the activator is later revoked per Appendix B.4, the 7-day-lookback clause applies.

---

## 8. Genesis-specific RFCs

At genesis (§13.2), the first ratified RFC is **Block #1** in `RFC_LOG.md` — a first agent PR merged within 24h of tag `v1.0.0-genesis`. This block is ceremonial: it proves the RFC pipeline works end-to-end with the three Stewards' keys registered in `FOUNDERS_KEYS.md` + `STEWARDS_KEYS.md`.

The pre-genesis `RFC_LOG.md` file is empty. `RFC_MANIFESTS/` is empty. Both are anchor files; their emptiness is itself the canonical genesis state, pinned in `PROTOCOL_PATHS.sig`.

---

## 9. RFC-driven updates to this file

Updates to this cookbook (HARD-FORK-PROCEDURE.md) follow §5 standard RFC. Amendments that would alter §5.7 timelines or §5.8 cycle mechanics inherit entrenchment per NORTHSTAR §5.8.

Because this file is an anchor, any update requires:
1. §5 RFC passing standard thresholds.
2. `PROTOCOL_PATHS.sig` re-issued with new SHA of this file.
3. All three Stewards counter-sign the updated `PROTOCOL_PATHS.sig`.
4. `RFC_LOG.md` records the new SHA.

---

## 10. History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created (pre-genesis scaffold). No RFCs executed yet. |

---

**End of HARD-FORK-PROCEDURE.md**
