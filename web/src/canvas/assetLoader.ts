/**
 * Browser-side asset loader for Hive.
 *
 * Fetches PNGs from /assets/ via HTTP, decodes them using canvas-based pngDecoder,
 * and registers them into the sprite/catalog modules.
 *
 * Adapted from pixel-agents shared/assets/loader.ts (MIT license).
 */

import { setFloorSprites } from './floorTiles';
import { buildDynamicCatalog, type LoadedAssetData } from './furnitureCatalog';
import { flattenManifest, type FurnitureAsset, type FurnitureManifest, type InheritedProps } from './manifestUtils';
import { decodeCharacterPng, decodeFloorPng, decodeFurniturePng, parseWallPng } from './pngDecoder';
import { setCharacterTemplates } from './spriteData';
import type { OfficeLayout } from './types';
import { setWallSprites } from './wallTiles';

const ASSETS_BASE = '/assets';

// ── Index discovery ─────────────────────────────────────────────

/** Known asset file counts — avoids HEAD discovery which fails on some dev servers */
const KNOWN_COUNTS: Record<string, number> = {
  characters: 6,
  floors: 9,
  walls: 1,
};

/** Get URLs for a known set of sequential asset files */
function getFileUrls(dir: string, prefix: string, ext: string): string[] {
  const count = KNOWN_COUNTS[dir] ?? 0;
  return Array.from({ length: count }, (_, i) => `${ASSETS_BASE}/${dir}/${prefix}${i}${ext}`);
}

// ── Decoders ─────────────────────────────────────────────────────

async function loadAllCharacters(): Promise<void> {
  const urls = getFileUrls('characters', 'char_', '.png');
  if (urls.length === 0) {
    console.warn('[assetLoader] No character PNGs found');
    return;
  }
  const characters = await Promise.all(urls.map((url) => decodeCharacterPng(url)));
  setCharacterTemplates(characters);
  console.log(`[assetLoader] Loaded ${characters.length} character sprites`);
}

async function loadAllFloors(): Promise<void> {
  const urls = getFileUrls('floors', 'floor_', '.png');
  if (urls.length === 0) {
    console.warn('[assetLoader] No floor PNGs found');
    return;
  }
  const floors = await Promise.all(urls.map((url) => decodeFloorPng(url)));
  setFloorSprites(floors);
  console.log(`[assetLoader] Loaded ${floors.length} floor tiles`);
}

async function loadAllWalls(): Promise<void> {
  const urls = getFileUrls('walls', 'wall_', '.png');
  if (urls.length === 0) {
    console.warn('[assetLoader] No wall PNGs found');
    return;
  }
  const walls = await Promise.all(urls.map((url) => parseWallPng(url)));
  setWallSprites(walls);
  console.log(`[assetLoader] Loaded ${walls.length} wall tile sets (${walls[0]?.length ?? 0} sprites each)`);
}

// ── Furniture manifest loading ──────────────────────────────────

/** List furniture directories by fetching a known index, or try known names */
async function discoverFurnitureDirs(): Promise<string[]> {
  // We know the furniture directory names from the asset copy step.
  // Try fetching manifests for all known dirs.
  const knownDirs = [
    'BIN', 'BOOKSHELF', 'CACTUS', 'CLOCK', 'COFFEE', 'COFFEE_TABLE',
    'CUSHIONED_BENCH', 'CUSHIONED_CHAIR', 'DESK', 'DOUBLE_BOOKSHELF',
    'HANGING_PLANT', 'LARGE_PAINTING', 'LARGE_PLANT', 'PC', 'PLANT',
    'PLANT_2', 'POT', 'SMALL_PAINTING', 'SMALL_PAINTING_2', 'SMALL_TABLE',
    'SOFA', 'TABLE_FRONT', 'WHITEBOARD', 'WOODEN_BENCH', 'WOODEN_CHAIR',
  ];
  // All dirs are known from the asset copy step — no discovery needed
  return knownDirs;
}

async function loadAllFurniture(): Promise<void> {
  const dirs = await discoverFurnitureDirs();
  if (dirs.length === 0) {
    console.warn('[assetLoader] No furniture manifests found');
    return;
  }

  // Load all manifests
  const manifests: FurnitureManifest[] = [];
  await Promise.all(
    dirs.map(async (dir) => {
      try {
        const res = await fetch(`${ASSETS_BASE}/furniture/${dir}/manifest.json`);
        if (res.ok) {
          const manifest = (await res.json()) as FurnitureManifest;
          manifests.push(manifest);
        }
      } catch (err) {
        console.warn(`[assetLoader] Failed to load manifest for ${dir}:`, err);
      }
    }),
  );

  // Flatten all manifests into flat asset lists
  const allAssets: FurnitureAsset[] = [];
  for (const manifest of manifests) {
    const inherited: InheritedProps = {
      groupId: manifest.id,
      name: manifest.name,
      category: manifest.category,
      canPlaceOnWalls: manifest.canPlaceOnWalls,
      canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
      backgroundTiles: manifest.backgroundTiles,
    };

    if (manifest.type === 'asset') {
      // Single-asset manifest (no group)
      // Default file to {id}.png when manifest omits the file field
      allAssets.push({
        id: manifest.id,
        name: manifest.name,
        label: manifest.name,
        category: manifest.category,
        file: manifest.file ?? `${manifest.id}.png`,
        width: manifest.width!,
        height: manifest.height!,
        footprintW: manifest.footprintW!,
        footprintH: manifest.footprintH!,
        isDesk: manifest.category === 'desks',
        canPlaceOnWalls: manifest.canPlaceOnWalls,
        canPlaceOnSurfaces: manifest.canPlaceOnSurfaces,
        backgroundTiles: manifest.backgroundTiles,
      });
    } else if (manifest.members) {
      // Group manifest
      for (const member of manifest.members) {
        allAssets.push(...flattenManifest(member, inherited));
      }
    }
  }

  // Decode all furniture PNGs
  const sprites: Record<string, string[][]> = {};
  await Promise.all(
    allAssets.map(async (asset) => {
      // Find the furniture dir from the manifest's id (parent groupId)
      const dir = asset.groupId ?? asset.id;
      const url = `${ASSETS_BASE}/furniture/${dir}/${asset.file}`;
      try {
        sprites[asset.id] = await decodeFurniturePng(url, asset.width, asset.height);
      } catch (err) {
        console.warn(`[assetLoader] Failed to decode furniture ${asset.id} from ${url} (${asset.width}x${asset.height}):`, err);
      }
    }),
  );

  // Build the catalog
  const catalogData: LoadedAssetData = {
    catalog: allAssets.map((a) => ({
      id: a.id,
      label: a.label,
      category: a.category,
      width: a.width,
      height: a.height,
      footprintW: a.footprintW,
      footprintH: a.footprintH,
      isDesk: a.isDesk,
      groupId: a.groupId,
      orientation: a.orientation,
      state: a.state,
      canPlaceOnSurfaces: a.canPlaceOnSurfaces,
      backgroundTiles: a.backgroundTiles,
      canPlaceOnWalls: a.canPlaceOnWalls,
      mirrorSide: a.mirrorSide,
      rotationScheme: a.rotationScheme,
      animationGroup: a.animationGroup,
      frame: a.frame,
    })),
    sprites,
  };

  const ok = buildDynamicCatalog(catalogData);
  if (!ok) {
    console.warn('[assetLoader] Failed to build furniture catalog');
  }
}

// ── Layout loading ──────────────────────────────────────────────

export async function loadDefaultLayout(): Promise<OfficeLayout | null> {
  try {
    const res = await fetch(`${ASSETS_BASE}/default-layout.json`);
    if (!res.ok) return null;
    return (await res.json()) as OfficeLayout;
  } catch {
    return null;
  }
}

// ── Main entry point ────────────────────────────────────────────

/**
 * Load all pixel-agents assets from /assets/ and register them.
 * Call this once during app initialization (before rendering).
 */
export async function loadAllAssets(): Promise<void> {
  console.log('[assetLoader] Loading assets...');
  const start = performance.now();

  // Load all asset types in parallel
  await Promise.all([
    loadAllCharacters(),
    loadAllFloors(),
    loadAllWalls(),
    loadAllFurniture(),
  ]);

  const elapsed = Math.round(performance.now() - start);
  console.log(`[assetLoader] All assets loaded in ${elapsed}ms`);
}
