---
title: World Grid Page
status: shipped
shipped: 2026-04-08
created: 2026-04-08
estimate: 3h
tier: standard
issue: "#67"
---

# World Grid Page

## Context

The home page (`/`) is a placeholder. Users landing on Hive need to see all active companies at a glance — a live world grid with cards, search, sort, and filter. This is the D2 deliverable following D1 design system + API enrichment.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `web/src/app/page.tsx` | MODIFY | Replace placeholder with grid layout + data fetching |
| `web/src/components/NavBar.tsx` | CREATE | Fixed header with logo, nav links, auth-conditional user menu |
| `web/src/components/CompanyCard.tsx` | CREATE | Card component displaying company info, stats, live badge |
| `web/src/components/GridControls.tsx` | CREATE | Search input, sort dropdown, status filter toggle group |
| `web/src/components/CompanyGrid.tsx` | CREATE | Grid container with loading/empty/error states + polling |
| `web/src/app/company/[id]/page.tsx` | AFFECTED | CompanyCard click navigates here — no changes needed |
| `web/src/providers/auth-provider.tsx` | AFFECTED | NavBar consumes `useAuth()` — no changes needed |

**Files:** 4 create | 1 modify | 2 affected
**Reuse:** shadcn `Card`, `Badge`, `Input`, `DropdownMenu`, `ToggleGroup`, `Skeleton`, `Button`, `Avatar`; `useAuth()` hook; `cn()` util; lucide-react icons; oklch theme tokens from globals.css
**Breaking changes:** None — page.tsx is a placeholder, no consumers
**New dependencies:** None — everything exists in package.json

## User Journey (MANDATORY)

### Primary Journey

ACTOR: Visitor (anonymous or authenticated)
GOAL: Browse all companies in the Hive, find interesting ones, click to watch
PRECONDITION: Server running, at least 1 company exists

1. User navigates to `/`
   → System fetches `GET /api/companies`
   → User sees skeleton grid (6 shimmer cards) during load
   → Anonymous users see a tagline above the grid: "AI companies running 24/7. Watch their agents work."

2. Data loads successfully
   → System renders grid of CompanyCards
   → User sees each card with: name, description (2-line truncated), agent count, messages today, LIVE badge if active agents, status badge

3. User types in search box
   → System filters cards client-side by company name (case-insensitive, debounced 200ms)
   → User sees filtered grid with smooth transition

4. User selects sort option "Most Active"
   → System re-fetches `GET /api/companies?sort=activity`
   → Grid reorders with transition

5. User toggles filter to "Active"
   → System re-fetches `GET /api/companies?status=active`
   → Grid shows only active companies

6. User clicks a CompanyCard
   → System navigates to `/company/:id`
   → User sees the office view (GameView)

POSTCONDITION: User is watching a company's office

### Error Journeys

E1. API fetch fails (network/server error)
   Trigger: `GET /api/companies` returns error or times out
   1. User lands on `/`
      → System shows error state: "Couldn't load the world."
      → User sees a "Retry" button
   2. User clicks Retry
      → System re-fetches
   Recovery: Grid loads normally or error persists

E2. Zero companies exist
   Trigger: API returns `{ companies: [] }` with no active filters
   1. User lands on `/`
      → System shows empty state: "The Hive is starting up. First companies forming soon."
   Recovery: Polling will pick up new companies within 30s

E3. Filters return nothing
   Trigger: API returns data but client-side search/filter yields 0 matches
   1. User has search or filter active
      → System shows: "No companies match your search." + "Clear filters" button
   2. User clicks "Clear filters"
      → System resets search + filter, shows full grid
   Recovery: Full grid restored

### Edge Cases

EC1. Search matches nothing: Same as E3 — "No companies match" + clear button
EC2. Filter + search combined: Both apply simultaneously
EC3. User is authenticated: NavBar shows avatar dropdown instead of "Watch" button
EC4. Tab visibility: Polling pauses when tab is hidden, resumes on focus

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING — all must pass to ship)

- [x] AC-1: GIVEN page loads WHEN user visits `/` THEN skeleton grid (6 cards) displays during fetch, with tagline for anonymous users
- [x] AC-2: GIVEN API returns companies WHEN data loads THEN grid renders CompanyCards with name, description, stats, badges
- [x] AC-3: GIVEN company has `active_agent_count > 0` WHEN card renders THEN green LIVE badge with pulse animation shows
- [x] AC-4: GIVEN user types in search WHEN input changes (debounced 200ms) THEN grid filters by company name (client-side, case-insensitive)
- [x] AC-5: GIVEN user selects sort option WHEN option changes THEN API re-fetches with `?sort=` param and grid reorders
- [x] AC-6: GIVEN user selects status filter WHEN filter changes THEN API re-fetches with `?status=` param
- [x] AC-7: GIVEN user clicks a CompanyCard WHEN click THEN navigates to `/company/:id`
- [x] AC-8: GIVEN NavBar renders WHEN user is anonymous THEN shows: Logo, Leaderboard link, "Watch" primary button
- [x] AC-9: GIVEN NavBar renders WHEN user is authenticated THEN shows: Logo, Leaderboard, Dashboard, Avatar dropdown (Profile, Settings, Logout)
- [x] AC-10: GIVEN grid is visible WHEN 30 seconds pass THEN data auto-refreshes via polling

### Error Criteria (BLOCKING — all must pass)

- [x] AC-E1: GIVEN API fails WHEN fetch errors THEN error message + Retry button displays (no crash)
- [x] AC-E2: GIVEN API returns empty array WHEN no companies exist THEN empty state: "The Hive is starting up" (no clear button)
- [x] AC-E3: GIVEN filters/search active WHEN results are empty THEN "No companies match" + "Clear filters" button

### Should Have (ship without, fix soon)
- [x] AC-S2: GIVEN sort/filter/search change WHEN grid updates THEN smooth CSS transition on reorder
- [x] AC-S3: GIVEN controls active WHEN user changes THEN URL syncs with `?q=&sort=&filter=` via useSearchParams

## Scope

- [x] 1. Create `NavBar.tsx` — fixed header, logo, nav links, auth-conditional menu → AC-8, AC-9
- [x]2. Create `CompanyCard.tsx` — Card with thumbnail fallback, name, description, stats, badges, hover → AC-2, AC-3, AC-7
- [x]3. Create `GridControls.tsx` — search input, sort dropdown, status filter toggles → AC-4, AC-5, AC-6
- [x]4. Create `CompanyGrid.tsx` — grid container, fetch logic, polling, loading/empty/error states. State architecture: `rawCompanies` (from API/polling) separated from `filteredView` (derived from raw + search + sort + filter) so polling never resets user controls → AC-1, AC-10, AC-E1, AC-E2, AC-E3
- [x]5. Refactor `page.tsx` — compose NavBar + GridControls + CompanyGrid → all ACs

### Out of Scope

- Thumbnail endpoint (`/api/companies/:id/thumbnail`) — doesn't exist, use gradient fallback
- WebSocket `watch_all` — not implemented server-side, use polling
- Authentication pages (login/register) — separate issue
- Company page refactor (`/company/[id]`) — already working
- Agent profile pages, leaderboard, dashboard content

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing tests
- [ ] Error states handled (not just happy path)
- [ ] No hardcoded secrets or credentials
- [ ] Responsive grid: 1 col mobile, 2 cols md, 3 cols lg
- [ ] `bun run lint` passes in web/

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing
- [ ] URL params sync with controls
- [ ] Hover/transition animations smooth
- [ ] Accessible: keyboard navigation on cards, proper aria labels

## Test Strategy (MANDATORY)

### Test Environment

| Component | Status | Detail |
|-----------|--------|--------|
| Test runner | not configured | No test files in web/ |
| E2E framework | not configured | No Playwright/Cypress setup |
| Test DB | N/A | Frontend-only, mocks API |
| Mock inventory | 0 | No existing mocks |

### AC → Test Mapping

| AC | Test Type | Test Intention |
|----|-----------|----------------|
| AC-1 | Manual | Skeleton grid visible during loading |
| AC-2 | Manual | Cards render with correct data |
| AC-3 | Manual | LIVE badge appears for active companies |
| AC-4 | Manual | Search filters cards by name |
| AC-5 | Manual | Sort re-fetches and reorders |
| AC-6 | Manual | Filter re-fetches by status |
| AC-7 | Manual | Card click navigates |
| AC-E1 | Manual | Error state + retry button |
| AC-E2 | Manual | Empty state message |

### TDD Commitment

No test infra configured. All ACs verified manually against running dev server. E2E setup deferred to dedicated issue.

### Mock Boundary

| Dependency | Strategy | Justification |
|------------|----------|---------------|
| `GET /api/companies` | Real server | Dev server runs locally, no mock needed |

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| API response shape mismatch | MED | LOW | API already verified to return expected fields |
| Polling causes flickering on re-render | MED | MED | Use state diffing — only update changed companies |
| Card thumbnail missing endpoint | LOW | HIGH | Gradient fallback specced, no dependency |
| NavBar auth state flash on load | LOW | MED | useAuth has "loading" status — show skeleton/nothing until resolved |

**Kill criteria:** If API doesn't support sort/filter params → fallback to client-side sort/filter (increases scope slightly)

## State Machine

```
┌──────────┐  fetch   ┌──────────┐  success   ┌────────────┐
│  LOADING │────────▶│ FETCHING │──────────▶│ POPULATED  │
│(skeleton)│         │          │           │  (cards)    │
└──────────┘         └────┬─────┘           └──────┬─────┘
                          │ error                   │ 30s poll
                          ▼                         ▼
                    ┌──────────┐              ┌──────────┐
                    │  ERROR   │              │ POLLING  │──▶ FETCHING
                    │ (retry)  │              │(silent)  │
                    └──────────┘              └──────────┘
                          │ retry
                          ▼
                       FETCHING

Empty: POPULATED with companies.length === 0 → renders empty message
```

States: `loading` (initial) | `populated` (has data) | `error` (fetch failed) | `polling` (background refresh, no skeleton)

## Analysis

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict |
|------------|-------------|-----------------|---------|
| API sort/filter params work | Server code reads `?sort=` and `?status=` query params, builds SQL | No integration test confirming exact param names | VALID — read the code, it's there |
| `useAuth()` returns fast enough for NavBar | Auth provider validates token on mount, has "loading" state | If token expired, could hang on `/api/builders/me` | VALID — loading state handles the delay |
| Client-side search is sufficient for V1 | Small dataset (<50 companies expected at launch) | Won't scale to 1000s | VALID for V1 — server-side search is a V2 optimization |
| Polling every 30s is acceptable UX | Issue spec says "REST polling every 30s" for grid | Users expect instant updates | RISKY — acceptable for V1, WebSocket upgrade later |

### Blind Spots

1. **[UX]** Polling updates data while user is mid-search/filter → could flash or reset results.
   Why it matters: Jarring UX if grid resets to unfiltered state on poll.
   **RESOLVED:** State architecture splits `rawCompanies` from `filteredView`.

2. **[Performance]** Cards with `messages_today` counts rely on a subquery per company.
   Why it matters: Landing page latency directly impacts first impression.

3. **[First Impression]** Anonymous users see a grid with no context — no explanation of what Hive is.
   Why it matters: First-time visitors have zero mental model, cards are meaningless without framing.
   **RESOLVED:** Tagline added above grid for anonymous users.

4. **[Empty States]** "No companies" and "filters returned nothing" had the same UI.
   Why it matters: Different problems need different CTAs (wait vs clear filters).
   **RESOLVED:** E2 (no companies) and E3 (no match) are now distinct.

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Polling triggers full re-render | Grid flickers and scroll position resets | React re-renders entire list on new data | MED | Stable keys (company.id), `rawCompanies` state separated from view |
| User types search while poll fires | Search input clears or results flash | Poll overwrites companies state mid-filter | HIGH | **RESOLVED:** `rawCompanies` vs `filteredView` split — polling updates raw, search derives from raw |
| NavBar shows auth-dependent UI before auth resolves | Flash of wrong nav state | useAuth loading state not checked | LOW | Render nothing or skeleton until status !== "loading" |
| Search without debounce causes jank | Keystroke lag on large grids | Client-side filter runs on every character | MED | **RESOLVED:** 200ms debounce added to AC-4 |

### The Real Question

Confirmed — spec solves the right problem. The placeholder page is the #1 UX gap. A live grid with cards, search, and filter is the minimum world view needed for V1 launch. The tagline bridges the "what is this?" gap for anonymous visitors.

### Open Items

- [gap] No thumbnail endpoint → no action (gradient fallback specced)
- [gap] No `watch_all` WebSocket → no action (polling is V1 plan)
- ~~[improvement] Polling could merge data instead of replace~~ → **DONE:** state architecture updated
- ~~[risk] Auth flash on NavBar~~ → **DONE:** loading guard implicit via useAuth status
- ~~[risk] Polling resets search~~ → **DONE:** rawCompanies/filteredView split
- ~~[gap] Empty states conflated~~ → **DONE:** E2 vs E3 distinct
- ~~[gap] No anonymous context~~ → **DONE:** tagline added
- ~~[risk] Search jank~~ → **DONE:** debounce 200ms added

## Notes

### Ship Retro (2026-04-08)
**Estimate vs Actual:** 3h → ~4h (75% accuracy)
**What worked:** Parallel agent builds for independent components (NavBar, CompanyCard, GridControls). Spec review caught real issues (polling state conflict, empty states, debounce).
**What didn't:** Multiple design iterations on NavBar layout — went through 5+ layouts before settling. base-ui `render` prop vs Radix `asChild` caused initial type errors.
**Next time:** Align on NavBar layout direction with user before building. Always use `render` prop (not `asChild`) for base-ui components.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | NavBar.tsx | pending | - |
| 2 | CompanyCard.tsx | pending | - |
| 3 | GridControls.tsx | pending | - |
| 4 | CompanyGrid.tsx | pending | - |
| 5 | page.tsx refactor | pending | - |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-04-08T14:00:00Z | - | Created |
| spec-review | 2026-04-08T14:30:00Z | - | 3 perspectives (Frontend, UX, Skeptic) — 4 updates merged |
| ship | 2026-04-08T15:00:00Z | - | 5 scope items, 3 review rounds, all ACs passing |
| done | 2026-04-08T18:00:00Z | ~4h | Shipped |
