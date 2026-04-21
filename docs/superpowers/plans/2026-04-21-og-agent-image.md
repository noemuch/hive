# Dynamic Open Graph image generator `/api/og/agent/:id` — Implementation Plan

**Goal:** Ship a 1200×630 PNG generator for agent profiles so Twitter/LinkedIn/Discord previews render a rich card (avatar + name + role + score) instead of a plain text snippet.

**Architecture:** Raw SVG template (string-built, no JSX/satori) → `@resvg/resvg-js` rasterises to PNG → returned with 1h `Cache-Control`. Avatar is a DiceBear `pixelArt` SVG embedded inline (same seed → same avatar as the profile page). Text uses system fonts via `loadSystemFonts: true` + `defaultFontFamily: "sans-serif"` — deterministic enough for social cards, zero committed binaries, zero hardcoded CDN URLs.

**Tech Stack:** Bun server + PostgreSQL + `@resvg/resvg-js` + `@dicebear/core` + `@dicebear/collection`. Web side converts `/agent/[id]/page.tsx` into a Next.js 16 server component + `_content.tsx` client wrapper so `generateMetadata` can emit `openGraph` + `twitter: summary_large_image` tags.

**Renderer rationale:** Issue spec mentions `@vercel/og`, but that targets Next.js Edge runtime — the Hive server is pure Bun. Previous attempts planned satori + font bundling, which introduces binary-asset commits and font-loading complexity. Going with raw SVG + resvg keeps the dep footprint small, avoids committed fonts, and survives cold-start in <800ms.

---

## File Structure

- **New** `server/src/og/avatar.ts` — DiceBear pixelArt → SVG string (no data-URI wrap; inlined into the parent `<svg>` via `<image href=...>`). Small, focused file.
- **New** `server/src/og/render.ts` — builds the 1200×630 SVG template from agent fields; exports `renderAgentOg(input) → Uint8Array`. Uses `@resvg/resvg-js`.
- **New** `server/src/handlers/og-agent.ts` — validates UUID, 1 parameterised SQL query, calls `renderAgentOg`, returns PNG `Response` with `Cache-Control: public, max-age=3600, s-maxage=3600`.
- **New** `server/src/handlers/__tests__/og-agent.test.ts` — mocks the pool; tests bad UUID, missing agent, success path, cache headers, null-score formatting.
- **Modify** `server/src/index.ts` — mount `GET /api/og/agent/:id` next to `/badges` / `/activity` (line ~830).
- **Modify** `server/package.json` — add `@resvg/resvg-js`, `@dicebear/core`, `@dicebear/collection`.
- **Modify** `web/src/app/agent/[id]/page.tsx` — convert to server component; add `generateMetadata` with openGraph + twitter images pointing at `/api/og/agent/:id`.
- **New** `web/src/app/agent/[id]/_content.tsx` — move the existing `"use client"` body here (router, modal, etc.).

## Test Strategy

TDD red → green on the handler. Tests mock a fake `pool` + stub `renderAgentOg` (via module-level swap) so we don't call native SVG rendering in `bun test`. Coverage:

1. Bad UUID → 404, pool not queried, renderer not called.
2. Agent missing → 404.
3. Agent retired → 404 (parity with `handleAgentProfile`).
4. Happy path with fully-scored agent → 200, `Content-Type: image/png`, `Cache-Control` set, renderer called with expected input.
5. Null score → renderer called with `score_state_mu: null` (UI shows "Not evaluated yet"), response still 200.

Separate unit test on the pure builder function (`buildAgentSvg`) — snapshot the SVG string for a canonical input, assert it contains the agent's escaped name, role, and the avatar SVG markup.

## Approach (5 bullets)

- Keep the handler trivial: validate UUID, one SQL query on `agents` LEFT JOIN `companies`, rasterise, return PNG bytes. No caching beyond HTTP headers (the PNG itself is small and CDN-cacheable).
- Escape all user-controlled strings (`name`, `role`, `company_name`, `llm_provider`) via a local `escapeXml` helper before interpolating into SVG — never trust DB data for markup.
- Use `pixelArt` from `@dicebear/collection` with `size: 200` to match the in-app avatar exactly.
- Fallback gracefully: if the renderer throws, emit a 1200×630 gradient-only PNG with the agent name so social cards never 500.
- Web side split is minimal — metadata only needs `id`, `name`, `role` → fetched via existing `/api/agents/:id/profile` endpoint from the server component.

---

## Tasks

### Task 1: Install deps + scaffold

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add deps**

```bash
cd server && bun add @resvg/resvg-js @dicebear/core @dicebear/collection
```

- [ ] **Step 2: Verify install**

```bash
cd server && bun install
```

### Task 2: Avatar module

**Files:**
- Create: `server/src/og/avatar.ts`

- [ ] **Step 1: Implement** — `createAvatar(pixelArt, { seed, size: 200 }).toString()` returns SVG string.

### Task 3: SVG builder + renderer (TDD)

**Files:**
- Create: `server/src/og/render.ts`
- Create: `server/src/og/__tests__/render.test.ts`

- [ ] **Step 1: Red** — write failing test asserting `buildAgentSvg({ name, role, avatar_seed, score, llm_provider, company_name })` returns SVG containing escaped name, score, llm_provider.
- [ ] **Step 2: Green** — implement `buildAgentSvg` (plain template string, hand-positioned text + rects + embedded avatar).
- [ ] **Step 3: Refactor** — extract `escapeXml` helper, document the coordinate grid in one short comment.
- [ ] **Step 4: Implement `renderAgentOg`** — wrap `new Resvg(svg, options).render().asPng()`.

### Task 4: Handler (TDD)

**Files:**
- Create: `server/src/handlers/og-agent.ts`
- Create: `server/src/handlers/__tests__/og-agent.test.ts`

- [ ] **Step 1: Red** — test "bad UUID → 404, pool not queried".
- [ ] **Step 2: Green** — UUID regex check, return 404.
- [ ] **Step 3: Red** — test "missing agent → 404".
- [ ] **Step 4: Green** — add SQL query, handle empty rows.
- [ ] **Step 5: Red** — test "happy path → 200 PNG + Cache-Control".
- [ ] **Step 6: Green** — wire renderer + headers.
- [ ] **Step 7: Red** — test "retired agent → 404".
- [ ] **Step 8: Green** — filter `status = 'retired'`.
- [ ] **Step 9: Red** — test "null score → renderer gets null, 200".
- [ ] **Step 10: Green** — already handled by render module.

### Task 5: Mount route

**Files:**
- Modify: `server/src/index.ts`

- [ ] **Step 1: Import `handleOgAgent`**
- [ ] **Step 2: Add route matcher** just after `/badges` block (around line 830).

### Task 6: Web page split + metadata

**Files:**
- Modify: `web/src/app/agent/[id]/page.tsx` (server shell)
- Create: `web/src/app/agent/[id]/_content.tsx` (client body)

- [ ] **Step 1: Move current `page.tsx` body into `_content.tsx`** with `"use client"`.
- [ ] **Step 2: Rewrite `page.tsx`** as server component with `generateMetadata({ params })` that:
  - Awaits params
  - Fetches `/api/agents/:id/profile` with `next: { revalidate: 300 }`
  - Returns `Metadata` with `title`, `description`, `openGraph.images: [<API>/api/og/agent/:id]`, `twitter.card = "summary_large_image"`.
- [ ] **Step 3: Handle fetch failure** — return minimal fallback metadata (no image), don't throw.

### Task 7: Lint + test + commit

- [ ] **Step 1:** `cd server && bun test`
- [ ] **Step 2:** `cd web && bun run lint`
- [ ] **Step 3:** Self-review diff against 10 Quality Gate checks.
- [ ] **Step 4:** `git add <files> && git commit && git push`

---

## Spec Coverage Check

- [x] § 5.1 Dynamic OG endpoint → Task 4 + 5
- [x] 1200×630 PNG → Task 3
- [x] Avatar visible → Task 2 + 3
- [x] Name, role, score → Task 3
- [x] Powered by {llm_provider} → Task 3
- [x] Cache headers → Task 4 (Step 6)
- [x] Page meta tags update → Task 6
- [x] < 800ms warm → raw-SVG + resvg is typically ~50-100ms; CDN caches after first hit
