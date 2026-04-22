---
name: Legacy Documentation Debt
purpose: Explicit list of stale/wrong claims in legacy docs. Never trust these.
updated: 2026-04-22
---

# Legacy documentation debt

This file lists every known stale / wrong / obsolete claim in the Hive repository's legacy documentation. **When an LLM agent or human reads any of these legacy sources, they must consult this file FIRST to check whether the claim is in the debt list.**

Legacy sources (treated as low-authority by default):

- `CLAUDE.md` — project rules, mostly accurate but has aging claims
- `docs/PRODUCT.md` — product spec, last updated pre-v3, many features since redesigned
- `docs/archive/**` — explicitly historical, never authoritative
- `docs/superpowers/plans/**` — planning docs, many shipped, many abandoned mid-flight
- `docs/superpowers/specs/**` — design docs, several contradict final ship
- `docs/feedback/**` — user feedback drafts, aspirational
- `docs/BYOK.md` — BYOK setup doc, partial
- README.md — project intro

## Known stale claims (grow this list as we find them)

### CLAUDE.md

- [ ] **CLAIM**: "Monthly partitioning on messages and event_log tables."
  **REALITY**: Expert audit (2026-04-22) found `001_init.sql` does NOT create partitions. May exist in a later migration, VERIFY via Q022.
  **STATUS**: To investigate in Q022.
  **CORRECTION**: TBD

- [ ] **CLAIM**: "Reviewer merges EVERYTHING if clean (no path restrictions)."
  **REALITY**: Expert governance (2026-04-22) strongly recommends Meta-Path Exemption for `agents/lib/`, `server/src/engine/peer-evaluation.ts`, `.github/workflows/`. Merging self-modifying code without HITL is L5-RSI territory and unsafe.
  **STATUS**: Accepted recommendation, not yet implemented in review.yml.
  **CORRECTION**: Implement Meta-Path Exemption — blocked by Q024.

- [ ] **CLAIM**: "Archetype-based agent taxonomy (dev/designer/writer/...)."
  **REALITY**: Agents are polymorphic. Multi-expert consensus (2026-04-22) recommends killing the enum, using `displayed_specializations text[]` (already in migration 028) + pgvector embedding.
  **STATUS**: Decision pending Q017 + Q001-010 investigation.
  **CORRECTION**: Remove archetype picker from DeployAgentModal.

### docs/PRODUCT.md

- [ ] Entire doc pre-dates v3 spec (`docs/superpowers/specs/2026-04-19-hive-marketplace-design.md`). Treat as historical.
- [ ] Mentions only 4 demo teams (lyse, vantage, meridian, helix); v3 adds Argus (#243 shipped, Aurora planned, Penrose planned).
- [ ] Protocol section misses `publish_artifact` event type added post-spec.

### docs/archive/**

- All files here are explicitly historical. Never authoritative.

### docs/superpowers/plans/**

Many plans were shipped with significant drift between plan and reality. When reading a plan, verify against shipped code via `git log` before trusting.

### docs/superpowers/specs/**

- [ ] `2026-04-19-hive-marketplace-design.md` — v3 spec, still mostly aspirational. Phases 1-6 shipped in core but several A-numbered amendments are deferred (Hermes, SDK, @hive/adapter).
- [ ] `2026-04-21-hive-full-autonomy-v2-design.md` — shipped. Still accurate but minor tweaks exist.
- [ ] `2026-04-21-zero-intervention-autonomy-design.md` — shipped.

### docs/feedback/**

- All are aspirational drafts. Useful for direction, not for implementation facts.

### docs/BYOK.md

- Listed providers are accurate.
- Missing: OpenRouter as recommended default (expert consensus 2026-04-22). To update after Q010.

---

## Rule for agents

> If a legacy doc says X and it's listed here, ignore it. Check the relevant `QXXX` file in `docs/kb/tier1/` for the current answer.

> If a legacy doc says X and it's NOT listed here, treat it as POSSIBLY stale. Prefer KB. If uncertain, file a new question.
