// server/src/engine/office-templates.ts

/**
 * Template builder functions — compose stamps into complete office layouts.
 * Each template creates walls, floor, places stamps, adds decorations.
 */

import {
  VOID, FLOOR, WALL, CARPET, TILESETS,
  WALL_DECO, MONITOR, TRASH,
} from "./office-tiles";
import {
  placeStamp, getStampDesks,
  WORKSTATION_A, WORKSTATION_B, WORKSTATION_PAIR,
  MEETING_SMALL, BREAK_AREA, UTILITY_AREA,
  PLANT_CORNER,
} from "./office-stamps";
import { pick, randInt, type Rng } from "./seeded-random";

// ── Types ──────────────────────────────────────────────────────────────

interface CollisionObject {
  name: string; type: string;
  x: number; y: number; width: number; height: number;
}

export interface TemplateOutput {
  width: number;
  height: number;
  tilewidth: 16;
  tileheight: 16;
  layers: {
    name: string;
    type: "tilelayer" | "objectgroup";
    data?: number[];
    objects?: CollisionObject[];
    width?: number; height?: number;
    visible: boolean; opacity: number;
  }[];
  tilesets: typeof TILESETS;
  deskPositions: { x: number; y: number }[];
  poi: {
    coffee: { x: number; y: number } | null;
    whiteboard: { x: number; y: number };
    door: { x: number; y: number };
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeLayer(w: number, h: number): number[] {
  return new Array(w * h).fill(0);
}

function set(layer: number[], w: number, x: number, y: number, gid: number): void {
  if (x >= 0 && x < w && y >= 0) layer[y * w + x] = gid;
}

/** Fill a rectangular area with a tile GID. */
function fillRect(layer: number[], w: number, x1: number, y1: number, x2: number, y2: number, gid: number): void {
  for (let y = y1; y <= y2; y++)
    for (let x = x1; x <= x2; x++)
      set(layer, w, x, y, gid);
}

/** Build perimeter walls (same system as V1). */
function buildPerimeterWalls(backdrop: number[], furniture: number[], w: number, h: number, rng: Rng): void {
  const wallFills = rng() < 0.5 ? [WALL.FILL_A, WALL.FILL_B] : [WALL.FILL_C, WALL.FILL_D];
  // Backdrop = void everywhere
  for (let i = 0; i < w * h; i++) backdrop[i] = VOID;
  // Top wall (4 rows)
  set(furniture, w, 0, 0, WALL.T1_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 0, pick(rng, wallFills));
  set(furniture, w, w - 1, 0, WALL.T1_R);
  set(furniture, w, 0, 1, WALL.T2_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 1, pick(rng, wallFills));
  set(furniture, w, w - 1, 1, WALL.T2_R);
  set(furniture, w, 0, 2, WALL.T3_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 2, pick(rng, wallFills));
  set(furniture, w, w - 1, 2, WALL.T3_R);
  set(furniture, w, 0, 3, WALL.BASE_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 3, WALL.BASE_C);
  set(furniture, w, w - 1, 3, WALL.BASE_R);
  // Side walls
  for (let y = 4; y < h - 2; y++) {
    set(furniture, w, 0, y, WALL.DARK_C);
    set(furniture, w, w - 1, y, WALL.DARK_C);
  }
  // Bottom wall
  for (let x = 0; x < w; x++) {
    set(furniture, w, x, h - 2, WALL.TRIM_C);
    set(furniture, w, x, h - 1, WALL.BOT_A);
  }
  set(furniture, w, 0, h - 2, WALL.TRIM_L);
  set(furniture, w, w - 1, h - 2, WALL.TRIM_R);
  set(furniture, w, 0, h - 1, WALL.DARK_L);
  set(furniture, w, w - 1, h - 1, WALL.DARK_R);
}

/** Build a horizontal internal wall at row y from x1 to x2. */
function buildInternalWallH(furniture: number[], w: number, y: number, x1: number, x2: number): void {
  for (let x = x1; x <= x2; x++) {
    set(furniture, w, x, y, WALL.DARK_C);
    set(furniture, w, x, y + 1, WALL.BASE_C);
  }
}

/** Build a vertical internal wall at col x from y1 to y2. */
function buildInternalWallV(furniture: number[], w: number, x: number, y1: number, y2: number): void {
  for (let y = y1; y <= y2; y++) {
    set(furniture, w, x, y, WALL.DARK_C);
  }
}

/** Build floor with optional carpet zones. */
function buildFloor(
  floor: number[], w: number, h: number, rng: Rng,
  carpetZones?: { x1: number; y1: number; x2: number; y2: number }[],
): void {
  const mainFloor = pick(rng, [[FLOOR.WOOD_A, FLOOR.WOOD_B], [FLOOR.WOOD_C, FLOOR.WOOD_D]]);
  for (let y = 4; y < h - 2; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tile = (x + y) % 2 === 0 ? mainFloor[0] : mainFloor[1];
      set(floor, w, x, y, tile);
    }
  }
  // Carpet zones
  if (carpetZones) {
    const carpetPair = pick(rng, [[CARPET.BROWN_A, CARPET.BROWN_B], [CARPET.GRAY_A, CARPET.GRAY_B], [CARPET.TAN_A, CARPET.TAN_B]]);
    for (const z of carpetZones) {
      for (let y = z.y1; y <= z.y2; y++) {
        for (let x = z.x1; x <= z.x2; x++) {
          const tile = (x + y) % 2 === 0 ? carpetPair[0] : carpetPair[1];
          set(floor, w, x, y, tile);
        }
      }
    }
  }
}

/** Place door in bottom wall. */
function placeDoor(furniture: number[], floor: number[], w: number, h: number, doorX: number): { x: number; y: number } {
  for (let dx = -1; dx <= 1; dx++) {
    set(furniture, w, doorX + dx, h - 2, 0);
    set(furniture, w, doorX + dx, h - 1, 0);
    set(floor, w, doorX + dx, h - 2, FLOOR.EDGE);
    set(floor, w, doorX + dx, h - 1, FLOOR.EDGE);
  }
  return { x: doorX, y: h - 2 };
}

/** Scatter wall decorations along top wall (row 1-2). */
function decorateTopWall(furniture: number[], w: number, rng: Rng): { whiteboard: { x: number; y: number } } {
  const decoSlots: number[] = [];
  for (let x = 2; x < w - 4; x += randInt(rng, 3, 5)) {
    decoSlots.push(x);
  }
  // First slot = whiteboard/display
  const wbX = decoSlots[0] ?? 3;
  set(furniture, w, wbX, 1, MONITOR.DISPLAY_TL);
  set(furniture, w, wbX + 1, 1, MONITOR.DISPLAY_TR);
  set(furniture, w, wbX, 2, MONITOR.DISPLAY_BL);
  set(furniture, w, wbX + 1, 2, MONITOR.DISPLAY_BR);
  // Remaining slots = shelves, art, AC
  for (let i = 1; i < decoSlots.length; i++) {
    const x = decoSlots[i];
    const deco = randInt(rng, 0, 2);
    if (deco === 0) {
      set(furniture, w, x, 1, WALL_DECO.SHELF_TL);
      set(furniture, w, x + 1, 1, WALL_DECO.SHELF_TR);
      set(furniture, w, x, 2, WALL_DECO.SHELF_BL);
      set(furniture, w, x + 1, 2, WALL_DECO.SHELF_BR);
    } else if (deco === 1) {
      set(furniture, w, x, 1, WALL_DECO.ART_TL);
      set(furniture, w, x + 1, 1, WALL_DECO.ART_TR);
      set(furniture, w, x, 2, WALL_DECO.ART_BL);
      set(furniture, w, x + 1, 2, WALL_DECO.ART_BR);
    } else {
      set(furniture, w, x, 1, WALL_DECO.AC_L);
      set(furniture, w, x + 1, 1, WALL_DECO.AC_R);
    }
  }
  return { whiteboard: { x: wbX, y: 2 } };
}

/** Place plants in corners and gaps. */
function placePlants(furniture: number[], w: number, h: number, rng: Rng): void {
  // Top-left corner
  if (rng() < 0.8) placeStamp(furniture, w, PLANT_CORNER, 1, 4);
  // Top-right corner
  if (rng() < 0.8) placeStamp(furniture, w, PLANT_CORNER, w - 3, 4);
  // Bottom corners
  if (rng() < 0.6) placeStamp(furniture, w, PLANT_CORNER, 1, h - 5);
  if (rng() < 0.6) placeStamp(furniture, w, PLANT_CORNER, w - 3, h - 5);
}

/** Collect collision objects from all placed stamps. */
function buildCollisions(furniture: number[], w: number, h: number, deskPositions: { x: number; y: number }[]): CollisionObject[] {
  const objects: CollisionObject[] = [];
  const deskSet = new Set(deskPositions.map(p => `${p.x},${p.y}`));
  // Perimeter walls
  objects.push({ name: "top_wall", type: "", x: 0, y: 0, width: w * 16, height: 4 * 16 });
  objects.push({ name: "bot_wall", type: "", x: 0, y: (h - 2) * 16, width: w * 16, height: 2 * 16 });
  objects.push({ name: "left_wall", type: "", x: 0, y: 0, width: 16, height: h * 16 });
  objects.push({ name: "right_wall", type: "", x: (w - 1) * 16, y: 0, width: 16, height: h * 16 });
  // Furniture collisions
  for (let y = 4; y < h - 2; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (furniture[y * w + x] !== 0 && !deskSet.has(`${x},${y}`)) {
        objects.push({ name: "f", type: "", x: x * 16, y: y * 16, width: 16, height: 16 });
      }
    }
  }
  return objects;
}

// ── Template builders ──────────────────────────────────────────────────

/** Small office (20x15, 2-3 agents): workspace + break corner. */
export function buildSmallA(rng: Rng, agentCount: number): TemplateOutput {
  const w = 20, h = 15;
  const backdrop = makeLayer(w, h);
  const floor = makeLayer(w, h);
  const furniture = makeLayer(w, h);

  buildPerimeterWalls(backdrop, furniture, w, h, rng);
  buildFloor(floor, w, h, rng, [{ x1: 2, y1: 5, x2: 8, y2: 10 }]);
  const door = placeDoor(furniture, floor, w, h, Math.floor(w / 2));
  const { whiteboard } = decorateTopWall(furniture, w, rng);
  placePlants(furniture, w, h, rng);

  // Place workstations (left side, on carpet)
  const desks: { x: number; y: number }[] = [];
  const ws1 = rng() < 0.5 ? WORKSTATION_A : WORKSTATION_B;
  placeStamp(furniture, w, ws1, 3, 5);
  desks.push(...getStampDesks(ws1, 3, 5));

  if (agentCount >= 2) {
    const ws2 = rng() < 0.5 ? WORKSTATION_A : WORKSTATION_B;
    placeStamp(furniture, w, ws2, 7, 5);
    desks.push(...getStampDesks(ws2, 7, 5));
  }
  if (agentCount >= 3) {
    const ws3 = rng() < 0.5 ? WORKSTATION_A : WORKSTATION_B;
    placeStamp(furniture, w, ws3, 3, 10);
    desks.push(...getStampDesks(ws3, 3, 10));
  }

  // Utility area (right side)
  placeStamp(furniture, w, UTILITY_AREA, 14, 5);
  // Trash can
  set(furniture, w, 14, h - 4, TRASH.A);

  const collisions = buildCollisions(furniture, w, h, desks);

  return {
    width: w, height: h, tilewidth: 16, tileheight: 16,
    layers: [
      { name: "backdrop", type: "tilelayer", data: backdrop, width: w, height: h, visible: true, opacity: 1 },
      { name: "floor", type: "tilelayer", data: floor, width: w, height: h, visible: true, opacity: 1 },
      { name: "furniture", type: "tilelayer", data: furniture, width: w, height: h, visible: true, opacity: 1 },
      { name: "Collisions", type: "objectgroup", objects: collisions, visible: true, opacity: 1 },
    ],
    tilesets: [...TILESETS],
    deskPositions: desks,
    poi: { coffee: null, whiteboard, door },
  };
}

/** Medium office A (30x20, 4-5 agents): workstation pairs + meeting + break. */
export function buildMediumA(rng: Rng, agentCount: number): TemplateOutput {
  const w = 30, h = 20;
  const backdrop = makeLayer(w, h);
  const floor = makeLayer(w, h);
  const furniture = makeLayer(w, h);

  buildPerimeterWalls(backdrop, furniture, w, h, rng);
  // Carpet under workstations, tile in break area
  buildFloor(floor, w, h, rng, [
    { x1: 2, y1: 5, x2: 16, y2: 14 },  // workspace carpet
  ]);
  const door = placeDoor(furniture, floor, w, h, 15);
  const { whiteboard } = decorateTopWall(furniture, w, rng);
  placePlants(furniture, w, h, rng);

  // Internal wall separating workspace from meeting/break
  buildInternalWallV(furniture, w, 19, 4, h - 3);

  // Workstation pairs (left zone)
  const desks: { x: number; y: number }[] = [];
  placeStamp(furniture, w, WORKSTATION_PAIR, 3, 5);
  desks.push(...getStampDesks(WORKSTATION_PAIR, 3, 5));

  if (agentCount >= 5) {
    placeStamp(furniture, w, WORKSTATION_A, 12, 5);
    desks.push(...getStampDesks(WORKSTATION_A, 12, 5));
  }

  // Filing + printer along left wall
  placeStamp(furniture, w, UTILITY_AREA, 2, h - 5);

  // Meeting area (right zone top)
  placeStamp(furniture, w, MEETING_SMALL, 21, 4);

  // Break area (right zone bottom)
  placeStamp(furniture, w, BREAK_AREA, 21, 12);

  const collisions = buildCollisions(furniture, w, h, desks);

  return {
    width: w, height: h, tilewidth: 16, tileheight: 16,
    layers: [
      { name: "backdrop", type: "tilelayer", data: backdrop, width: w, height: h, visible: true, opacity: 1 },
      { name: "floor", type: "tilelayer", data: floor, width: w, height: h, visible: true, opacity: 1 },
      { name: "furniture", type: "tilelayer", data: furniture, width: w, height: h, visible: true, opacity: 1 },
      { name: "Collisions", type: "objectgroup", objects: collisions, visible: true, opacity: 1 },
    ],
    tilesets: [...TILESETS],
    deskPositions: desks,
    poi: { coffee: { x: 23, y: 14 }, whiteboard, door },
  };
}

/** Medium office B (30x20, 4-5 agents): open floor + manager + break. */
export function buildMediumB(rng: Rng, agentCount: number): TemplateOutput {
  const w = 30, h = 20;
  const backdrop = makeLayer(w, h);
  const floor = makeLayer(w, h);
  const furniture = makeLayer(w, h);

  buildPerimeterWalls(backdrop, furniture, w, h, rng);
  buildFloor(floor, w, h, rng, [
    { x1: 2, y1: 5, x2: 12, y2: 11 },  // manager carpet
  ]);
  const door = placeDoor(furniture, floor, w, h, Math.floor(w / 3));
  const { whiteboard } = decorateTopWall(furniture, w, rng);
  placePlants(furniture, w, h, rng);

  // Internal wall: horizontal, separating top (manager) from bottom (open floor)
  buildInternalWallH(furniture, w, 12, 1, 13);

  const desks: { x: number; y: number }[] = [];

  // Manager zone (top-left, on carpet)
  const mgr = rng() < 0.5 ? WORKSTATION_A : WORKSTATION_B;
  placeStamp(furniture, w, mgr, 5, 6);
  desks.push(...getStampDesks(mgr, 5, 6));

  // Open floor (bottom half): 3 workstations in a row
  for (let i = 0; i < Math.min(agentCount - 1, 4); i++) {
    const ws = rng() < 0.5 ? WORKSTATION_A : WORKSTATION_B;
    const wx = 3 + i * 5;
    if (wx + 3 < w - 2) {
      placeStamp(furniture, w, ws, wx, 14);
      desks.push(...getStampDesks(ws, wx, 14));
    }
  }

  // Break area (right side)
  placeStamp(furniture, w, BREAK_AREA, 21, 5);
  // Utility
  placeStamp(furniture, w, UTILITY_AREA, 21, 13);

  const collisions = buildCollisions(furniture, w, h, desks);

  return {
    width: w, height: h, tilewidth: 16, tileheight: 16,
    layers: [
      { name: "backdrop", type: "tilelayer", data: backdrop, width: w, height: h, visible: true, opacity: 1 },
      { name: "floor", type: "tilelayer", data: floor, width: w, height: h, visible: true, opacity: 1 },
      { name: "furniture", type: "tilelayer", data: furniture, width: w, height: h, visible: true, opacity: 1 },
      { name: "Collisions", type: "objectgroup", objects: collisions, visible: true, opacity: 1 },
    ],
    tilesets: [...TILESETS],
    deskPositions: desks,
    poi: { coffee: { x: 23, y: 7 }, whiteboard, door },
  };
}

/** Large office A (40x26, 6-8 agents): 2 workstation rows + meeting + break + manager. */
export function buildLargeA(rng: Rng, agentCount: number): TemplateOutput {
  const w = 40, h = 26;
  const backdrop = makeLayer(w, h);
  const floor = makeLayer(w, h);
  const furniture = makeLayer(w, h);

  buildPerimeterWalls(backdrop, furniture, w, h, rng);
  buildFloor(floor, w, h, rng, [
    { x1: 2, y1: 5, x2: 24, y2: 20 },  // main workspace carpet
    { x1: 27, y1: 5, x2: 37, y2: 12 },  // meeting carpet
  ]);
  const door = placeDoor(furniture, floor, w, h, 20);
  const { whiteboard } = decorateTopWall(furniture, w, rng);
  placePlants(furniture, w, h, rng);

  // Internal walls
  buildInternalWallV(furniture, w, 26, 4, h - 3);  // workspace | meeting+break
  buildInternalWallH(furniture, w, 13, 27, w - 2);  // meeting | break

  const desks: { x: number; y: number }[] = [];

  // Workstation pair row 1
  placeStamp(furniture, w, WORKSTATION_PAIR, 3, 5);
  desks.push(...getStampDesks(WORKSTATION_PAIR, 3, 5));

  // Workstation pair row 2
  placeStamp(furniture, w, WORKSTATION_PAIR, 13, 5);
  desks.push(...getStampDesks(WORKSTATION_PAIR, 13, 5));

  // Extra solo workstations if needed
  let placed = desks.length;
  if (placed < agentCount) {
    placeStamp(furniture, w, WORKSTATION_A, 3, 15);
    desks.push(...getStampDesks(WORKSTATION_A, 3, 15));
    placed++;
  }
  if (placed < agentCount) {
    placeStamp(furniture, w, WORKSTATION_B, 7, 15);
    desks.push(...getStampDesks(WORKSTATION_B, 7, 15));
  }

  // Utility along bottom-left
  placeStamp(furniture, w, UTILITY_AREA, 15, h - 6);

  // Meeting room (right-top)
  placeStamp(furniture, w, MEETING_SMALL, 28, 5);

  // Break area (right-bottom)
  placeStamp(furniture, w, BREAK_AREA, 28, 15);

  const collisions = buildCollisions(furniture, w, h, desks);

  return {
    width: w, height: h, tilewidth: 16, tileheight: 16,
    layers: [
      { name: "backdrop", type: "tilelayer", data: backdrop, width: w, height: h, visible: true, opacity: 1 },
      { name: "floor", type: "tilelayer", data: floor, width: w, height: h, visible: true, opacity: 1 },
      { name: "furniture", type: "tilelayer", data: furniture, width: w, height: h, visible: true, opacity: 1 },
      { name: "Collisions", type: "objectgroup", objects: collisions, visible: true, opacity: 1 },
    ],
    tilesets: [...TILESETS],
    deskPositions: desks,
    poi: { coffee: { x: 30, y: 17 }, whiteboard, door },
  };
}

/** Large office B (40x26, 6-8 agents): L-shape + cubicles + meeting + reception. */
export function buildLargeB(rng: Rng, agentCount: number): TemplateOutput {
  const w = 40, h = 26;
  const backdrop = makeLayer(w, h);
  const floor = makeLayer(w, h);
  const furniture = makeLayer(w, h);

  buildPerimeterWalls(backdrop, furniture, w, h, rng);
  buildFloor(floor, w, h, rng, [
    { x1: 2, y1: 5, x2: 18, y2: 14 },
    { x1: 22, y1: 5, x2: 37, y2: 14 },
  ]);
  const door = placeDoor(furniture, floor, w, h, 10);
  const { whiteboard } = decorateTopWall(furniture, w, rng);
  placePlants(furniture, w, h, rng);

  // Internal walls: create 3 zones
  buildInternalWallV(furniture, w, 20, 4, 15);   // left | right
  buildInternalWallH(furniture, w, 15, 1, 19);   // top-left | bottom-left

  const desks: { x: number; y: number }[] = [];

  // Zone 1: Top-left — cubicle workstations
  placeStamp(furniture, w, WORKSTATION_PAIR, 3, 5);
  desks.push(...getStampDesks(WORKSTATION_PAIR, 3, 5));

  if (desks.length < agentCount) {
    placeStamp(furniture, w, WORKSTATION_A, 13, 5);
    desks.push(...getStampDesks(WORKSTATION_A, 13, 5));
  }
  if (desks.length < agentCount) {
    placeStamp(furniture, w, WORKSTATION_B, 13, 10);
    desks.push(...getStampDesks(WORKSTATION_B, 13, 10));
  }

  // Zone 2: Top-right — meeting + utility
  placeStamp(furniture, w, MEETING_SMALL, 22, 4);
  placeStamp(furniture, w, UTILITY_AREA, 30, 5);

  // Zone 3: Bottom-left — break + additional workstations
  placeStamp(furniture, w, BREAK_AREA, 2, 17);

  if (desks.length < agentCount) {
    placeStamp(furniture, w, WORKSTATION_A, 10, 17);
    desks.push(...getStampDesks(WORKSTATION_A, 10, 17));
  }
  if (desks.length < agentCount) {
    placeStamp(furniture, w, WORKSTATION_B, 14, 17);
    desks.push(...getStampDesks(WORKSTATION_B, 14, 17));
  }

  // Zone 4: Bottom-right — more workstations
  if (desks.length < agentCount) {
    placeStamp(furniture, w, WORKSTATION_A, 22, 17);
    desks.push(...getStampDesks(WORKSTATION_A, 22, 17));
  }

  const collisions = buildCollisions(furniture, w, h, desks);

  return {
    width: w, height: h, tilewidth: 16, tileheight: 16,
    layers: [
      { name: "backdrop", type: "tilelayer", data: backdrop, width: w, height: h, visible: true, opacity: 1 },
      { name: "floor", type: "tilelayer", data: floor, width: w, height: h, visible: true, opacity: 1 },
      { name: "furniture", type: "tilelayer", data: furniture, width: w, height: h, visible: true, opacity: 1 },
      { name: "Collisions", type: "objectgroup", objects: collisions, visible: true, opacity: 1 },
    ],
    tilesets: [...TILESETS],
    deskPositions: desks,
    poi: { coffee: { x: 4, y: 19 }, whiteboard, door },
  };
}

/** All template builders indexed by name. */
export const TEMPLATES: Record<string, (rng: Rng, agentCount: number) => TemplateOutput> = {
  "small-a": buildSmallA,
  "medium-a": buildMediumA,
  "medium-b": buildMediumB,
  "large-a": buildLargeA,
  "large-b": buildLargeB,
};
