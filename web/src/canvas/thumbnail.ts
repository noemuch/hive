import { renderScene, renderTileGrid } from './renderer';
import { OfficeState } from './officeState';
import { loadAllAssets, loadDefaultLayout } from './assetLoader';
import { TILE_SIZE, TileType } from './types';
import type { OfficeLayout, TileType as TileTypeVal } from './types';
import { getWallInstances, hasWallSprites } from './wallTiles';

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
 * Compute the bounding box of non-VOID tiles in the layout.
 * Returns inclusive min/max row and column. The default office layout has
 * ~48% VOID tiles forming an irregular shape; cropping to the non-VOID
 * bbox keeps thumbnails tight on the actual office footprint.
 */
function computeOfficeBbox(tileMap: TileTypeVal[][]): {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
} {
  let minRow = Infinity;
  let minCol = Infinity;
  let maxRow = -1;
  let maxCol = -1;
  for (let r = 0; r < tileMap.length; r++) {
    for (let c = 0; c < tileMap[r].length; c++) {
      if (tileMap[r][c] !== TileType.VOID) {
        if (r < minRow) minRow = r;
        if (r > maxRow) maxRow = r;
        if (c < minCol) minCol = c;
        if (c > maxCol) maxCol = c;
      }
    }
  }
  if (maxRow < 0) {
    return { minRow: 0, minCol: 0, maxRow: tileMap.length - 1, maxCol: 0 };
  }
  return { minRow, minCol, maxRow, maxCol };
}

/**
 * Render a static pixel-art snapshot of the office to a PNG data URL.
 *
 * Bypasses the full `renderFrame` to avoid its viewport dot-grid background —
 * instead renders tiles + walls + furniture directly onto a canvas sized to
 * the non-VOID bounding box of the layout. Areas outside the office shape
 * remain transparent, so the card's own background shows through.
 *
 * Returns null if OffscreenCanvas is unsupported.
 */
export async function generateThumbnail(
  layout: OfficeLayout,
  maxWidthPx: number,
  maxHeightPx: number,
): Promise<string | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;

  const state = new OfficeState(layout);
  const bbox = computeOfficeBbox(state.tileMap);

  const bboxTilesW = bbox.maxCol - bbox.minCol + 1;
  const bboxTilesH = bbox.maxRow - bbox.minRow + 1;
  const bboxPxW = bboxTilesW * TILE_SIZE;
  const bboxPxH = bboxTilesH * TILE_SIZE;

  const zoom = Math.min(maxWidthPx / bboxPxW, maxHeightPx / bboxPxH);

  const canvasWidth = Math.round(bboxPxW * zoom);
  const canvasHeight = Math.round(bboxPxH * zoom);

  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D | null;
  if (!ctx) return null;

  ctx.imageSmoothingEnabled = false;

  // Shift so tile (bbox.minCol, bbox.minRow) lands at canvas (0, 0).
  const offsetX = -bbox.minCol * TILE_SIZE * zoom;
  const offsetY = -bbox.minRow * TILE_SIZE * zoom;

  renderTileGrid(
    ctx,
    state.tileMap,
    offsetX,
    offsetY,
    zoom,
    state.layout.tileColors,
    state.layout.cols,
  );

  const wallInstances = hasWallSprites()
    ? getWallInstances(state.tileMap, state.layout.tileColors, state.layout.cols)
    : [];
  const allFurniture = wallInstances.length > 0 ? [...wallInstances, ...state.furniture] : state.furniture;

  renderScene(ctx, allFurniture, [], offsetX, offsetY, zoom, null, null);

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
