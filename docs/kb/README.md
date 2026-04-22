---
name: Hive Knowledge Base
purpose: Canonical answers to all architecture/product/tech questions
audience: LLM agents (primary), Noé (secondary)
created: 2026-04-22
---

# Hive Knowledge Base (`docs/kb/`)

## Purpose

Single source of truth for every architectural + product + technical decision on Hive. Each question from the 150-question master list gets a dedicated atomic file with a verified answer, POC code when applicable, and cross-references.

**This KB supersedes any claim in legacy docs** (`docs/PRODUCT.md`, `docs/archive/**`, `docs/superpowers/plans/**`, `docs/superpowers/specs/**`, large parts of `CLAUDE.md`). When legacy docs and KB disagree, **KB wins**.

See `_DEBT.md` for known-stale legacy claims.

## Navigation

| File | Purpose |
|---|---|
| `README.md` | You are here. Meta |
| `_TEMPLATE.md` | Structure for each question doc |
| `_DEBT.md` | Legacy docs NOT to trust, with corrections |
| `_ROADMAP.md` | The 30 Tier-1 questions, priority order, dependency graph |
| `_GLOSSARY.md` | Shared terms (agent, company, artifact, HEAR, etc.) |
| `STATUS.md` | Live progress tracker |
| `tier1/QXXX-*.md` | One file per question, following `_TEMPLATE.md` |
| `tier1/pocs/` | Runnable proof-of-concept code tied to questions |

## Reading rules (for LLM agents working on Hive)

1. **Before any architecture decision**: consult `STATUS.md` + the relevant `QXXX` file.
2. **Never read `docs/PRODUCT.md` or `docs/archive/**`** as authoritative. Only for historical context.
3. **Treat `CLAUDE.md` as "rules of engagement"**, not "architecture truth". When it disagrees with a `QXXX` doc, the KB wins.
4. **If a claim is not in the KB**: flag as OPEN, don't invent. File a new question if critical.
5. **Every KB answer has an `expires_date`**: if the expiration has passed, mark STALE and re-investigate.

## Writing rules (for creating new KB entries)

1. Follow `_TEMPLATE.md` exactly. Frontmatter fields are parsed programmatically.
2. Short files (200-500 lines). If a question doesn't fit, split it.
3. Every claim must have a source (URL, commit SHA, file:line, or `self-tested on YYYY-MM-DD`).
4. POC code lives in `pocs/QXXX-<slug>/`, referenced from the doc.
5. Cost of research (LLM tokens $) declared in frontmatter.
6. Confidence level (HIGH/MEDIUM/LOW) required.

## Tiers

- **Tier 1** (30 questions, 2 weeks of deep work): blocking for ship of architectural pivot. In flight.
- **Tier 2** (~60 questions, deferred): important but fixable post-launch. On ice.
- **Tier 3** (~60 questions, skip): speculative / post-traction. Not touched.

See `_ROADMAP.md` for the Tier 1 list.

## Operating cadence

- Research one question at a time (or in small parallel batches when independent).
- POC code must run end-to-end. "Read the doc and infer" is NOT acceptable for Tier 1.
- Each question doc is checked in via a commit dedicated to that question.
- `STATUS.md` is updated at every question transition.
