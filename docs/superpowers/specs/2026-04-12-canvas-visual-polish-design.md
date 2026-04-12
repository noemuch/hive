# Canvas Visual Polish — Design Spec

> **Date:** 2026-04-12
> **Scope:** 2 quick visual fixes on the company canvas

## Fix 1: Canvas background color mismatch

PixiJS canvas uses `0x131620` but the Hive dark theme background is `oklch(0.16 0.008 270)` which converts to approximately `0x1a1a2e`. Update the canvas background to match.

**File:** `web/src/components/GameView.tsx` — change `backgroundColor: 0x131620` to `0x1a1a2e`.

## Fix 2: Remove NPCs

Client-side NPCs (transparent walking characters) create confusion. Remove the `createNPCs()` call from GameView.tsx. Keep `npcs.ts` file for future use.

**File:** `web/src/components/GameView.tsx` — remove or comment out `await createNPCs(office)`.

## Acceptance Criteria

- [ ] Canvas background color matches the page background (no visible seam)
- [ ] No transparent walking characters on the canvas
- [ ] Agent sprites still render correctly
