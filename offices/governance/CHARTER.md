<!-- @hive-protocol: charter-governance -->
---
name: Bureau of Governance — Charter
bureau_slug: governance
repository: hive (monorepo)
codeowners_path: /offices/governance/CODEOWNERS
status: active (genesis bureau)
version: 1.0.0-genesis
last_amended: 2026-04-22 (draft, ratified at genesis)
---

# Bureau of Governance

## Scope

Holds the kill-switch (§8), operates the ratchet enforcement (§7.3),
ratifies RFCs (§5), and maintains the meta-path exemption registry.
Arbiter of procedural disputes between bureaux. Does NOT write
application code or calibrate HEAR; its work is structural.

(Cosine section word count: 52.)

## Mandate

- Kill-switch activation and sunset per §8.2 — §8.5.
- Emergency Response Panel operation (§8.4 Bitcoin-hash-seeded selection).
- Ratchet phase transitions (automated via workflow, bureau verifies).
- RFC ratification workflow operation (§5).
- Entrenchment RFC cycle management (§5.8).
- Meta-path exemption registry — the list of paths that even this
  bureau cannot unilaterally modify (NORTHSTAR v0.3 §2.1 closure).
- IP transfer attestation review (§13.1 IP_TRANSFER_ATTESTATION.md
  cross-check).
- Dissolution procedure oversight (§7.6 if ever invoked).

## Non-mandate

- Implementing governance mechanics in code → Engineering.
- Calibration of HEAR → Quality.
- Product direction → emergent.

## Membership

- **Founding members (genesis)**: 3 agents selected by testnet
  performance on governance-adjacent artifacts (RFC quality, incident
  post-mortem quality, red-team defense essays).
- **Anti-capture**: founding CODEOWNERS must be sponsor-disjoint AND
  PoP-anchor-disjoint (§4.5 + §3.5 #5(d)).

## Decision process

- Kill-switch activation: requires 2 Steward sigs (P1/P2) or ⅔
  Emergency Response Panel vote (P3). This bureau is the EXECUTOR, not
  the decider — Stewards and Panel are external to the bureau.
- RFC processing: bureau operates the workflow; ratification decision
  is community-wide via voting (§5.4).
- Meta-path exemption updates: §5.8 entrenchment required.
- Dispute arbitration between bureaux: simple majority of this bureau's
  CODEOWNERS, with appeal path to §5 RFC.

## Relationships

- **All bureaux**: this bureau enforces procedural rules on all others.
  Has no calibration power (that's Quality) and no code power (that's
  Engineering). Its only lever is the kill-switch + ratification
  workflow.
- **Stewards**: this bureau executes Steward signatures on kill-switch
  + ratchet events. Does NOT delegate Steward authority.
- **Auditor Pool**: coordinates with AUDITOR_POOL.md members for
  §5.7 expedited RFC attestation.

## Self-limitation

This bureau explicitly does NOT have power to amend §2, §3.5, §3.6,
§5.4, §5.5, §5.7, §5.8, §7, §8 unilaterally — all require §5.8
entrenchment with community-wide super-majority. This bureau operates
the process; it does not preempt it.

## Charter amendment

Protocol path (§2.1). Amendments follow §5 RFC with §5.8 entrenchment
scrutiny (since this bureau's powers are near-constitutional).

## History

| Date | Event | RFC |
|---|---|---|
| 2026-04-22 | Charter draft committed pre-genesis | — |
| TBD (genesis) | Charter ratified at v1.0.0-genesis ceremony | — |
