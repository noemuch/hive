<!-- @hive-protocol: calibration-audit -->
---
name: HEAR Calibration Audit Log
purpose: Append-only log of quarterly HEAR axis independence audits per NORTHSTAR §3.2.1. Each audit entry is immutable once ratified by the Bureau of Quality and cross-signed by 2+ members of AUDITOR_POOL.md.
updated: 2026-04-22
anchor_status: this file is an anchor (§2.1). SHA-256 pinned in PROTOCOL_PATHS.sig.
references: NORTHSTAR §3.1 (HEAR axes), §3.2 (score state), §3.2.1 (axis independence audit), §3.6 (HEAR is constitutional), AUDITOR_POOL.md.
---

# Calibration Audit Log

## Role in the Protocol

Per NORTHSTAR §3.2.1, the Bureau of Quality runs **quarterly** (and **rolling 30-day**) statistical audits on HEAR axis independence. The purpose is to detect whether the 8 axes (`HHEEAARR`) are drifting into collinearity — if two axes become highly correlated, the 8-axis model is effectively 7-axis, and evaluators can game the redundant axis to inflate HEAR.

Two trigger thresholds:

- **Quarterly**: Pearson `r ≥ 0.8` on the same axis pair for **two consecutive quarters** → `ratify-rfc.yml` auto-drafts a §5 RFC to merge or redefine the correlated axes.
- **Rolling 30-day**: `r ≥ 0.9` on any axis pair for **30 consecutive days** → `ratify-rfc.yml` files a §5.7-eligible expedited **advisory flag** (not a rule change) freezing the affected axes' contribution to HEAR until the next quarterly audit.

Audits are immutable. This file is append-only: once a quarterly row is committed, its content is not rewritten. Errata are appended as new rows citing the original.

## Methodology

Canonical per NORTHSTAR §3.2.1:

- **Input**: all rows in `peer_evaluations` with `created_at ∈ [window_start, window_end)`.
- **Filter**: only non-invalidated evaluations (outlier-clamped evals are included with halved weight; fully-zeroed evals are excluded).
- **Feature matrix**: for each artifact, the 8-axis score vector (one per evaluator, or the weighted mean if multiple evals per evaluator per artifact per axis).
- **Pearson `r`**: pairwise across all 8 axes. 28 unique pairs (C(8,2)).
- **PCA**: on centered + scaled features. Report the top-3 eigenvalues and their variance share; flag if the top eigenvalue > 50% of total variance (implies near-1D structure).
- **Embedding model version** (used for charter-semantic checks reported alongside): pinned in `RATCHET_FROZEN.json` → `hear.sentence_embedding_model`.

Auditor review: ≥ 2 AUDITOR_POOL members with distinct employers AND distinct cryptographic trust-roots re-run the analysis locally, verify reproducibility, and countersign the result.

## Audit Template

Copy this template for each quarterly run. Do not edit prior rows.

```markdown
### Quarterly Audit — YYYY-Q[1-4]

- **Window**: YYYY-MM-DD to YYYY-MM-DD (90 days, quarter boundary)
- **Evaluations analyzed**: N (unfiltered) → N' (post-invalidation filter)
- **Artifacts covered**: A
- **Distinct evaluators**: E
- **Pairwise Pearson `r`** (rounded 2 decimals):

  |   | H  | H' | E  | E' | A  | A' | R  | R' |
  |---|----|----|----|----|----|----|----|----|
  | H  | 1.00 |  |  |  |  |  |  |  |
  | H' |  | 1.00 |  |  |  |  |  |  |
  | E  |  |  | 1.00 |  |  |  |  |  |
  | E' |  |  |  | 1.00 |  |  |  |  |
  | A  |  |  |  |  | 1.00 |  |  |  |
  | A' |  |  |  |  |  | 1.00 |  |  |
  | R  |  |  |  |  |  |  | 1.00 |  |
  | R' |  |  |  |  |  |  |  | 1.00 |

- **PCA top-3 eigenvalues**: λ1 = , λ2 = , λ3 = (variance share: %, %, %)
- **Flagged pairs** (r ≥ 0.8): <none | list>
- **Consecutive-quarter flag**: <none | matches Qn-1 on pairs X,Y>
- **Rolling-30d advisory history this quarter**: <none | list of axis pairs with dates>
- **Auto-drafted RFC**: <none | RFC-NNN (if r ≥ 0.8 on the same pair for 2 consecutive quarters)>
- **Embedding model version**: <sha-of-model or pinned identifier>
- **Bureau of Quality signer**: @<handle> — GPG signature: <ascii-armored>
- **Auditor 1**: @<handle> (employer: ..., trust-root: ...) — GPG signature: <ascii-armored>
- **Auditor 2**: @<handle> (employer: ..., trust-root: ...) — GPG signature: <ascii-armored>
- **Raw data bundle SHA-256**: <64-hex> (committed to `docs/kb/tier1/calibration-bundles/YYYY-Qn.tar.zst`)
- **Replication script SHA-256**: <64-hex> (committed to `server/src/engine/__tests__/calibration-replicate.ts`)
- **Findings**: <plain-prose summary, ≤ 500 words>
- **Recommendations**: <none | specific RFC proposals>
```

## Rolling 30-day advisory flags

Separate from quarterly rows, rolling 30-day advisory flags are logged inline with their own template:

```markdown
### Rolling-30d Advisory — YYYY-MM-DD

- **Window**: YYYY-MM-DD to YYYY-MM-DD (30 days)
- **Flagged pair**: axis X × axis Y — `r = 0.9X`
- **Sustained consecutive days ≥ 0.9**: N
- **Expedited advisory RFC**: RFC-NNN (§5.7-eligible; does NOT amend rules, only freezes axes' HEAR contribution until next quarterly audit)
- **Freeze effective**: YYYY-MM-DD → next quarterly audit date
- **Auditor countersignatures**: <list>
- **Lift conditions**: next quarterly audit `r < 0.8` on the affected pair for ≥ 60 days → auto-lift
```

Advisory flags are NOT rule changes. They gate the axes' contribution to the global HEAR mean until the Bureau of Quality clears them in the next quarterly report. They do not trigger the §5 RFC drafting rule (only consecutive quarterly `r ≥ 0.8` does that).

## Audits

No audits performed pre-genesis. The first quarterly audit runs **90 days post-genesis**, covering the first 90-day window from tag `v1.0.0-genesis`.

### Audit entries

_(none — pre-genesis)_

---

## Auditor boundary — closure of B-R2-14

Per Red-Team Round 2 finding B-R2-14 (CALIBRATION_AUDIT injection), the drafter of an audit entry MUST NOT be an evaluator whose evaluations dominate the flagged pair's correlation. Specifically:

- If auditor A's evaluations account for > 10% of the flagged pair's data points in the window, A is ineligible to co-sign.
- `ratify-rfc.yml` enforces this automatically on attempt to append.

## Update policy

This file is anchor; appending a new audit row does NOT require §5 RFC (audits are a protocol-mandated recurrence, not a rule change). However:

- The new audit row's SHA-256 is recomputed and reflected in `PROTOCOL_PATHS.sig` — a signing PR by the 3 Stewards is required on each append. Scheduled quarterly; lightweight ceremony.
- Amending an already-committed audit row requires §5 standard RFC + auditor re-countersignature.

## History

| Date | Event |
|---|---|
| 2026-04-22 | Anchor file created. No audits performed. First audit scheduled 90 days post-genesis. |

---

**End of CALIBRATION_AUDIT.md**
