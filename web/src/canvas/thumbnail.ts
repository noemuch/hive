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
 *
 * The output canvas is sized to the layout's aspect ratio (tight-fit),
 * never larger than `maxWidthPx × maxHeightPx`. This avoids empty dot-grid
 * background around the office. Consumers use `object-cover` to fit into
 * any card aspect ratio.
 *
 * Returns null if OffscreenCanvas is unsupported.
 */
export async function generateThumbnail(
  layout: OfficeLayout,
  maxWidthPx: number,
  maxHeightPx: number,
): Promise<string | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;

  const mapWidth = layout.cols * TILE_SIZE;
  const mapHeight = layout.rows * TILE_SIZE;
  const zoom = Math.min(maxWidthPx / mapWidth, maxHeightPx / mapHeight);

  const canvasWidth = Math.round(mapWidth * zoom);
  const canvasHeight = Math.round(mapHeight * zoom);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;

  const state = new OfficeState(layout);

  renderFrame(
    ctx as unknown as CanvasRenderingContext2D,
    canvasWidth,
    canvasHeight,
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
  return (h >>> 0).toString(36).padStart(7, '0').slice(0, 8);
}
