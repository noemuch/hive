---
title: Canvas Responsive + Camera System
status: shipped
shipped: 2026-04-08
created: 2026-04-07
estimate: 2h
tier: mini
issue: https://github.com/noemuch/hive/issues/66#point-2
---

# Canvas Responsive + Camera System

## Context

The PixiJS canvas calculates `fitScale` once at mount and never updates. Window resize breaks the layout. No zoom, no pan. The camera system is the foundation every future canvas feature depends on (GIF capture, multi-company grid, agent movement).

## Codebase Impact

| Area | Impact | Detail |
|------|--------|--------|
| `web/src/canvas/camera.ts` | CREATE | Camera module: zoom (wheel), pan (drag), resize, bounds clamping |
| `web/src/components/GameView.tsx` | MODIFY | Split stage into worldContainer + hudContainer, replace static fitScale with camera setup, add ResizeObserver, cleanup |
| `web/src/canvas/office.ts` | MODIFY | Set `sprite.cullable = true` on tile sprites for zoom perf |
| `web/src/canvas/agents.ts` | AFFECTED | Speech bubbles positioned relative to agent containers — no change needed (child of worldContainer via office) |
| `web/src/canvas/npcs.ts` | AFFECTED | NPC positions in tile coords — no change needed (child of office) |

**Files:** 1 create | 2 modify | 2 affected
**Reuse:** `SCALE`, `OFFICE_W`, `OFFICE_H`, `TILE` from `office.ts`. New `worldContainer` as camera transform target (NOT `app.stage`).
**Breaking changes:** None — worldContainer wraps existing office child, HUD moves to hudContainer.
**New dependencies:** None — pure PixiJS + DOM APIs (ResizeObserver, WheelEvent, PointerEvent).

## User Journey

### Primary Journey

ACTOR: Spectator (desktop browser visitor watching a company's office)
GOAL: View and navigate the office canvas on any screen size
PRECONDITION: GameView mounted, PixiJS app initialized, office rendered

1. User opens page on desktop
   → System renders office centered and fit-to-screen (existing behavior, now dynamic)
   → User sees office filling the viewport proportionally
   → HUD ("HIVE" title, "LIVE" status) stays fixed in screen-space

2. User resizes browser window
   → System detects resize via ResizeObserver (debounced 150ms, trailing), calls `app.renderer.resize()`, recalculates fit
   → User sees office re-centered, HUD repositioned, zoom level preserved

3. User scrolls mouse wheel over canvas
   → System zooms worldContainer toward cursor position (0.5x–3x range)
   → macOS trackpad pinch (`ctrlKey: true`) uses separate sensitivity multiplier
   → User sees smooth zoom in/out centered on cursor, HUD unaffected

4. User click-drags on canvas (desktop)
   → System translates worldContainer position following pointer delta
   → User sees office pan smoothly, clamped to bounds, HUD stays fixed

POSTCONDITION: Office visible at user-chosen zoom/position, responsive to viewport changes, HUD always in screen-space

### Error Journeys

E1. Zoom exceeds bounds
   Trigger: User scrolls aggressively
   1. User zooms past 3x or below 0.5x
      → System clamps scale to [0.5, 3.0]
      → User sees zoom stop at limit (no visual glitch)
   Recovery: Normal — zoom is clamped, user continues

E2. Pan beyond office bounds
   Trigger: User drags office completely off-screen
   1. User drags far in one direction
      → System clamps worldContainer position so office remains partially visible (min 20% visible)
      → User sees elastic stop, can't lose the office
   Recovery: Normal — position clamped

### Edge Cases

EC1. Very small viewport (<400px wide): fitScale adjusts, zoom still clamped to [0.5, 3.0]
EC2. Window resize during active zoom/pan: resize deferred if gesture active (gesture takes priority)
EC3. Office container not yet loaded when resize fires: guard against null officeRef
EC4. Company switch mid-zoom: camera reset to fit on new office load

## Acceptance Criteria

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN the page is loaded WHEN user resizes browser window THEN canvas resizes to fill container and office re-centers within 200ms, HUD stays fixed
- [ ] AC-2: GIVEN desktop browser WHEN user scrolls mouse wheel over canvas THEN worldContainer zooms toward cursor, clamped to [0.5x, 3.0x], HUD unaffected
- [ ] AC-3: GIVEN desktop browser WHEN user click-drags on canvas THEN worldContainer pans following pointer, clamped to keep office partially visible, HUD stays fixed
- [ ] AC-4: GIVEN macOS trackpad WHEN user pinch-zooms (ctrlKey wheel) THEN zoom uses trackpad sensitivity multiplier, same [0.5x, 3.0x] range

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN any input WHEN zoom would exceed [0.5, 3.0] THEN scale is clamped (no visual glitch, no console error)
- [ ] AC-E2: GIVEN any input WHEN pan would move office fully off-screen THEN position is clamped to keep ≥20% visible

### Should Have

- [ ] AC-5: GIVEN user has zoomed/panned WHEN window resizes THEN current zoom level is preserved, only position adjusts

## Scope

- [ ] 1. Scene graph restructure in `GameView.tsx` — split `app.stage` children into `worldContainer` (office) + `hudContainer` (title, status). Reset `office.scale` to `SCALE` only (camera handles fit). → AC-1, AC-2, AC-3
- [ ] 2. Create `web/src/canvas/camera.ts` — `setupCamera(app, worldContainer, getOfficeBounds)` with lazy `getOfficeBounds` closure over live `OFFICE_W`/`OFFICE_H`. Wheel zoom toward cursor + ctrlKey trackpad sensitivity. Click-drag pan. Bounds clamping. → AC-2, AC-3, AC-4, AC-E1, AC-E2
- [ ] 3. ResizeObserver integration in `GameView.tsx` — debounced 150ms trailing, deferred during active gesture. Cleanup on unmount. → AC-1, AC-5
- [ ] 4. Tile sprite culling in `office.ts` — set `sprite.cullable = true` on all tile sprites for zoom perf. → AC-2 (perf)

### Out of Scope

- **Touch support (pinch-to-zoom, single-touch pan)** — deferred to separate spec, requires real-device iOS testing and touch surface contract with ChatPanel
- Double-tap to reset zoom
- Minimap / zoom indicator UI
- Keyboard shortcuts for zoom/pan
- Camera follow (tracking a specific agent)
- Smooth animated zoom transitions
- Session storage persistence of zoom/pan state

## Quality Checklist

### Blocking

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] No regressions in existing canvas rendering (office, agents, bubbles, NPCs)
- [ ] HUD elements never move during zoom/pan
- [ ] Error states handled (null guards for officeRef, office not loaded)
- [ ] No hardcoded secrets or credentials
- [ ] Cleanup: ResizeObserver disconnected + event listeners removed on unmount
- [ ] `getOfficeBounds` is a lazy closure, not captured values

### Advisory

- [ ] All Should Have ACs passing
- [ ] Performance: no layout thrash — debounce resize, bounds clamp in rAF
- [ ] Resize deferred during active gesture

## Test Strategy
Runner: none configured | E2E: none configured | TDD: RED → GREEN per AC
AC-1 → manual (resize window, verify re-center + HUD fixed) | AC-2 → manual (wheel zoom + verify HUD) | AC-3 → manual (drag pan) | AC-4 → manual (macOS trackpad pinch)
AC-E1 → manual (aggressive zoom) | AC-E2 → manual (aggressive pan)
FH-1 → manual (zoom then check HUD position)
Mocks: none — pure client-side DOM + PixiJS

## Analysis

**Assumptions:**
- `worldContainer` is the correct transform target (not `app.stage`) → VALID — isolates HUD from camera transforms, standard PixiJS pattern
- ResizeObserver on canvasRef parent is sufficient → VALID (container is `w-full h-full`, tracks viewport)
- `getOfficeBounds` as lazy closure avoids async mutation race → VALID — closure reads live `OFFICE_W`/`OFFICE_H` at call time
- Trackpad pinch detected via `ctrlKey` on wheel events → VALID — Chrome/Safari/Firefox all set `ctrlKey: true` for trackpad pinch gestures

**Blind Spots:**
1. **[perf]** Speech bubble `Graphics` + `Text` created on appear — ensure `destroy({ children: true })` on disappear to prevent GPU texture leak. Not camera scope, but camera zoom amplifies the visual impact of leaks.
   Why it matters: VRAM accumulation on long sessions → mobile tab crash
2. **[ux]** No visual affordance that zoom/pan is available — first-time user has no discoverability cue.
   Why it matters: users may never discover the feature

**Failure Hypotheses:**
- FH-1 (was HIGH, now FIXED): IF camera targets `app.stage` THEN HUD distorts → FIXED by worldContainer/hudContainer split
- FH-2 (MED): IF resize fires mid-gesture THEN view jumps → Mitigated: defer resize during active gesture flag
- FH-3 (MED): IF `getOfficeBounds` captured at init THEN bounds wrong for async-loaded maps → FIXED by lazy closure

**The Real Question:** Confirmed — desktop camera (resize + wheel zoom + drag pan) with proper layer separation is the right scope. Touch deferred to avoid iOS risk on a mini spec with no test infra.

**Open Items:**
- [improvement] Bubble memory leak in agents.ts (not camera scope) → no action (flag for future)
- [improvement] Zoom/pan discoverability UX → no action (future UI, out of scope)

## State Machine

```
[fit] ──wheel──▶ [zoomed] ──drag──▶ [zoomed+panned]
  │                  │                     │
  │◀── resize ───────│◀── resize ──────────│
  │                  │                     │
  └── drag ──▶ [panned] ──────────────────┘
                  │◀── resize ─────────────┘
```

States: fit (default, auto-centered), zoomed, panned, zoomed+panned
Transitions: wheel → zoom, drag → pan, resize → recalc bounds (preserve zoom, defer if gesturing)
Invalid: none — all combinations valid

## Notes

### Ship Retro (2026-04-08)
**Estimate vs Actual:** 2h → 1.5h (75%)
**What worked:** Spec review caught app.stage vs worldContainer bug before implementation.
**What didn't:** Bounds clamping formula wrong on first pass (minX included screenW). 2 fix iterations.
**Next time:** Unit test pure math functions even without E2E infra.

Spec review applied: 2026-04-08. Key changes from review:
- WRONG: `app.stage` as transform target → fixed to `worldContainer`
- WRONG: double scale application → fixed to `SCALE` only on office
- RISKY: `OFFICE_W`/`OFFICE_H` capture timing → fixed to lazy closure
- CUT: touch support (AC-4/AC-5 mobile) → deferred to separate spec
- ADDED: ctrlKey trackpad sensitivity, tile sprite culling, gesture-deferred resize

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Scene graph restructure | [x] Complete | 1 |
| 2 | Create camera.ts | [x] Complete | 1 |
| 3 | ResizeObserver integration | [x] Complete | 1 |
| 4 | Tile sprite culling | [x] Complete | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-04-07T22:00:00Z | - | Created from issue #66 point 2 |
| spec-review | 2026-04-08T00:00:00Z | - | 4 perspectives: PixiJS, Mobile UX, Perf, Skeptic. Cut touch, added layer split. |
| ship | 2026-04-08T00:30:00Z | - | All 4 scope items complete. Build passes. |
| fix | 2026-04-08T01:00:00Z | - | Bounds clamping formula + forced centering removed |
| done | 2026-04-08T01:30:00Z | 1.5h | Review clean, user validated |
