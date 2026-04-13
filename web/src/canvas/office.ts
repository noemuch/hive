import {
  Application,
  Container,
  Sprite,
  Text,
  TextStyle,
  Texture,
  Assets,
  Rectangle,
  TextureSource,
} from "pixi.js";

import { buildCollisionGrid, type TiledMap } from "./pathfinding";
import { TILE, SCALE } from "./constants";

let OFFICE_W = 40;
let OFFICE_H = 23;

// Collision grid + map data (populated after createOffice)
export let collisionGrid: boolean[][] = [];
export let currentMapData: TiledMap | null = null;

// Dynamic desk positions — populated from API response
export let DESK_POSITIONS: { x: number; y: number }[] = [];

// Dynamic POI — populated from API response, with defaults for fallback
const DEFAULT_POI: Record<string, { x: number; y: number }> = {
  COFFEE: { x: 21, y: 3 },
  WHITEBOARD: { x: 5, y: 10 },
  PRINTER: { x: 35, y: 5 },
  BREAK_AREA: { x: 30, y: 3 },
};

let poiMutable: Record<string, { x: number; y: number }> = { ...DEFAULT_POI };

/** Get current POI positions (dynamic, updated from API response). */
export function getPoi(): Record<string, { x: number; y: number }> {
  return poiMutable;
}

// Keep backward-compatible named export for code that reads POI directly
export const POI = DEFAULT_POI;

TextureSource.defaultOptions.scaleMode = "nearest";

type TiledLayer = import("./pathfinding").TiledLayer;

// ---------------------------------------------------------------------------
// Build tile textures from multiple tilesets
// ---------------------------------------------------------------------------
function buildAllTileTextures(sources: { source: TextureSource; firstgid: number; columns: number }[]): Map<number, Texture> {
  const map = new Map<number, Texture>();
  for (const { source, firstgid, columns } of sources) {
    const rows = Math.floor(source.height / TILE);
    const total = rows * columns;
    for (let id = 0; id < total; id++) {
      const col = id % columns;
      const row = Math.floor(id / columns);
      map.set(firstgid + id, new Texture({ source, frame: new Rectangle(col * TILE, row * TILE, TILE, TILE) }));
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Recursively render all tile layers (handles groups)
// ---------------------------------------------------------------------------
function renderAllLayers(parent: Container, layers: TiledLayer[], mapWidth: number, tiles: Map<number, Texture>) {
  for (const layer of layers) {
    if (!layer.visible) continue;

    if (layer.type === "group" && layer.layers) {
      renderAllLayers(parent, layer.layers, mapWidth, tiles);
    } else if (layer.type === "tilelayer" && layer.data) {
      for (let i = 0; i < layer.data.length; i++) {
        const gid = layer.data[i];
        if (gid === 0) continue;
        const realGid = gid & 0x1FFFFFFF;
        const tex = tiles.get(realGid);
        if (!tex) continue;
        const s = new Sprite(tex);
        s.cullable = true;
        s.x = (i % mapWidth) * TILE;
        s.y = Math.floor(i / mapWidth) * TILE;
        if (gid & 0x80000000) { s.scale.x = -1; s.anchor.x = 1; }
        if (gid & 0x40000000) { s.scale.y = -1; s.anchor.y = 1; }
        parent.addChild(s);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch office map from API
// ---------------------------------------------------------------------------
const API_URL = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000")
  : "http://localhost:3000";

async function fetchOfficeMap(companyId: string): Promise<TiledMap | null> {
  try {
    const res = await fetch(`${API_URL}/api/companies/${companyId}/map`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Create office
// ---------------------------------------------------------------------------
export async function createOffice(_app: Application, companyId?: string): Promise<Container> {
  const office = new Container();
  office.scale.set(SCALE);
  office.sortableChildren = true;

  // Try API first, fall back to static map
  let mapData: TiledMap;
  const apiMap = companyId ? await fetchOfficeMap(companyId) : null;
  if (apiMap) {
    mapData = apiMap;
  } else {
    mapData = await fetch("/maps/escape-room/escape-room-01.json").then(r => r.json());
  }

  OFFICE_W = mapData.width;
  OFFICE_H = mapData.height;
  currentMapData = mapData;
  collisionGrid = buildCollisionGrid(mapData);

  // Update desk positions from API response
  if (mapData.deskPositions && mapData.deskPositions.length > 0) {
    DESK_POSITIONS = mapData.deskPositions;
  } else {
    // Fallback desk positions for escape-room-01
    DESK_POSITIONS = [
      { x: 17, y: 9 }, { x: 20, y: 9 }, { x: 23, y: 9 },
      { x: 11, y: 14 }, { x: 14, y: 14 }, { x: 17, y: 14 },
      { x: 20, y: 14 }, { x: 30, y: 18 },
    ];
  }

  // Update POI from API response
  if (mapData.poi) {
    poiMutable = {
      COFFEE: mapData.poi.coffee ?? { x: 21, y: 3 },
      WHITEBOARD: mapData.poi.whiteboard,
      PRINTER: { x: 35, y: 5 },
      BREAK_AREA: mapData.poi.coffee ?? { x: 30, y: 3 },
    };
  }

  // Render: either background image (V1) or tile layers (V2+)
  if (mapData.backgroundImage) {
    // V1: Load the office design as a single background sprite
    try {
      const bgTex = await Assets.load(mapData.backgroundImage);
      const bg = new Sprite(bgTex);
      bg.zIndex = 0;
      office.addChild(bg);
    } catch {
      // Fallback: dark background
      console.warn("Failed to load office background image");
    }
  } else {
    // V2+: Tile-based rendering
    const tilesetSources: { source: TextureSource; firstgid: number; columns: number }[] = [];

    for (const ts of mapData.tilesets) {
      if (!ts.image) continue;
      try {
        const tex = await Assets.load(ts.image);
        const source = tex.source as TextureSource;
        const cols = ts.columns ?? Math.floor(source.width / TILE);
        tilesetSources.push({ source, firstgid: ts.firstgid, columns: cols });
      } catch { /* skip */ }
    }

    if (tilesetSources.length === 0) {
      try {
        const rbTex = await Assets.load("/maps/escape-room/room_builder.png");
        tilesetSources.push({ source: rbTex.source as TextureSource, firstgid: 1, columns: Math.floor(rbTex.source.width / TILE) });
      } catch { /* skip */ }
      try {
        const oiTex = await Assets.load("/maps/escape-room/office_items.png");
        tilesetSources.push({ source: oiTex.source as TextureSource, firstgid: 225, columns: Math.floor(oiTex.source.width / TILE) });
      } catch { /* skip */ }
    }

    const tileTextures = buildAllTileTextures(tilesetSources);
    renderAllLayers(office, mapData.layers, mapData.width, tileTextures);
  }

  // Company label
  const label = new Text({
    text: "",
    style: new TextStyle({ fontSize: 8, fontFamily: "monospace", fill: 0x555555, fontWeight: "bold", letterSpacing: 1 }),
  });
  label.x = TILE * 2;
  label.y = (OFFICE_H - 2) * TILE;
  label.name = "companyLabel";
  label.label = "companyLabel";
  label.zIndex = 500;
  office.addChild(label);

  return office;
}

export { TILE, OFFICE_W, OFFICE_H, SCALE };
