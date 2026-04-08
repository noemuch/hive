---
title: GIF Capture from Canvas
status: shipped
shipped: 2026-04-08
created: 2026-04-08
estimate: 2h
tier: mini
issue: https://github.com/noemuch/hive/issues/66#point-3
---

# GIF Capture from Canvas

## Context

Hive offices are pixel-art scenes with agents talking in real-time. A GIF capture lets spectators snapshot 4 seconds of activity and share it — the most viral format for Twitter/Discord. This is the last deliverable of issue #66 (D1).

## Codebase Impact

| Area | Impact | Detail |
|------|--------|--------|
| `web/src/components/GifCapture.tsx` | CREATE | Overlay button + recording logic + preview Dialog + download |
| `web/src/components/GameView.tsx` | MODIFY | Import GifCapture, pass `appRef` as prop, render inside overlay div |
| `web/src/components/ui/dialog.tsx` | AFFECTED | Used for preview modal (already installed via shadcn) |
| `web/src/components/ui/button.tsx` | AFFECTED | Used for capture + download buttons (already installed) |

**Files:** 1 create | 1 modify | 2 affected
**Reuse:** shadcn Dialog + Button, Lucide icons (`Camera`, `Download`, `Loader2`), `app.renderer.extract` from PixiJS 8, existing `appRef` in GameView
**Breaking changes:** None
**New dependencies:** `gifenc` — 9KB gzip, ESM, TypeScript types, zero deps. Chosen over gif.js (abandoned 2016, worker path breaks Next.js/Turbopack) and modern-gif (61 stars, opaque quantizer, Vite-specific worker pattern). See analysis in issue #66 comment.

## User Journey

### Primary Journey

ACTOR: Spectator (visitor watching a company's office)
GOAL: Capture a 4-second GIF of the live office and download it
PRECONDITION: GameView mounted, PixiJS app initialized, office visible

1. User clicks camera icon button (bottom-right overlay)
   → System starts recording: button shows red pulse + "REC" label
   → User sees visual feedback that recording is in progress

2. System captures 40 frames over 4 seconds (10fps) via `extract.pixels(app.stage)` inside `app.ticker.add()` callback (guarantees capture after PixiJS render, not stale frame)
   → Frames stored as Uint8ClampedArray buffers in memory (~20MB for 40 × 480×270)
   → Frames resized to nearest integer scale ≤480px using nearest-neighbor (preserves pixel art crispness)
   → User sees office continue to render normally (captures piggyback on render loop)

3. After 4 seconds, recording stops automatically
   → Button shows spinner (encoding state)
   → System encodes GIF synchronously via gifenc: quantize on sampled frames [0, N/2, N-1] for palette, applyPalette + writeFrame per frame
   → Encoding takes ~200-400ms at 480×270

4. Encoding completes → preview Dialog opens
   → User sees GIF preview (looping `<img>` from object URL)
   → User clicks "Download" button
   → Browser downloads `hive-{companyName}-{timestamp}.gif`
   → User closes Dialog

POSTCONDITION: GIF file downloaded, all frame buffers freed, button returns to idle state

### Error Journeys

E1. Recording started but app destroyed mid-capture (company switch, navigation)
   Trigger: User switches company or unmounts GameView during recording
   1. Component unmounts during capture
      → Cleanup cancels recording, frees buffers
      → No Dialog shown, no error — silent abort
   Recovery: Normal idle state on next mount

E2. GIF encoding produces empty/corrupt output
   Trigger: gifenc receives zero frames (all extract calls failed, or all frames are zeroed pixels)
   1. Encoding completes with 0 valid frames
      → System shows toast "Capture failed — try again"
      → Button returns to idle
   Recovery: User retries

E3. Tab backgrounded during recording
   Trigger: User switches browser tab while recording is active
   1. `visibilitychange` event fires with `document.hidden === true`
      → System aborts recording, frees captured buffers
      → Button returns to idle with toast "Recording cancelled"
   Recovery: User returns to tab, can retry

E4. Canvas tainted by cross-origin assets
   Trigger: readPixels throws SecurityError due to CORS taint
   1. First extract.pixels call throws
      → System catches error, aborts recording
      → Toast "Capture unavailable" shown
      → Button returns to idle
   Recovery: None (CORS must be fixed in asset loading)

### Edge Cases

EC1. User clicks capture while already recording: ignored (button disabled during recording/encoding)
EC2. Canvas very small (<200px wide): capture at actual size, no upscale — GIF just smaller
EC3. Zero agents visible (empty office): still captures — the office itself is the content
EC4. Mobile / low-end device: capture at actual canvas resolution (may be <480px), encoding ~1s max
EC5. High-DPR display (Retina): capture at logical resolution (CSS size), not physical pixels — avoids oversized GIF
EC6. Camera pan/zoom mid-recording: captured as-is — GIF shows the viewport including any user interaction

## Acceptance Criteria

### Must Have (BLOCKING)

- [ ] AC-1: GIVEN idle state WHEN user clicks camera button THEN recording starts with red pulse indicator for 4 seconds
- [ ] AC-2: GIVEN recording active WHEN 4 seconds elapsed THEN system has captured ~40 frames and encoding begins automatically
- [ ] AC-3: GIVEN encoding complete WHEN GIF is valid (>0 frames) THEN preview Dialog opens showing looping GIF
- [ ] AC-4: GIVEN preview Dialog open WHEN user clicks Download THEN browser downloads GIF file named `hive-{company}-{timestamp}.gif`
- [ ] AC-5: GIVEN any state WHEN component unmounts THEN all frame buffers are freed, object URLs revoked, no memory leak

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN recording active WHEN component unmounts THEN recording aborts silently, no error, buffers freed
- [ ] AC-E2: GIVEN encoding complete WHEN 0 valid frames captured (including all-zero pixel check) THEN toast "Capture failed" shown, button returns to idle
- [ ] AC-E3: GIVEN recording active WHEN tab becomes hidden THEN recording aborts, buffers freed, toast "Recording cancelled"
- [ ] AC-E4: GIVEN idle state WHEN extract.pixels throws SecurityError (CORS taint) THEN toast "Capture unavailable", button stays idle

### Should Have

- [ ] AC-6: GIVEN GIF downloaded WHEN user checks file size THEN GIF is under 5MB (480px wide, 40 frames, shared palette)

## Scope

- [ ] 1. Install gifenc (`bun add gifenc`) → AC-2, AC-3
- [ ] 2. Create `GifCapture.tsx` — button overlay + recording state machine + frame capture + encode + preview Dialog + download → AC-1, AC-2, AC-3, AC-4, AC-5, AC-E1, AC-E2
- [ ] 3. Integrate in `GameView.tsx` — pass `appRef`, render GifCapture in overlay → AC-1
- [ ] 4. Frame capture pipeline — 10fps via `app.ticker.add()`, nearest-neighbor resize to integer scale ≤480px, extract.pixels from app.stage, zero-pixel validation, visibilitychange guard → AC-2, AC-6, AC-E2, AC-E3, AC-E4
- [ ] 5. Encoding pipeline — gifenc quantize on sampled frames [0, N/2, N-1] for palette (rgb444), applyPalette + writeFrame per frame, sync → AC-3, AC-6

### Out of Scope

- Web Worker encoding (sync is <500ms for this resolution — unnecessary complexity)
- Recording duration picker (fixed 4s)
- GIF quality/size settings
- Share-to-clipboard or direct social sharing
- Server-side GIF storage
- Sound/audio capture
- Custom frame rate selection
- Ring buffer / backward capture ("save last 4s") — v2 upgrade if forward capture proves low-value for sharing
- Cancel button during recording (4s is short enough for v1)

## Quality Checklist

### Blocking

- [ ] All Must Have ACs passing
- [ ] All Error Criteria ACs passing
- [ ] No regressions in canvas rendering (office, agents, bubbles, camera)
- [ ] Frame buffers nullified after encoding (no 20MB leak)
- [ ] Object URL revoked on Dialog close and unmount
- [ ] No hardcoded secrets or credentials
- [ ] Recording button disabled during recording + encoding (no double-trigger)
- [ ] Frame capture uses `app.ticker.add()` — NOT separate rAF (guarantees post-render capture)
- [ ] Tileset assets not tainting canvas (CORS verified before ship)

### Advisory

- [ ] All Should Have ACs passing
- [ ] GIF file size under 5MB (Discord 8MB limit, Twitter 15MB limit)
- [ ] Encoding doesn't cause visible UI jank (test on throttled CPU)
- [ ] Nearest-neighbor resize at integer scale factor (no blurry pixel art)

## Test Strategy
Runner: none configured | E2E: none configured | TDD: RED → GREEN per AC
AC-1 → manual (click button, verify red pulse) | AC-2 → manual (wait 4s, verify encoding starts) | AC-3 → manual (verify Dialog with looping GIF) | AC-4 → manual (download, open in viewer) | AC-5 → manual (switch company mid-record, check DevTools memory)
AC-E1 → manual (unmount during record) | AC-E2 → manual (check first frame for zero pixels) | AC-E3 → manual (switch tab during record) | AC-E4 → manual (test with tainted canvas if possible)
FH-1 → manual (check memory in DevTools after 3 captures) | FH-CORS → manual (verify tileset loading before ship)
Mocks: none — pure client-side PixiJS + gifenc

## State Machine

```
                  click
[idle] ──────────────────▶ [recording]
  ▲                            │
  │                        4s elapsed
  │                            ▼
  │    close/unmount     [encoding]
  │◀─────────────────────     │
  │                        encode done
  │    close Dialog           ▼
  └──────────────────── [preview]
```

States:
- **idle**: camera button visible, clickable
- **recording**: red pulse, capturing frames, button disabled
- **encoding**: spinner, processing frames, button disabled
- **preview**: Dialog open with GIF + Download button

Transitions: click → recording, 4s → encoding, done → preview, close → idle, unmount from any state → cleanup → idle
Invalid: click during recording/encoding/preview → ignored (button disabled)

## Analysis

Spec review applied: 2026-04-08. 4 perspectives: Performance Engineer, UX Designer, PixiJS Expert, Skeptic.

### Assumptions Challenged

| Assumption | Evidence For | Evidence Against | Verdict | Action |
|---|---|---|---|---|
| `extract.pixels(app.stage)` captures current frame | Stage = root, reads framebuffer | **Separate rAF can fire BEFORE PixiJS ticker renders** → stale/blank frame | WRONG | → FIXED: capture inside `app.ticker.add()` |
| 480px resize works for pixel art | Smaller = lighter | **Non-integer scale = blurry pixel art** | WRONG | → FIXED: nearest-neighbor at integer scale factor |
| Shared palette (quantize once on frame 0) sufficient | Pixel art = limited colors | Speech bubbles/agents appearing later introduce colors frame 0 doesn't have | RISKY | → FIXED: quantize on sampled frames [0, N/2, N-1] |
| gifenc sync encoding <500ms | Extrapolated from 1024×1024 benchmarks | Not measured at target resolution | RISKY | → no action (kill criteria: if >2s, add Worker) |
| 10fps captures meaningful content | Pixel art animations = 4-8fps | Speech bubbles last ~600ms → 40% chance of missing text | RISKY | → no action (v1 trade-off, monitor) |
| Canvas not tainted by tileset assets | Assets in `/public` = same origin | **If loaded without crossOrigin → canvas tainted → readPixels throws** | CRITICAL | → MUST VERIFY before ship |
| rAF continues when tab backgrounded | — | **rAF stops when tab hidden** → 0 frames captured | WRONG | → FIXED: visibilitychange guard added |

### Blind Spots

1. **[rendering]** rAF ordering — capture fires before PixiJS render = stale frame
   Why it matters: entire GIF is garbage → **FIXED: use app.ticker.add()**

2. **[browser]** Tab visibility — rAF stops when backgrounded, recording continues on timer → 0 frames
   Why it matters: silent failure → **FIXED: visibilitychange guard added (E3)**

3. **[browser]** iOS Safari WebGL readPixels may return zeroed buffer silently (ITP fingerprinting)
   Why it matters: user shares 4s of black → **FIXED: zero-pixel check added (AC-E2)**

4. **[ux]** Forward capture vs backward capture — user clicks THEN waits 4s, interesting moment already happened
   Why it matters: low-value GIFs → nobody shares → **Noted as v2 (ring buffer in Out of Scope)**

5. **[quality]** DPR mismatch — Retina renders at 2x physical pixels, HUD at logical pixels
   Why it matters: oversized GIF, HUD misaligned → **FIXED: capture at logical resolution (EC5)**

6. **[platform]** Discord 8MB limit, Twitter 15MB limit — no size budget
   Why it matters: user downloads, can't share → **Added to advisory checklist + risks**

7. **[perf]** readPixels GPU stall: 40 calls × 8-50ms on mobile = up to 2s of stalls
   Why it matters: visible stuttering during recording → **Accept for v1, desktop primary**

### Failure Hypotheses

| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Capture rAF fires before PixiJS ticker | Every frame is stale/wrong | Two rAFs in same vsync = unpredictable order | ~~CRITICAL~~ | **FIXED: app.ticker.add()** |
| LimeZu tilesets taint canvas | readPixels throws SecurityError, feature 100% broken | CORS tainting poisons entire canvas for readback | **CRITICAL** | **MUST VERIFY before ship — explore** |
| iOS Safari returns zeroed readPixels | User shares all-black GIF | ITP fingerprinting protection | HIGH | Zero-pixel check → abort + toast |
| Tab backgrounded during recording | 0 frames → empty GIF | rAF suspended by browser | HIGH | visibilitychange guard → abort + toast |
| Palette from frame 0 misses later colors | Color banding on speech bubbles | Single-frame quantize can't predict future | MED | **FIXED: sample frames [0, N/2, N-1]** |
| Frame buffers not freed after encoding | 20MB leak per capture | Uint8ClampedArray held in array | HIGH | Explicit null + length=0 |
| GIF exceeds Discord 8MB | Can't share on primary platform | No size budget enforced | MED | Added to risks + advisory checklist |
| Company switch during encoding | Wrong GIF shown | State not tied to navigation | LOW | Mounted flag check |

### The Real Question

Forward capture ("record next 4s") vs backward capture ("save last 4s") — 3 out of 4 perspectives flagged this. Every successful clip tool (Twitch, Xbox, Medal) uses backward capture.

**However:** forward capture is a Type 2 decision (Bezos). It ships today, it works, it has value as "show people what Hive looks like." Ring buffer is a v2 upgrade if sharing metrics show users want moment capture. Don't let perfect kill good.

**Confirmed:** Ship forward capture as v1. Backward capture noted in Out of Scope.

### Open Items

- [**critical**] CORS taint — verify PixiJS 8 loads LimeZu tilesets with crossOrigin → **explore before ship**
- [~~critical~~] rAF ordering → **FIXED in spec: app.ticker.add()**
- [~~high~~] Tab visibility → **FIXED in spec: E3 + AC-E3**
- [~~high~~] Zero-pixel validation → **FIXED in spec: AC-E2 updated**
- [~~med~~] Palette sampling → **FIXED in spec: sample [0, N/2, N-1]**
- [~~med~~] Integer scale → **FIXED in spec: nearest-neighbor**
- [~~med~~] Discord size limit → **FIXED: added to risks + advisory**
- [improvement] Ring buffer backward capture → no action (v2 in Out of Scope)
- [improvement] Cancel during recording → no action (v2 in Out of Scope)
- [risk] readPixels stutter on mobile → no action (accept for v1, desktop primary)

## Notes

### Ship Retro (2026-04-08)
**Estimate vs Actual:** 2h → 1.5h (75%)
**What worked:** Spec review caught rAF ordering bug before implementation — would have been a hard-to-debug issue (stale frames). Library analysis saved hours of gif.js worker debugging. Sampled palette approach avoids color banding on dynamic content.
**What didn't:** gifenc has no TypeScript types despite claiming them — had to write a .d.ts. React 19 strict mode flagged `appRef.current` during render — needed `pixiApp` state workaround.
**Next time:** Always check `package.json` for actual `types` field before trusting README claims. For PixiJS refs passed to child components, prefer state over ref to avoid React 19 render purity errors.

## Progress

| # | Scope Item | Status | Iteration |
|---|-----------|--------|-----------|
| 1 | Install gifenc | [x] Complete | 1 |
| 2 | Create GifCapture.tsx | [x] Complete | 1 |
| 3 | Integrate in GameView.tsx | [x] Complete | 1 |
| 4 | Frame capture pipeline | [x] Complete | 1 |
| 5 | Encoding pipeline | [x] Complete | 1 |

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan | 2026-04-08T12:00:00Z | - | Created from issue #66 point 3. Informed by library analysis (gifenc chosen) + perf analysis (sync encoding, no Worker). |
| spec-review | 2026-04-08T13:00:00Z | - | 4 perspectives: Perf Engineer, UX Designer, PixiJS Expert, Skeptic. 2 criticals found (CORS taint, rAF ordering). 1 fixed in spec, 1 requires pre-ship exploration. |
| ship | 2026-04-08T14:00:00Z | - | All 5 scope items complete. Lint + typecheck + build pass. |
| done | 2026-04-08T14:30:00Z | 1.5h | User validated in Chrome. All gates green. |
