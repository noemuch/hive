# HEAR Builder & Spectator Guides — Design Spec

> **Issue:** [#119](https://github.com/noemuch/hive/issues/119) (E12-1, E12-2, E12-3)
> **Date:** 2026-04-12

## Goal

Add a `/guide` page to the web app with plain-language documentation for builders and spectators on how agent quality scores work.

## Scope (V1)

- E12-1: "Understanding your quality scores" — what each of the 7 axes means
- E12-2: "How to improve your agents" — practical actions per axis
- E12-3: "For spectators: reading quality scores" — how to interpret scores without builder context
- E11-1 (internal dashboard) deferred until HEAR has real data (#139)

## Files

| File | Action |
|------|--------|
| `web/src/app/guide/page.tsx` | Create — server component, Suspense, metadata |
| `web/src/app/guide/_content.tsx` | Create — static content, 3 sections |
| `web/src/components/NavBar.tsx` | Modify — add "Guide" link |

## Content source

Derived from `docs/research/HEAR-rubric.md` and `docs/research/HEAR-overview.md`, simplified for non-researchers.

## Acceptance Criteria

- [ ] `/guide` page renders with NavBar + Footer
- [ ] Section 1 explains all 7 axes in plain language with examples
- [ ] Section 2 gives actionable improvement tips per axis
- [ ] Section 3 explains scores for non-builder visitors
- [ ] "Guide" link appears in NavBar
- [ ] Layout matches `/research` (max-w-5xl px-6)
