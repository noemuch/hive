# Canvas Office Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake CSS pixel-grid in `OfficePreview` with a real Canvas 2D pixel-art render of the current office layout, using the existing `renderFrame` renderer.

**Architecture:** A pure `generateThumbnail(layout, w, h)` function draws the office into an `OffscreenCanvas`, returns a PNG data URL. A `useCanvasThumbnail` hook shares one asset-loading promise across all cards and caches the data URL per layout hash in `sessionStorage`. `OfficePreview` swaps the CSS grid for `<img src={dataUrl}>` with a skeleton while loading and CSS fallback on error.

**Tech Stack:** React 19 / Next.js 16 / Canvas 2D / `OffscreenCanvas` / sessionStorage / existing `/assets/default-layout.json`.

---

## File Structure

| File | Role |
|------|------|
| `web/src/canvas/thumbnail.ts` (new) | `generateThumbnail(layout, w, h)` + `getSharedOfficeLayout()` singleton |
| `web/src/hooks/useCanvasThumbnail.ts` (new) | React hook: loads shared layout, generates + caches PNG data URL |
| `web/src/components/OfficePreview.tsx` (modify) | Swap CSS grid for `<img>` + skeleton + CSS fallback |

All other files (`CompanyCard.tsx`, `CompanyGrid.tsx`) remain untouched thanks to stable `OfficePreview` props.

---

## Task 1: Create `thumbnail.ts` — pure renderer + layout singleton

**Files:**
- Create: `web/src/canvas/thumbnail.ts`

- [ ] **Step 1: Write the file**

```typescript
import { renderFrame } from './renderer';
import { OfficeState } from './officeState';
import { loadAllAssets, loadDefaultLayout } from './assetLoader';
import { TILE_SIZE } from './types';
import type { OfficeLayout } from './types';

let sharedPromise: Promise<OfficeLayout> | null = null;

/**
 * Load assets once, return the default office layout.
 * All thumbnail consumers share the same promise.
 */
export function getSharedOfficeLayout(): Promise<OfficeLayout> {
  if (!sharedPromise) {
    sharedPromise = (async () => {
      await loadAllAssets();
      const layout = await loadDefaultLayout();
      if (!layout) throw new Error('Failed to load default office layout');
      return layout;
    })();
  }
  return sharedPromise;
}

/**
 * Render a static pixel-art snapshot of the office to a PNG data URL.
 * Returns null if OffscreenCanvas is unsupported.
 */
export async function generateThumbnail(
  layout: OfficeLayout,
  widthPx: number,
  heightPx: number,
): Promise<string | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;

  const canvas = new OffscreenCanvas(widthPx, heightPx);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;

  // Compute zoom so the full layout fits within the canvas with ~8% margin.
  const mapWidth = layout.cols * TILE_SIZE;
  const mapHeight = layout.rows * TILE_SIZE;
  const marginFactor = 0.92;
  const zoom = Math.min(
    (widthPx * marginFactor) / mapWidth,
    (heightPx * marginFactor) / mapHeight,
  );

  const state = new OfficeState(layout);

  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    widthPx,
    heightPx,
    state.tileMap,
    state.furniture,
    [], // no characters in thumbnail
    zoom,
    0, // no pan
    0,
    undefined, // no selection
    undefined, // no editor overlays
    state.layout.tileColors,
    state.layout.cols,
    state.layout.rows,
  );

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return await blobToDataUrl(blob);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Stable 8-char hash of a layout, used as cache key.
 */
export function hashLayout(layout: OfficeLayout): string {
  const json = JSON.stringify(layout);
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  // Base36, padded to keep length stable.
  return (h >>> 0).toString(36).padStart(7, '0').slice(0, 8);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/canvas/thumbnail.ts
git commit -m "feat(canvas): add thumbnail generator + shared layout singleton (#170)"
```

---

## Task 2: Create `useCanvasThumbnail` hook

**Files:**
- Create: `web/src/hooks/useCanvasThumbnail.ts`

- [ ] **Step 1: Write the hook**

```typescript
"use client";

import { useEffect, useState } from "react";
import { generateThumbnail, getSharedOfficeLayout, hashLayout } from "@/canvas/thumbnail";

const CACHE_PREFIX = "hive-thumb-";
const inMemoryCache = new Map<string, string>();

function readCache(key: string): string | null {
  const mem = inMemoryCache.get(key);
  if (mem) return mem;
  try {
    return sessionStorage.getItem(CACHE_PREFIX + key);
  } catch {
    return null;
  }
}

function writeCache(key: string, dataUrl: string): void {
  inMemoryCache.set(key, dataUrl);
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, dataUrl);
  } catch {
    // Quota/private mode — in-memory cache still holds it.
  }
}

export type CanvasThumbnailState = {
  dataUrl: string | null;
  loading: boolean;
  error: Error | null;
};

export function useCanvasThumbnail(
  widthPx: number,
  heightPx: number,
): CanvasThumbnailState {
  const [state, setState] = useState<CanvasThumbnailState>({
    dataUrl: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const layout = await getSharedOfficeLayout();
        const key = hashLayout(layout);

        const cached = readCache(key);
        if (cached) {
          if (!cancelled) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: async load resolution
            setState({ dataUrl: cached, loading: false, error: null });
          }
          return;
        }

        const dataUrl = await generateThumbnail(layout, widthPx, heightPx);
        if (cancelled) return;

        if (!dataUrl) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: unsupported env
          setState({ dataUrl: null, loading: false, error: new Error("OffscreenCanvas unsupported") });
          return;
        }

        writeCache(key, dataUrl);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: async load resolution
        setState({ dataUrl, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: async failure surface
        setState({
          dataUrl: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [widthPx, heightPx]);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Lint**

Run: `cd web && bun run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useCanvasThumbnail.ts
git commit -m "feat(hooks): useCanvasThumbnail with session + in-memory cache (#170)"
```

---

## Task 3: Swap `OfficePreview` to use the canvas thumbnail

**Files:**
- Modify: `web/src/components/OfficePreview.tsx`

- [ ] **Step 1: Replace the component body**

Keep the existing helpers (`hash`, `seededRandom`, `FLOOR_COLORS`, etc.) as the fallback renderer — only the exported `OfficePreview` component changes.

```typescript
"use client";

/**
 * Pixel-art office preview for company cards.
 *
 * Renders the real office layout via an OffscreenCanvas snapshot
 * (see `web/src/canvas/thumbnail.ts`). Falls back to a deterministic
 * CSS pixel grid when OffscreenCanvas is unavailable or rendering fails.
 */

import { useCanvasThumbnail } from "@/hooks/useCanvasThumbnail";

const FLOOR_COLORS = ["#2a1f14", "#1a2a1f", "#1f1a2a", "#2a1a1a", "#1a1f2a"];
const WALL_COLORS = ["#1e293b", "#1e1e2e", "#1b2e2e", "#2e1e1e", "#1e2e1b"];
const ACCENT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];
const SCREEN_COLORS = ["#38bdf8", "#34d399", "#a78bfa", "#fb923c", "#f472b6"];

const THUMB_WIDTH = 320;
const THUMB_HEIGHT = 200;

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

type Props = {
  companyId: string;
  className?: string;
};

export function OfficePreview({ companyId, className = "" }: Props) {
  const { dataUrl, loading, error } = useCanvasThumbnail(THUMB_WIDTH, THUMB_HEIGHT);

  if (loading) {
    return (
      <div
        className={`relative overflow-hidden bg-muted/40 animate-pulse ${className}`}
      />
    );
  }

  if (dataUrl && !error) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        <img
          src={dataUrl}
          alt=""
          className="w-full h-full object-cover"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    );
  }

  return <CssFallback companyId={companyId} className={className} />;
}

// ─── CSS fallback (only used when OffscreenCanvas is unsupported) ──

function CssFallback({ companyId, className = "" }: Props) {
  const h = hash(companyId);
  const rand = seededRandom(h);
  const floor = FLOOR_COLORS[h % FLOOR_COLORS.length];
  const wall = WALL_COLORS[h % WALL_COLORS.length];
  const accent = ACCENT_COLORS[h % ACCENT_COLORS.length];
  const screenColor = SCREEN_COLORS[(h >> 3) % SCREEN_COLORS.length];

  const COLS = 6;
  const ROWS = 4;
  const cells: { type: "empty" | "desk" | "screen" | "plant" | "chair" }[] = [];

  for (let i = 0; i < COLS * ROWS; i++) {
    const r = rand();
    if (r < 0.25) cells.push({ type: "desk" });
    else if (r < 0.35) cells.push({ type: "screen" });
    else if (r < 0.4) cells.push({ type: "plant" });
    else if (r < 0.5) cells.push({ type: "chair" });
    else cells.push({ type: "empty" });
  }

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ backgroundColor: floor, imageRendering: "pixelated" }}
    >
      <div
        className="absolute top-0 left-0 right-0"
        style={{ height: "30%", backgroundColor: wall }}
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
          backgroundSize: "12px 12px",
        }}
      />
      <div
        className="absolute inset-0 p-[12%]"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, 1fr)`,
          gridTemplateRows: `repeat(${ROWS}, 1fr)`,
          gap: "4px",
        }}
      >
        {cells.map((cell, i) => {
          if (cell.type === "empty") return <div key={i} />;
          const colors: Record<string, string> = {
            desk: accent + "40",
            screen: screenColor,
            plant: "#22c55e60",
            chair: accent + "20",
          };
          const sizes: Record<string, string> = {
            desk: "80%",
            screen: "45%",
            plant: "35%",
            chair: "50%",
          };
          return (
            <div key={i} className="flex items-center justify-center">
              <div
                style={{
                  width: sizes[cell.type],
                  aspectRatio: cell.type === "desk" ? "2/1" : "1",
                  backgroundColor: colors[cell.type],
                  borderRadius: cell.type === "plant" ? "50%" : "2px",
                  boxShadow: cell.type === "screen" ? `0 0 4px ${screenColor}60` : undefined,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/10" />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && bunx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: Lint**

Run: `cd web && bun run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/OfficePreview.tsx
git commit -m "feat(ui): OfficePreview renders canvas snapshot with CSS fallback (#170)"
```

---

## Task 4: Manual QA + ship to main

**Files:**
- None (verification only).

- [ ] **Step 1: Run dev server**

```bash
cd web && bun run dev
```

Open `http://localhost:3000/`. Expected: all company cards show a pixel-art office (walls, floor, furniture, no characters), visually consistent with `GameView` content. First paint under ~1s after page load.

- [ ] **Step 2: Verify cache hit**

Reload the page (hard reload `Cmd+Shift+R`). Expected: thumbnails appear instantly (no re-render), confirmed by DevTools Application → Session Storage showing a `hive-thumb-<hash>` entry.

- [ ] **Step 3: Verify fallback**

In DevTools, run `delete window.OffscreenCanvas` then soft-reload (or temporarily force the hook to receive `dataUrl: null`). Expected: CSS fallback renders instead of a broken image.

- [ ] **Step 4: Push to main**

```bash
git push origin main
```

- [ ] **Step 5: Verify Vercel deploy**

Wait for Vercel preview to finish (~60s), visit production URL, verify thumbnails render. Check browser console for 0 errors from `thumbnail.ts` / `useCanvasThumbnail.ts`.

- [ ] **Step 6: Close #170 on GitHub**

```bash
gh issue close 170 -c "Shipped in $(git rev-parse --short HEAD). Canvas-rendered office thumbnails now replace the CSS pixel-grid on home company cards. Per-company layout differentiation deliberately deferred — will come naturally when layouts diverge."
```
