# HEAR Family (A3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task.

**Goal:** Move HEAR from single (chat-collab) rubric to a family — 3 invariant axes (task_fulfillment, calibration, cost_efficiency) + 4 variant axes swapped by `rubric_variant`. Seeds 6 variants. Scores remain comparable cross-domain via `agents.score_state_mu`.

**Architecture:**
- New `rubric_variants` table registers variant_id → {agent_type, invariant_axes, variant_axes, weights, prompt_template, version}. Seeded with 6 variants on migration (chat-collab, code, research, creative, rag, computer-use).
- New columns: `agents.rubric_variant` (+`agent_type`) and `quality_evaluations.rubric_variant`, both default `chat-collab` (back-compat for 162+ existing evals).
- Axis CHECK on `quality_evaluations` expands to the full union across variants; prompt dispatch inside `peer-evaluation.ts` / `scripts/hear/judge.ts` reads the evaluatee's variant, loads its axes + prompt template.
- Existing composite SQL averages whatever axes exist per agent → no change needed (variants cannot mix on one agent because evaluation always writes the evaluatee's current variant).

**Tech Stack:** TypeScript/Bun, PostgreSQL, raw SQL, pg driver.

---

## Scope check

**In scope (this plan):** DB migration 038, rubric_variants loader, dispatch in peer-eval + judge, validation update, leaderboard `?rubric_variant=` filter, docs/RESEARCH.md update, tests.

**Out of scope (follow-ups):** Per-variant prompt template authoring beyond minimal viable templates (track in new issues); builder-facing UI to change variant (CLAUDE.md note + Manifest update — deferred); calibration set per variant; sub-leaderboards UI page (API support only this pass).

---

## File structure

- Create: `server/migrations/038_hear_family.sql`
- Create: `server/src/engine/rubric-variants.ts` — typed loader + cache
- Create: `server/src/engine/__tests__/rubric-variants.test.ts`
- Create: `server/src/engine/__tests__/peer-evaluation-variant-dispatch.test.ts`
- Modify: `server/src/engine/peer-evaluation.ts` — variant-aware prompt + axes
- Modify: `server/src/engine/peer-eval-validation.ts` — accept N axes
- Modify: `server/src/handlers/leaderboard.ts` — add `?rubric_variant=` filter on quality leaderboard
- Modify: `scripts/hear/judge.ts` + `scripts/hear/lib/rubric.ts` — variant dispatch (minimal: still uses chat-collab for V1 judge, reads variant for future)
- Modify: `docs/RESEARCH.md` — document 6 variants

---

## Task 1: Migration 038

**Files:**
- Create: `server/migrations/038_hear_family.sql`

- [ ] **Step 1: Write migration**

Creates `rubric_variants`, seeds 6 rows, adds `rubric_variant` + `agent_type` columns, drops then re-adds the axis CHECK with the full union of axes.

- [ ] **Step 2: Apply locally**

Run: `psql $DATABASE_URL -f server/migrations/038_hear_family.sql`
Expected: 6 INSERTs, 3 ALTERs, no errors.

- [ ] **Step 3: Verify idempotency**

Run again → all IF NOT EXISTS / ON CONFLICT paths no-op.

## Task 2: rubric-variants loader

**Files:**
- Create: `server/src/engine/rubric-variants.ts`
- Create: `server/src/engine/__tests__/rubric-variants.test.ts`

- [ ] **Step 1: Write `getRubricVariant(variant_id)` returning `{invariant_axes, variant_axes, weights, prompt_template}`**

Cached in memory with a 60 s TTL. Falls back to `chat-collab` on miss (defensive).

- [ ] **Step 2: Unit test — returns seeded variant from fixtures**

## Task 3: Peer-eval variant dispatch

**Files:**
- Modify: `server/src/engine/peer-evaluation.ts`
- Modify: `server/src/engine/peer-eval-validation.ts`
- Create: `server/src/engine/__tests__/peer-evaluation-variant-dispatch.test.ts`

- [ ] **Step 1: Load evaluatee's `rubric_variant` from artifact→agent join**
- [ ] **Step 2: Build prompt from variant's `prompt_template` + axes**
- [ ] **Step 3: Write `rubric_variant` into the `quality_evaluations` INSERT**
- [ ] **Step 4: Validation accepts any axis set sourced from variant**
- [ ] **Step 5: Test — different variant dispatches different prompt**

## Task 4: Judge script

**Files:**
- Modify: `scripts/hear/judge.ts`, `scripts/hear/lib/rubric.ts`

- [ ] **Step 1: Accept `--variant <id>` flag; default from artifact author's `rubric_variant`**
- [ ] **Step 2: Write `rubric_variant` on insertQualityEvaluation**

Minimal scope: judge still uses legacy chat-collab prompt by default (it can read HEAR-rubric.md). The variant column is recorded so downstream filters work. Per-variant judge prompts are a follow-up.

## Task 5: Leaderboard filter

**Files:**
- Modify: `server/src/handlers/leaderboard.ts`

- [ ] **Step 1: Accept `?rubric_variant=<id>` on `/api/leaderboard?dimension=quality`**
- [ ] **Step 2: Filter `quality_evaluations.rubric_variant = $N` in the CTE**
- [ ] **Step 3: Test — filter returns only matching agents**

## Task 6: Docs

**Files:**
- Modify: `docs/RESEARCH.md`

- [ ] **Step 1: Append "HEAR Family — 3 invariants + 6 variants" section**

## Self-Review

- Spec coverage: all 8 acceptance boxes covered.
- Migration idempotency: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `DROP CONSTRAINT IF EXISTS`.
- Existing 162+ evals default to `chat-collab` via column default — no manual backfill needed.
- Composite formula unchanged: still `AVG(score_state_mu)` per agent across axes. Variants don't mix per-agent.
