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

// POI positions for NPC destinations
export const POI = {
  COFFEE: { x: 21, y: 3 },
  WHITEBOARD: { x: 5, y: 10 },
  PRINTER: { x: 35, y: 5 },
  BREAK_AREA: { x: 30, y: 3 },
} as const;

TextureSource.defaultOptions.scaleMode = "nearest";

// Chair positions extracted from escape-room-01 desk groups
// These are where agents sit (front-facing chairs at desk clusters)
export let DESK_POSITIONS = [
  { x: 17, y: 9, dir: "front" },
  { x: 20, y: 9, dir: "front" },
  { x: 23, y: 9, dir: "front" },
  { x: 11, y: 14, dir: "front" },
  { x: 14, y: 14, dir: "front" },
  { x: 17, y: 14, dir: "front" },
  { x: 20, y: 14, dir: "front" },
  { x: 30, y: 18, dir: "front" },
];

// Tiled types are now in pathfinding.ts
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
        // Mask flip flags
        const realGid = gid & 0x1FFFFFFF;
        const tex = tiles.get(realGid);
        if (!tex) continue;
        const s = new Sprite(tex);
        s.cullable = true;
        s.x = (i % mapWidth) * TILE;
        s.y = Math.floor(i / mapWidth) * TILE;
        // Handle flips
        if (gid & 0x80000000) { s.scale.x = -1; s.anchor.x = 1; }
        if (gid & 0x40000000) { s.scale.y = -1; s.anchor.y = 1; }
        parent.addChild(s);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pick a random room from the escape room collection
// ---------------------------------------------------------------------------
const ROOM_COUNT = 10;

function getRandomRoomIndex(companyId?: string): number {
  if (!companyId) return 1;
  let hash = 0;
  for (let i = 0; i < companyId.length; i++) {
    hash = ((hash << 5) - hash + companyId.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % ROOM_COUNT) + 1;
}

// ---------------------------------------------------------------------------
// Create office
// ---------------------------------------------------------------------------
/** Load a Tiled JSON map and render it as a PixiJS container. */
export async function createOffice(_app: Application, companyId?: string): Promise<Container> {
  const office = new Container();
  office.scale.set(SCALE);
  office.sortableChildren = true;

  // Pick a room deterministically based on companyId
  const roomNum = getRandomRoomIndex(companyId);
  const roomId = String(roomNum).padStart(2, "0");

  // Load the Tiled JSON map
  let mapData: TiledMap;
  try {
    mapData = await fetch(`/maps/escape-room/escape-room-${roomId}.json`).then(r => r.json());
  } catch {
    // Fallback to room 01
    mapData = await fetch("/maps/escape-room/escape-room-01.json").then(r => r.json());
  }

  OFFICE_W = mapData.width;
  OFFICE_H = mapData.height;
  currentMapData = mapData as TiledMap;
  collisionGrid = buildCollisionGrid(mapData as TiledMap);

  // Load tilesets
  const tilesetSources: { source: TextureSource; firstgid: number; columns: number }[] = [];

  // room_builder (firstgid=1)
  try {
    const rbTex = await Assets.load("/maps/escape-room/room_builder.png");
    const rbSource = rbTex.source as TextureSource;
    const rbCols = Math.floor(rbSource.width / TILE);
    tilesetSources.push({ source: rbSource, firstgid: 1, columns: rbCols });
  } catch { /* skip */ }

  // office_items (firstgid=225)
  try {
    const oiTex = await Assets.load("/maps/escape-room/office_items.png");
    const oiSource = oiTex.source as TextureSource;
    const oiCols = Math.floor(oiSource.width / TILE);
    tilesetSources.push({ source: oiSource, firstgid: 225, columns: oiCols });
  } catch { /* skip */ }

  const tileTextures = buildAllTileTextures(tilesetSources);

  // Render all layers recursively
  renderAllLayers(office, mapData.layers, mapData.width, tileTextures);

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
