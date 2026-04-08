---
title: shadcn/ui Setup + Hive Theme Tokens
status: shipped
created: 2026-04-07
shipped: 2026-04-08
estimate: 2h
actual: 0.75h
tier: standard
---

# shadcn/ui Setup + Hive Theme Tokens

## Context

Hive V1 frontend needs a component library and design token foundation before any UI can be built. FRONTEND-V1.md specifies vanilla shadcn/ui with a Hive dark navy theme in oklch. Nothing exists yet — no shadcn init, no `components.json`, no `ui/` directory.

**Critical constraint:** Tailwind 4 (CSS-only config) and shadcn use CSS variables differently. shadcn reads vars at runtime via component styles. TW4 reads vars at build time to generate utility classes. The setup requires a dual token system: `:root` block for shadcn + `@theme inline` block for TW4.

## Codebase Impact (MANDATORY)

| Area | Impact | Detail |
|------|--------|--------|
| `web/components.json` | CREATE | shadcn config (manually created if init generates TW3 config) |
| `web/src/lib/utils.ts` | CREATE | `cn()` helper (clsx + tailwind-merge) |
| `web/src/app/globals.css` | MODIFY | Full rewrite: oklch tokens in `:root` + `@theme inline` bridge for TW4 utilities |
| `web/src/app/layout.tsx` | MODIFY | Replace Geist with Inter + JetBrains Mono, wire `--font-inter` / `--font-jetbrains-mono` vars |
| `web/src/components/ui/` | CREATE | ~19 shadcn components |
| `web/package.json` | MODIFY | New deps: `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, Radix primitives |

**Files:** 3 create | 3 modify | 0 affected
**Reuse:** Existing `@/*` path alias. Tailwind 4 + PostCSS already configured.
**Breaking changes:** `globals.css` fully replaced. Font variables change from `--font-geist-*` to `--font-inter` / `--font-jetbrains-mono`.
**New dependencies:** `lucide-react` (install BEFORE `shadcn add` — components have hardcoded imports), `class-variance-authority` + `clsx` + `tailwind-merge`, Radix primitives (auto-pulled)

## User Journey (MANDATORY)

ACTOR: Developer (me)
GOAL: Working design system foundation — shadcn components render correctly with Hive theme via both shadcn styles and TW4 utility classes
PRECONDITION: `web/` has Next.js 16 + Tailwind 4 (CSS-only), no component library

### Primary Journey

1. Developer installs `lucide-react`
   -> npm adds dep
   -> Required before shadcn components (they import lucide icons)

2. Developer runs `npx shadcn@latest init` in `web/`
   -> System creates `components.json` + `lib/utils.ts`
   -> If `tailwind.config.ts` is generated: delete it (TW4 is CSS-only)
   -> Developer has shadcn initialized

3. Developer writes `globals.css` with dual token system:
   -> `:root` block: oklch color vars for shadcn
   -> `@theme inline` block: bridges vars to TW4 utility classes (`--color-*`, `--font-*`, `--radius-*`)
   -> Semantic accents, shadows, transitions included
   -> Developer sees dark navy theme

4. Developer replaces fonts in `layout.tsx`: Inter (body) + JetBrains Mono (code)
   -> Wires `--font-inter` and `--font-jetbrains-mono` CSS variables via next/font
   -> `@theme inline` maps `--font-sans` and `--font-mono` to these vars
   -> Developer sees correct typography in both shadcn components and TW4 utilities

5. Developer batch-installs 19 shadcn components
   -> System creates `src/components/ui/` with all component files
   -> Developer sees components importable

6. Developer adds `<Toaster />` in layout.tsx (Sonner is useless without it — 2 lines)
   -> Toast system is functional

7. Developer runs smoke test: creates temp page rendering Button + Card + Badge
   -> Verifies: colors resolve (not transparent), fonts apply (not system fallback), utilities work (`bg-primary`, `text-foreground`)
   -> Deletes temp page after validation

8. Developer verifies: `npm run build` passes, `npm run lint` passes
   -> System compiles without errors
   -> Foundation is ready

### Error Journeys

E1. shadcn init generates Tailwind 3 config
   Trigger: `npx shadcn@latest init` creates `tailwind.config.ts`
   1. Developer sees `tailwind.config.ts` in `web/`
      -> Conflicts with TW4 CSS-only setup
   2. Developer deletes `tailwind.config.ts`, verifies `components.json` is correct
      -> If `components.json` is wrong, manually create it with exact content (see scope item 2)
   Recovery: Clean TW4 setup preserved

### Edge Cases

EC1. shadcn init overwrites `globals.css`: apply Hive theme after init, not before
EC2. `tailwind-merge` version mismatch with TW4: verify version >= 2.x for TW4 compat
EC3. Next.js 16 font API changes: check `node_modules/next/dist/docs/` before writing layout

## Acceptance Criteria (MANDATORY)

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN `web/` WHEN shadcn is initialized THEN `components.json` exists with correct config (path alias `@`, TypeScript, CSS variables mode)
- [ ] AC-2: GIVEN `globals.css` WHEN page loads THEN all oklch tokens are present in `:root` matching FRONTEND-V1.md exactly
- [ ] AC-3: GIVEN `globals.css` WHEN using TW4 utilities THEN `bg-background`, `text-foreground`, `bg-primary`, `text-muted-foreground` etc. all resolve to correct oklch colors (verified via `@theme inline` bridge)
- [ ] AC-4: GIVEN `layout.tsx` WHEN page loads THEN Inter is the body font (`font-sans`) and JetBrains Mono is the mono font (`font-mono`) — both via TW4 `--font-sans`/`--font-mono`
- [ ] AC-5: GIVEN shadcn CLI WHEN batch-installing THEN `src/components/ui/` contains all 19 components: button, card, dialog, sheet, badge, input, alert, alert-dialog, tabs, textarea, sonner, dropdown-menu, toggle-group, scroll-area, label, avatar, skeleton, tooltip, checkbox
- [ ] AC-6: GIVEN smoke test page WHEN rendering Button + Card + Badge THEN colors are visible (not transparent), fonts are Inter (not system), and TW4 utilities apply correctly
- [ ] AC-7: GIVEN all setup complete WHEN running `npm run build` THEN build succeeds with 0 errors
- [ ] AC-8: GIVEN all setup complete WHEN running `npm run lint` THEN lint passes (or only pre-existing warnings)

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN shadcn init creates `tailwind.config.ts` WHEN TW4 is CSS-only THEN file is deleted and `components.json` is manually verified/created

### Should Have

- [ ] AC-9: GIVEN `lib/utils.ts` WHEN importing `cn` THEN it re-exports clsx + twMerge correctly
- [ ] AC-10: GIVEN `<Toaster />` mounted in layout WHEN calling `toast()` THEN toast renders with Hive theme

## Scope

- [ ] 1. Install `lucide-react` (before shadcn — components need it) -> AC-5
- [ ] 2. Init shadcn + create/verify `components.json` (delete TW3 config if generated) -> AC-1, AC-E1
- [ ] 3. Write `globals.css`: oklch tokens in `:root` + `@theme inline` bridge for TW4 utilities + semantic accents + shadows + transitions -> AC-2, AC-3
- [ ] 4. Replace fonts: Inter + JetBrains Mono in `layout.tsx`, wire `--font-inter`/`--font-jetbrains-mono` vars -> AC-4
- [ ] 5. Batch-install 19 shadcn components -> AC-5
- [ ] 6. Mount `<Toaster />` in layout.tsx -> AC-10
- [ ] 7. Smoke test: temp page with Button + Card + Badge -> verify colors + fonts + utilities -> AC-6
- [ ] 8. Verify build + lint pass, delete smoke test page -> AC-7, AC-8, AC-9

### Out of Scope

- Custom component modifications (just install, no customization yet)
- Provider setup (AuthProvider, WebSocketProvider) — separate task
- Page creation (/, /company/:id, /login, etc.) — separate task
- PixiJS canvas changes — unrelated to design system
- Canvas/CSS token sync (PixiJS doesn't read CSS vars — address when building canvas)

## Quality Checklist

### Blocking (must pass to ship)

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] All scope items implemented
- [ ] No regressions in existing tests
- [ ] No hardcoded secrets or credentials
- [ ] oklch token values match FRONTEND-V1.md exactly
- [ ] `@theme inline` block bridges ALL shadcn tokens to TW4 utilities
- [ ] `--font-sans` and `--font-mono` defined in `@theme inline`
- [ ] Font sizes match spec: Body 14px, Small 12px, Caption 11px, Mono 13px
- [ ] Smoke test passes: colors visible, fonts correct, utilities work

### Advisory (should pass, not blocking)

- [ ] All Should Have ACs passing
- [ ] Code follows existing project patterns (path aliases, TypeScript strict)
- [ ] No unused dependencies added
- [ ] `tailwind-merge` >= 2.x for TW4 compat

## Test Strategy

Runner: not configured | E2E: not configured | TDD: N/A (infra task)
AC-1 -> Manual: `components.json` exists with correct content
AC-2 -> Manual: `globals.css` oklch tokens match FRONTEND-V1 spec
AC-3 -> Manual: smoke test page — TW4 utilities resolve colors correctly
AC-4 -> Manual: DevTools font-family shows Inter / JetBrains Mono
AC-5 -> Manual: `ls src/components/ui/` shows 19 files
AC-6 -> Manual: smoke test page — visual inspection (colors, fonts, utilities)
AC-7 -> `npm run build` exits 0
AC-8 -> `npm run lint` exits 0
Mocks: none

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| TW4 `@theme` bridge misconfigured — utilities don't resolve | HIGH | MED | Smoke test catches it before marking done |
| shadcn init creates TW3 config conflicting with TW4 | HIGH | MED | Delete generated config, manually verify `components.json` |
| `tailwind-merge` < 2.x pulled — breaks TW4 class dedup | MED | LOW | Verify version after install |
| Next.js 16 `next/font` API changed | MED | LOW | Check `node_modules/next/dist/docs/` before writing layout |
| Radix primitives version conflicts with React 19 | HIGH | LOW | Check compat before install, pin if needed |

**Kill criteria:** If shadcn components cannot render correctly with TW4 CSS-only config after 30min debugging, switch to manual Radix + tailwind setup without shadcn.

## Analysis

**Assumptions Challenged:**
| Assumption | Verdict | Action |
|---|---|---|
| Bare HSL tokens work in TW4 | WRONG — switched to oklch, TW4 needs real color values not bare triplets | updated spec |
| shadcn init works cleanly on TW4 | RISKY — may generate TW3 config | spec includes manual fallback |
| `@theme inline` bridge is unnecessary | WRONG — without it, `bg-background` etc. don't generate | added to spec |
| Fonts auto-propagate to shadcn | WRONG — need explicit `--font-sans`/`--font-mono` in `@theme` | added to spec |

**Blind Spots Addressed:**
1. **[critical]** TW4 `@theme` bridge — added dual token system to spec and FRONTEND-V1.md
2. **[font]** `--font-sans`/`--font-mono` — added to `@theme inline` block
3. **[DX]** Sonner without Toaster — added `<Toaster />` mount to scope
4. **[DX]** lucide-react install order — moved to step 1 before `shadcn add`
5. **[validation]** No visual verification — added smoke test step

**Failure Hypotheses:**
| IF | THEN | BECAUSE | Severity | Status |
|---|---|---|---|---|
| `@theme` bridge omitted | Components render transparent/invisible | TW4 can't generate utilities from bare CSS vars | HIGH | Mitigated — bridge in spec |
| shadcn init generates TW3 config | Random style bugs from hybrid config | TW4 + legacy config = undefined behavior | HIGH | Mitigated — delete + manual verify |
| Build passes but tokens don't resolve | "Done" with broken foundation | TS doesn't check CSS variable resolution | MED | Mitigated — smoke test added |

**The Real Question:** Confirmed — spec now addresses the real problem: establishing a stable token contract between TW4's static utility system and shadcn's runtime CSS variable system. The dual-format token approach (`@layer base` + `@theme inline`) is the correct architecture.

**Open Items:** None — all review findings merged.

## Notes

Spec review merged 2026-04-07. Key changes: oklch colors, dual token system (`@layer base` + `@theme inline`), smoke test step, lucide-react install order, `<Toaster />` in scope, 2h estimate.

### Ship Retro (2026-04-08)
**Estimate vs Actual:** 2h -> 0.75h (267% faster)
**What worked:** shadcn v2.3+ handles TW4 natively — auto-generates `@theme inline` bridge, oklch tokens, correct `components.json`. The spec review's biggest fear (TW4 compat) was already solved upstream.
**What didn't:** npm/bun conflict wasted 5min — monorepo uses bun workspaces but spec assumed npm.
**Next time:** Always check lockfile/package manager before first install command. Add "package manager: bun" to CLAUDE.md.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Install lucide-react | [x] Complete | 1 |
| 2 | Init shadcn + verify components.json | [x] Complete | 1 |
| 3 | Write globals.css oklch + @theme bridge | [x] Complete | 1 |
| 4 | Replace fonts: Inter + JetBrains Mono | [x] Complete | 1 |
| 5 | Batch-install 19 shadcn components | [x] Complete | 1 |
| 6 | Mount Toaster + TooltipProvider | [x] Complete | 1 |
| 7 | Smoke test + build/lint | [x] Complete | 1 |
|---|-----------|--------|-----------|

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-04-07T21:00:00Z | - | Created |
| plan-v2 | 2026-04-07T21:15:00Z | - | Switched from Lyse Registry to vanilla shadcn/ui |
| spec-review | 2026-04-07T21:30:00Z | - | 3-perspective review merged: oklch, @theme bridge, smoke test, install order |
| ship | 2026-04-07T21:55:00Z | 45min | All 7 scope items done in 1 iteration |
| done | 2026-04-08T00:10:00Z | - | Validation passed, archived |
