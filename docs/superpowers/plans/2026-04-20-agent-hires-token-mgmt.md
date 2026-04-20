# Agent Hires Token Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `POST/DELETE/GET /api/agents/:id/hires` endpoints — owner-only HTTP-mode hire tokens for issue #221.

**Architecture:** Mirror the existing `api_key` pattern (prefix-based O(1) lookup, bcrypt-hashed). Token is generated once on POST and never retrievable. DELETE sets `revoked_at = now()` (immediate revocation). GET lists hires for the agent, owner only.

**Tech Stack:** Bun + Pg + bcrypt (`Bun.password.hash`). Routes wired in `server/src/index.ts`. Handlers extracted into `server/src/handlers/agent-hires.ts`. Pure helper in `server/src/auth/hire-token.ts`.

---

### Task 1: hire-token helper (TDD)

**Files:**
- Create: `server/src/auth/hire-token.ts`
- Test: `server/src/auth/hire-token.test.ts`

- [ ] Write failing tests: `generateHireToken()` returns `hire_<32hex>`; `hireTokenPrefix()` returns first 8 chars; `hashHireToken()` + `verifyHireToken()` round-trip via bcrypt.
- [ ] Run tests — expect FAIL (module missing).
- [ ] Implement minimal helper.
- [ ] Run tests — expect PASS.

### Task 2: agent-hires handler (TDD)

**Files:**
- Create: `server/src/handlers/agent-hires.ts`
- Test: `server/src/handlers/agent-hires.test.ts`

- [ ] Write failing tests for `handleCreateHire` (owner only / token shown once / persists row), `handleListHires` (owner only / no token leak), `handleRevokeHire` (sets `revoked_at`).
- [ ] Run tests — expect FAIL.
- [ ] Implement handlers using mock pool.
- [ ] Run tests — expect PASS.

### Task 3: Wire routes in `server/src/index.ts`

- [ ] Add 3 routes for `/api/agents/:id/hires` and `/api/agents/:id/hires/:hire_id` BEFORE the existing `DELETE /api/agents/:id` route so the more-specific path matches first.
- [ ] Run `bun test` and `bun run lint`.

### Task 4: Self-review + commit

- [ ] Quality gate scan (no secrets, no hardcoded URLs/UUIDs, parameterized SQL, no SELECT *, indexed WHERE).
- [ ] Commit, push, open PR with Methodology block.

### Out of scope

- LLM key encryption → #223 (column stored as plaintext for now, TODO marker at insert site).
- `POST /api/agents/:id/respond` → #222.
- Per-hire rate limiting → #223.
