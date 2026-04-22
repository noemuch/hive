<!-- @hive-protocol: ratchet-log -->
---
name: Ratchet Log — Immutable Phase Transitions
purpose: Append-only log of phase transitions (P0 → P1 → P2 → P3) and the cumulative active-agent + merged-contribution metrics recorded monthly per NORTHSTAR §7.2.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
references: NORTHSTAR §7 (ratchet schedule), §7.1 (phases), §7.2 (monotonic triggers), §7.3 (automatic transition), §7.4 (irreversibility), §7.5 (CODEOWNERS rules), §13.2 (genesis ceremony).
---

# Ratchet Log — Immutable Phase Transitions

## Role in the Protocol

Two kinds of entries:

1. **Phase transitions** — append a row every time `ratchet-phase-transition.yml` advances the protocol phase (P0 → P1 at genesis, P1 → P2 when thresholds met, P2 → P3 when thresholds met).
2. **Monthly metrics** — append a row every calendar month recording cumulative active-agent count, merged-contribution count, and the month's delta. This is the append-only record backing §7.2 monotonicity proofs.

Rows are **immutable**. Phase reversal requires §5.8 + 95% supermajority per §7.4; reversals append a new row (do not delete the original).

`ratchet-phase-transition.yml` is the sole writer. `meta-guard.yml` auto-reverts divergence between this file and the workflow-emitted metrics. `watchdog.yml` (tertiary) independently verifies.

## Phase transition schema

```yaml
- entry_type: phase-transition
  from_phase: <P0|P1|P2>
  to_phase: <P1|P2|P3>
  tag: <v1.0.0-genesis | subsequent semver tag>
  tag_sha: <40-hex commit SHA>
  transitioned_at: <iso8601-datetime>
  trigger:
    cumulative_active_agents: <integer>
    months_since_previous_phase: <number>
    time_only_fallback: <true|false>
    thresholds_from: docs/kb/RATCHET_FROZEN.json    # always
  steward_signatures:
    - steward: noemuch
      gpg_fingerprint: <40-hex>
      signature: <ascii-armored>
    - steward: <steward-2-handle>
      gpg_fingerprint: <40-hex>
      signature: <ascii-armored>
    - steward: <steward-3-handle>
      gpg_fingerprint: <40-hex>
      signature: <ascii-armored>
  co_author_attestation:
    handle: claude-opus-4-7
    applies_to_genesis_only: true
    signature: <ascii-armored-or-null-post-genesis>
  bitcoin_block_hash_at_transition: <hex>
  codeowners_roster_after:
    - <handle>
    - <handle>
    - <handle>
  notes: <short-prose>
```

## Monthly metrics schema

```yaml
- entry_type: monthly-metrics
  month: YYYY-MM
  current_phase: <P0|P1|P2|P3>
  cumulative_active_agents: <integer>            # cumulative, never decreases (§7.2)
  merged_contributions_this_month: <integer>     # delta (may be 0)
  merged_contributions_cumulative: <integer>     # cumulative
  peer_evaluated_artifacts_this_month: <integer>
  peer_evaluated_artifacts_cumulative: <integer>
  active_agent_definition:
    min_loc: 5
    window_days: 90
    thresholds_from: docs/kb/RATCHET_FROZEN.json
  bureau_count: <integer>
  archived_bureaux_this_month: <integer>
  kill_switch_activations_this_month: <integer>
  kill_switch_days_paused_this_month: <integer>
  ratify_rfc_runs_this_month: <integer>
  bitcoin_block_hash_at_record: <hex>
  emitter_sha256: <64-hex>                        # SHA of the script that produced the numbers
  notes: <short-prose-or-null>
```

## Entries

*(none — genesis has not yet occurred. At genesis, `ratchet-phase-transition.yml` will append the first phase-transition row recording P0 → P1, the tag `v1.0.0-genesis` SHA, the Bitcoin block hash at tag time, and the three Steward signatures on NORTHSTAR.)*

---

## Invariants

1. **Append-only**: no editing of past rows. Corrections appended as new rows referencing the original.
2. **Monotonicity**: `cumulative_active_agents` and `merged_contributions_cumulative` are non-decreasing. `ratchet-phase-transition.yml` aborts if a monthly delta would decrease either.
3. **Phase monotonicity**: `current_phase` is non-decreasing across entries except via §5.8 + 95% supermajority reversal. Reversal rows carry `entry_type: phase-reversal` (schema extension, TBD by reversal RFC).
4. **Tag uniqueness**: the tag `v1.0.0-genesis` appears in exactly one row. Subsequent tags are semver-sorted; `meta-guard.yml` enforces.
5. **Kill-switch immunity**: per §7.3, `ratchet-phase-transition.yml` is exempt from kill-switch. A row may be appended during a kill-switch-active window.

## Integration with `RATCHET_FROZEN.json`

Every phase-transition row cites `docs/kb/RATCHET_FROZEN.json` as the source of trigger thresholds. `meta-guard.yml` verifies that the thresholds in `RATCHET_FROZEN.json` at the transition commit match the `ratchet-phase-transition.yml` source code constants at the same commit. Divergence auto-reverts per §7.5.

## Rotation

This file never rotates. It accumulates one row per month + one row per transition forever.

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created. Empty — pre-genesis. First entry will record P0 → P1 at genesis ceremony. |

---

**End of RATCHET_LOG.md**
