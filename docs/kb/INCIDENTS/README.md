<!-- @hive-protocol: incidents-index -->
---
name: Incidents — Kill-Switch Activations and Security Events
purpose: Directory scaffold for immutable incident files covering §8 kill-switch activations, §5.7 expedited RFC triggers, Appendix B.4 emergency key revocations, and any other protocol-level security events.
updated: 2026-04-22
anchor_status: this README is an anchor (§2.1) as the directory index. Individual incident files are also anchors once committed — each file's SHA-256 appears in PROTOCOL_PATHS.sig.
references: NORTHSTAR §8 (emergency kill-switch), §8.5 (post-incident RFC), §5.7 (expedited RFC), Appendix B.4 (emergency key revocation), HARD-FORK-PROCEDURE.md §6 (incident classification).
---

# Incidents Directory

## Role in the Protocol

Every kill-switch activation, expedited-RFC trigger, emergency key revocation, and mirror divergence produces one immutable file in this directory. The file is the canonical post-incident record required by §8.5 and referenced by the follow-up remediation RFC.

## File naming

`<YYYY-MM-DD>-<short-kebab-slug>.md`

Examples:
- `2026-06-15-steward2-key-compromise.md`
- `2026-08-01-mirror-divergence-codeberg.md`
- `2026-09-12-ratify-rfc-tampered-rfc-047.md`

Multiple incidents on the same date: suffix with `-2`, `-3`, etc. The slug is informational; the authoritative handle is the full file path.

## Required sections (per §8.5)

Every incident file MUST contain the following sections in order. `meta-guard.yml` enforces section presence via Markdown AST walk.

```markdown
<!-- @hive-protocol: incident-record -->
---
name: <slug>
incident_class: kill-switch | expedited-rfc | key-revocation | mirror-divergence | rfc-tampered | app-permission-drift | ratify-rfc-compromise | other
severity: critical | high | medium | low | info
phase_at_incident: P0 | P1 | P2 | P3
opened_at: <iso8601>
closed_at: <iso8601-or-null>
remediation_rfc: <rfc-NNN-or-null>
references: NORTHSTAR §X.Y
---

# Incident — <title>

## Activator(s) + signatures
- <handle>, GPG fingerprint <40-hex>, signature <ascii-armored>
- (additional activators as required by §8.2 / Appendix B.4 / etc.)

## Threat description + evidence hash
- Summary (non-exploitable): <prose>
- Evidence bundle SHA-256: <64-hex> (committed to tier1/incident-bundles/<slug>.tar.zst)
- Bitcoin block hash at incident open: <hex>

## Activation timestamp + expected duration
- Activated at: <iso8601>
- Expected duration: <N> days (max 7 for kill-switch per §8.1)
- Actual closure: <iso8601-or-ongoing>

## Affected workflows / files / agents
- <list>

## Post-incident remediation RFC
- RFC type: §5.7 expedited | §5 standard | N/A
- RFC number: <rfc-NNN-or-"none-required">
- Status: <draft | commenting | voting | ratified | rejected | N/A>

## Closure determination
- Declared by: <activators + attesters>
- Closure evidence: <prose>
- Carry-over actions: <if any>

## Panel review (if §8.4 triggered)
- Triggered: <yes|no>
- Panel composition SHA: <64-hex>
- Ruling: <verdict or pending>
- Ruling timestamp: <iso8601>

## History
| Event | Timestamp | Actor |
|---|---|---|
| Opened | ... | ... |
| (subsequent events) | ... | ... |
| Closed | ... | ... |
```

## Append-only rule

Incident files are **append-only** once committed. The only permitted edits are:

1. Appending new rows to the `## History` table.
2. Populating `closed_at` at closure.
3. Adding the `## Panel review` section when §8.4 panel finishes.

Any other edit (including typo fixes) requires a §5 standard RFC. Append-only is enforced by `meta-guard.yml` via Markdown AST diff.

## Severity guidance

| Severity | Typical incident class |
|---|---|
| Critical | Steward key compromise, ratify-rfc tamper, mirror silent divergence, source-to-runtime parity break |
| High | Expedited RFC triggered, app-permission widening detected, quota-monitor fail-closed |
| Medium | RFC-tampered (caught pre-merge), insufficient participation on non-routine RFC |
| Low | Replay attempt (blocked automatically), single kill-switch activation within normal abuse window |
| Info | Routine kill-switch activation (< 3/year) with clean remediation, auto-logged events |

## Cross-reference index

At scale, a top-level `INCIDENTS-INDEX.md` may be introduced to tabulate open + closed incidents by class and severity. Until then, this README is the index. File listing is the canonical enumeration.

## Entries

*(none — no incidents pre-genesis)*

---

## Update policy

- Individual incident files are anchor files. Each file's SHA-256 is pinned in `PROTOCOL_PATHS.sig` at the commit that introduces it.
- This README may be amended via §5 standard RFC.

## History

| Date | Event |
|---|---|
| 2026-04-22 | Directory scaffold created. No incidents pre-genesis. |

---

**End of INCIDENTS/README.md**
