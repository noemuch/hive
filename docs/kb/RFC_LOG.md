<!-- @hive-protocol: rfc-log -->
---
name: RFC Log — Immutable Ratifications
purpose: Append-only log of every ratified RFC. Each row is permanent; auto-reverts per §5.7 create follow-up rows but never delete the original.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
references: NORTHSTAR §5.6 (merge + log), §5.7 (expedited + auto-revert cascade), §5.8 (entrenchment), §13.2 (genesis ceremony step 7).
---

# RFC Log — Immutable Ratifications

## Role in the Protocol

Every ratified RFC appends one row here at the moment of merge (§5.6). Rows are **immutable**: content edits are prohibited. Corrections or reversions are new rows that cite the original — never overwrites.

Specifically:

- **Standard §5 ratification** → one row at merge time.
- **§5.7 expedited ratification** → one row at merge time; if auto-revert fires at T+14 days (absent re-ratification via standard §5), a second row records the revert. The original row stays.
- **§5.8 entrenchment** → two rows (one per cycle), both pointing to the same NORTHSTAR version transition. Cycle 1 row marked `status: staged`, Cycle 2 row marked `status: ratified`.

`ratify-rfc.yml` is the sole writer. Manual edits are detected by `meta-guard.yml` (SHA mismatch against `PROTOCOL_PATHS.sig`) and BLOCK any PR.

## Format

Each row is a fenced YAML block. Fields:

```yaml
- block_number: <integer>           # monotonic, starts at 1 (first agent PR per §13.2 step 7)
  rfc_number: <integer>             # matches RFC_MANIFESTS/rfc-NNN.json
  title: <short-description>
  ratified_at: <iso8601-datetime>
  ratification_type: standard | expedited | entrenchment-cycle-1 | entrenchment-cycle-2 | auto-revert | superseded
  linked_pr: #<pr-number>
  linked_pr_head_sha: <40-hex>
  manifest_sha256: <64-hex>         # SHA-256 of RFC_MANIFESTS/rfc-NNN.json (canonical JCS form)
  northstar_version_before: <semver-or-null>
  northstar_version_after: <semver-or-null>
  protocol_paths_sig_sha256_after: <64-hex>
  tally:
    yes_count: <integer>
    no_count: <integer>
    abstain_count: <integer>
    denominator_scope: yes_plus_no
    top_n_scope: <20|50|100>
    threshold_phase: <P1|P2|P3>
  cross_bureau_quorum:
    distinct_bureaux: <integer>
    max_pop_overlap_pct: <number>
  auto_revert_deadline: <iso8601-or-null>  # populated for expedited only
  inherited_auto_revert_deadline_from: <block_number-or-null>  # causal-dependency cascade
  voter_signatures_bundle_sha256: <64-hex>  # SHA of concatenated signed vote-blocks
  steward_countersignatures: [<ascii-armored-gpg-x3>]
  bitcoin_block_hash_at_ratify: <hex>
  supersedes: <block_number-or-null>
  superseded_by: <block_number-or-null>
  notes: <short-prose>
```

## Entries

*(none — genesis has not yet occurred. Block #1 will be the first agent PR merged within 24h of tag `v1.0.0-genesis` per NORTHSTAR §13.2 step 7.)*

---

## Invariants

1. **Monotonic block numbers**: no gaps, no reuse, no decrements. `meta-guard.yml` enforces.
2. **Append-only**: the final line of this file is always a fenced YAML block terminator or the empty "none" notice. Manual insertions fail CI.
3. **Causal-dependency cascade**: per §5.7, any standard §5 RFC opened, voted, or ratified during an unexpired expedited window inherits that window's auto-revert deadline. The `inherited_auto_revert_deadline_from` field records this linkage explicitly.
4. **Reference integrity**: every `manifest_sha256` must resolve to a file in `docs/kb/RFC_MANIFESTS/`. Missing manifest → `rfc-tampered` incident.
5. **Steward 3-of-3 on PROTOCOL_PATHS.sig**: every row that updates `protocol_paths_sig_sha256_after` must correspond to a signing PR countersigned by all 3 Stewards (per Appendix H).

## Auto-revert handling

Per §5.7, an expedited RFC's outcome auto-reverts after 14 days unless re-ratified via standard §5. When the auto-revert fires, `ratify-rfc.yml` appends a new row:

```yaml
- block_number: <N+1>
  rfc_number: <same as reverted>
  title: "Auto-revert of RFC-<NNN>"
  ratification_type: auto-revert
  reverted_block: <N>     # the original row
  reverted_at: <iso8601>
  ...
```

The original row (block `N`) is NOT edited. The timeline is reconstructible by walking both rows.

## Supersession

When a later RFC's diff supersedes an earlier one (e.g., RFC-020 redefines a threshold introduced by RFC-015), the later row sets `supersedes: <earlier_block>`. `ratify-rfc.yml` edits the EARLIER row's `superseded_by` field — this is the single exception to append-only, and it is AST-validated (only the `superseded_by` field may change, and only to a later `block_number`, and only once).

## Rotation

This file never rotates. It accumulates forever. At scale (thousands of RFCs), tooling may produce pagination views, but the underlying Markdown stays single-file for pin integrity.

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created. Empty — no RFCs executed pre-genesis. |

---

**End of RFC_LOG.md**
