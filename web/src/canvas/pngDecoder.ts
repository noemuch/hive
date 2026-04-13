/**
 * Browser-side PNG decoding utilities.
 *
 * Uses HTMLCanvasElement + Image to decode PNGs into SpriteData format.
 * Adapted from pixel-agents shared/assets/pngDecoder.ts (MIT license).
 */

import { rgbaToHex } from './colorUtils';
import {
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from './constants';

export interface CharacterDirectionSprites {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

// ── Helpers ──────────────────────────────────────────────────────

/** Load an image from a URL and return ImageData via an offscreen canvas */
async function loadImageData(url: string): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, img.width, img.height);
  return { data: imageData.data, width: img.width, height: img.height };
}

// ── Sprite decoding ──────────────────────────────────────────

/**
 * Convert pixel data to SpriteData (2D array of hex color strings).
 * '' = transparent, '#RRGGBB' = opaque, '#RRGGBBAA' = semi-transparent.
 */
function pixelDataToSpriteData(
  data: Uint8ClampedArray,
  imgWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): string[][] {
  const sprite: string[][] = [];
  for (let row = 0; row < height; row++) {
    const rowData: string[] = [];
    for (let col = 0; col < width; col++) {
      const idx = ((y + row) * imgWidth + (x + col)) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      rowData.push(rgbaToHex(r, g, b, a));
    }
    sprite.push(rowData);
  }
  return sprite;
}

/**
 * Decode a character PNG from URL into direction-keyed frame arrays.
 * Each PNG has 3 direction rows (down, up, right) x 7 frames (16x32 each).
 */
export async function decodeCharacterPng(url: string): Promise<CharacterDirectionSprites> {
  const { data, width } = await loadImageData(url);
  const charData: CharacterDirectionSprites = { down: [], up: [], right: [] };

  for (let dirIdx = 0; dirIdx < CHARACTER_DIRECTIONS.length; dirIdx++) {
    const dir = CHARACTER_DIRECTIONS[dirIdx];
    const rowOffsetY = dirIdx * CHAR_FRAME_H;
    const frames: string[][][] = [];

    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      const frameOffsetX = f * CHAR_FRAME_W;
      frames.push(pixelDataToSpriteData(data, width, frameOffsetX, rowOffsetY, CHAR_FRAME_W, CHAR_FRAME_H));
    }
    charData[dir] = frames;
  }

  return charData;
}

/**
 * Parse a single wall PNG (64x128, 4x4 grid of 16x32 pieces) into 16 bitmask sprites.
 */
export async function parseWallPng(url: string): Promise<string[][][]> {
  const { data, width } = await loadImageData(url);
  const sprites: string[][][] = [];
  for (let mask = 0; mask < WALL_BITMASK_COUNT; mask++) {
    const ox = (mask % WALL_GRID_COLS) * WALL_PIECE_WIDTH;
    const oy = Math.floor(mask / WALL_GRID_COLS) * WALL_PIECE_HEIGHT;
    sprites.push(pixelDataToSpriteData(data, width, ox, oy, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT));
  }
  return sprites;
}

/**
 * Decode a single floor tile PNG (16x16).
 */
export async function decodeFloorPng(url: string): Promise<string[][]> {
  const { data, width } = await loadImageData(url);
  return pixelDataToSpriteData(data, width, 0, 0, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE);
}

/**
 * Decode a furniture PNG from URL into SpriteData.
 */
export async function decodeFurniturePng(url: string, w: number, h: number): Promise<string[][]> {
  const { data, width } = await loadImageData(url);
  return pixelDataToSpriteData(data, width, 0, 0, w, h);
}
