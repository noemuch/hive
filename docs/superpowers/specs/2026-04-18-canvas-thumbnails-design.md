# Canvas-rendered office thumbnails on company cards (#170)

**Status:** Design approved 2026-04-18

## Problem

`OfficePreview.tsx` renders a fake CSS pixel grid (gradient + randomized colored squares) on every `CompanyCard` in the home `CompanyGrid`. The grid does not show any real office content: no walls, no floors, no furniture, no characters. Users expect a preview that matches what they see when they enter a company (`GameView`), similar to Gather.town's small office squares.

## Goal

Render an honest, Gather-style pixel-art preview of each company's actual office on its card, using the existing canvas renderer. No fake variation. When per-company layouts eventually differ (future ticket), the same code produces per-company thumbnails with zero refactor.

## Non-goals

- Adding per-company layout differentiation (all companies share `/assets/default-layout.json` today — this is accepted).
- Live-updating thumbnails when agents move (static snapshot is enough).
- Animating characters in the thumbnail.
- Showing agents/characters in the thumbnail (pure office render).

## Architecture

### New files

**`web/src/canvas/thumbnail.ts`**

```
generateThumbnail(layout: OfficeLayout, widthPx: number, heightPx: number): Promise<string>
```

Pure function:
1. Create an `OffscreenCanvas(widthPx, heightPx)`.
2. Instantiate an `OfficeState(layout)` (no characters added).
3. Compute a zoom that fits the layout bounding box inside `widthPx × heightPx` with a small margin.
4. Call `renderFrame(ctx, widthPx, heightPx, state.tileMap, state.furniture, [], zoom, 0, 0, undefined, undefined, state.layout.tileColors, state.layout.cols, state.layout.rows)`.
5. Convert to PNG data URL: `await canvas.convertToBlob({ type: 'image/png' })` → read the blob with `FileReader.readAsDataURL` → resolve with the data URL string.
6. Return the data URL.

**`getSharedOfficeLayout(): Promise<OfficeLayout>`** — singleton promise that calls `loadAllAssets()` and `loadDefaultLayout()` once. All hooks await the same promise.

**`web/src/hooks/useCanvasThumbnail.ts`**

```
useCanvasThumbnail(companyId: string, widthPx: number, heightPx: number): {
  dataUrl: string | null;
  loading: boolean;
  error: Error | null;
}
```

1. On mount, compute cache key `sha1(layoutJson).slice(0,8)`.
2. If `sessionStorage.getItem(\`hive-thumb-\${key}\`)` exists → return it synchronously.
3. Otherwise, await `getSharedOfficeLayout()`, call `generateThumbnail`, store in `sessionStorage`, setState.
4. Return current state.

### Modified files

**`web/src/components/OfficePreview.tsx`**

- Keep existing props (`{ companyId, className }`).
- Replace CSS pixel-grid rendering with:
  - Call `useCanvasThumbnail(companyId, 320, 200)` (dimensions chosen to match the largest card aspect ratio).
  - If `loading` → render `<div className="...animate-pulse bg-muted/40" />`.
  - If `dataUrl` → render `<img src={dataUrl} alt="Office preview" className="w-full h-full object-cover" />`.
  - If `error` OR `typeof OffscreenCanvas === "undefined"` → fall back to the existing CSS rendering (keep the old code path as fallback only).

**`web/src/components/CompanyGrid.tsx`** — no changes (OfficePreview is drop-in).

**`web/src/components/CompanyCard.tsx`** — no changes (OfficePreview is drop-in).

## Data flow

```
Home page mount
  └─ CompanyGrid renders N CompanyCards (+ CompanyGrid's list variant)
       └─ each OfficePreview calls useCanvasThumbnail(companyId)
            └─ first call: getSharedOfficeLayout() → loadAllAssets() + loadDefaultLayout()
                 └─ generateThumbnail(layout, 320, 200) → data URL
                      └─ sessionStorage.setItem('hive-thumb-<key>', dataUrl)
            └─ subsequent calls: sessionStorage hit, return immediately
       └─ <img src={dataUrl}> rendered in-place
```

All thumbnails share the same `key` today (identical layouts) → 1 generation, N cache hits.

## Error handling

- `OffscreenCanvas` unsupported → fall back to CSS rendering. Tested on Safari 16+ (primary target), Chrome, Firefox all ship it.
- `loadAllAssets()` throws → show fallback CSS rendering, log to console once.
- `sessionStorage` throws (private mode quota) → in-memory cache fallback inside the hook module (Map keyed by hash).

## Testing

- **Manual:** `bun run dev`, visit `/`, verify 6 cards show pixel-art offices within 1s. Reload → instant from cache. Disable OffscreenCanvas via devtools override → fallback renders.
- **Lint:** `bun run lint` must be 0 errors. Any setState-in-effect for async loading must use `eslint-disable-next-line react-hooks/set-state-in-effect` *inside* the effect body.
- **No unit tests:** purely visual output; manual verification is sufficient for #170.

## Acceptance (from ticket #170)

- All home-page company cards show a canvas-rendered office thumbnail.
- First paint of 6 thumbnails completes in < 500ms after assets are loaded (shared singleton + sessionStorage cache → 1 real render, N cache hits).
- sessionStorage caches subsequent renders across navigations.
- Fallback to CSS rendering when `OffscreenCanvas` is unsupported.
- ~~"Visible office layout differs per company"~~ — **deliberately dropped for #170**. All companies share the default layout today; thumbnails honestly reflect that and will auto-differ when layouts do.
