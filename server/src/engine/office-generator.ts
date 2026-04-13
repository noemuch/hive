// server/src/engine/office-generator.ts

/**
 * Procedural office generator — LimeZu 16x16 tilesets.
 * Each company gets a unique, deterministic layout based on its ID.
 */

import {
  VOID, FLOOR, FLOOR_TILES, WALL, CHAIR, DESK, TABLE, CUBICLE,
  PRINTER, CLUTTER, DECO_TALL, WALL_ART, TILESETS,
} from "./office-tiles";
import { hashString, createRng, pick, shuffle, randInt } from "./seeded-random";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OfficeSize = "small" | "medium" | "large";

interface OfficePoi {
  coffee: { x: number; y: number } | null;
  whiteboard: { x: number; y: number };
  door: { x: number; y: number };
}

interface CollisionObject {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeneratedOffice {
  width: number;
  height: number;
  tilewidth: 16;
  tileheight: 16;
  layers: {
    name: string;
    type: "tilelayer" | "objectgroup";
    data?: number[];
    objects?: CollisionObject[];
    width?: number;
    height?: number;
    visible: boolean;
    opacity: number;
  }[];
  tilesets: typeof TILESETS;
  deskPositions: { x: number; y: number }[];
  poi: OfficePoi;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIMS: Record<OfficeSize, { w: number; h: number }> = {
  small:  { w: 20, h: 15 },
  medium: { w: 30, h: 18 },
  large:  { w: 40, h: 23 },
};

function getSize(agentCount: number): OfficeSize {
  if (agentCount <= 3) return "small";
  if (agentCount <= 6) return "medium";
  return "large";
}

function makeLayer(_name: string, w: number, h: number): number[] {
  return new Array(w * h).fill(0);
}

function set(layer: number[], w: number, x: number, y: number, gid: number): void {
  if (x >= 0 && x < w && y >= 0) layer[y * w + x] = gid;
}

function get(layer: number[], w: number, x: number, y: number): number {
  return layer[y * w + x] ?? 0;
}

// ---------------------------------------------------------------------------
// Wall builder
// ---------------------------------------------------------------------------

function buildWalls(
  backdrop: number[],
  furniture: number[],
  w: number,
  h: number,
  rng: () => number,
): void {
  // Pick wallpaper style
  const wallFills = rng() < 0.5
    ? [WALL.FILL_A, WALL.FILL_B]
    : [WALL.FILL_C, WALL.FILL_D];

  // Fill entire backdrop with void
  for (let i = 0; i < w * h; i++) backdrop[i] = VOID;

  // --- Top wall (4 rows: frame, wallpaper x2, baseboard) ---
  // Row 0: top frame
  set(furniture, w, 0, 0, WALL.T1_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 0, pick(rng, wallFills));
  set(furniture, w, w - 1, 0, WALL.T1_R);

  // Row 1: middle frame + wallpaper
  set(furniture, w, 0, 1, WALL.T2_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 1, pick(rng, wallFills));
  set(furniture, w, w - 1, 1, WALL.T2_R);

  // Row 2: lower frame + wallpaper
  set(furniture, w, 0, 2, WALL.T3_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 2, pick(rng, wallFills));
  set(furniture, w, w - 1, 2, WALL.T3_R);

  // Row 3: baseboard
  set(furniture, w, 0, 3, WALL.BASE_L);
  for (let x = 1; x < w - 1; x++) set(furniture, w, x, 3, WALL.BASE_C);
  set(furniture, w, w - 1, 3, WALL.BASE_R);

  // --- Side walls (rows 4 to h-3) ---
  for (let y = 4; y < h - 2; y++) {
    set(furniture, w, 0, y, WALL.DARK_C);
    set(furniture, w, w - 1, y, WALL.DARK_C);
  }

  // --- Bottom wall (2 rows) ---
  for (let x = 0; x < w; x++) {
    set(furniture, w, x, h - 2, WALL.TRIM_C);
    set(furniture, w, x, h - 1, WALL.BOT_A);
  }
  // Corners
  set(furniture, w, 0, h - 2, WALL.TRIM_L);
  set(furniture, w, w - 1, h - 2, WALL.TRIM_R);
  set(furniture, w, 0, h - 1, WALL.DARK_L);
  set(furniture, w, w - 1, h - 1, WALL.DARK_R);
}

// ---------------------------------------------------------------------------
// Floor builder
// ---------------------------------------------------------------------------

function buildFloor(
  floor: number[],
  w: number,
  h: number,
  rng: () => number,
): void {
  // Pick primary and accent floor tiles (seeded, varies per company)
  const primaryIdx = Math.floor(rng() * FLOOR_TILES.length);
  const accentIdx = (primaryIdx + 1 + Math.floor(rng() * (FLOOR_TILES.length - 1))) % FLOOR_TILES.length;
  const primary = FLOOR_TILES[primaryIdx];
  const accent = FLOOR_TILES[accentIdx];

  // Pre-generate a row of random offsets so each company gets a unique stripe pattern
  const offsets: number[] = [];
  for (let x = 0; x < w; x++) offsets.push(rng() < 0.5 ? 0 : 1);

  for (let y = 4; y < h - 2; y++) {
    for (let x = 1; x < w - 1; x++) {
      const tile = (x + y + offsets[x]) % 2 === 0 ? primary : accent;
      set(floor, w, x, y, tile);
    }
  }
}

// ---------------------------------------------------------------------------
// Door builder
// ---------------------------------------------------------------------------

function buildDoor(
  furniture: number[],
  floor: number[],
  w: number,
  h: number,
  rng: () => number,
): { x: number; y: number } {
  // Door position options: bottom-center, bottom-left-third, bottom-right-third
  const options = [
    Math.floor(w / 2),
    Math.floor(w / 3),
    Math.floor((2 * w) / 3),
  ];
  const doorX = pick(rng, options);

  // Clear wall tiles at door position (3 tiles wide, 2 rows)
  for (let dx = -1; dx <= 1; dx++) {
    set(furniture, w, doorX + dx, h - 2, 0);
    set(furniture, w, doorX + dx, h - 1, 0);
    // Add floor where door is
    set(floor, w, doorX + dx, h - 2, FLOOR.EDGE);
    set(floor, w, doorX + dx, h - 1, FLOOR.EDGE);
  }

  return { x: doorX, y: h - 2 };
}

// ---------------------------------------------------------------------------
// Desk placement
// ---------------------------------------------------------------------------

interface DeskPlacement {
  x: number;       // left tile of desk (3-wide)
  y: number;       // top tile of desk (2-deep)
  chairY: number;  // y of chair (below desk)
}

function placeDeskRows(
  furniture: number[],
  w: number,
  h: number,
  agentCount: number,
  rng: () => number,
): { x: number; y: number }[] {
  const size = getSize(agentCount);
  const deskPositions: { x: number; y: number }[] = [];
  const desksNeeded = Math.min(agentCount, 8);

  // Desk style (randomized per company)
  const deskStyle = rng() < 0.5
    ? { tl: DESK.S1_TL, tc: DESK.S1_TC, tr: DESK.S1_TR, bl: DESK.S1_BL, bc: DESK.S1_BC, br: DESK.S1_BR }
    : { tl: DESK.S2_TL, tc: DESK.S2_TC, tr: DESK.S2_TR, bl: DESK.S2_BL, bc: DESK.S2_BC, br: DESK.S2_BR };

  // Chair variant
  const chairT = rng() < 0.5 ? CHAIR.FRONT_T1 : CHAIR.FRONT_T2;
  const chairB = rng() < 0.5 ? CHAIR.FRONT_B1 : CHAIR.FRONT_B2;

  // Calculate desk positions based on office size
  const placements: DeskPlacement[] = [];

  // Floor area: y from 4 to h-3 (desks start at first floor row, stop 3 rows before bottom wall)
  const floorTop = 4;
  const floorBot = h - 3;
  const floorLeft = 2;

  // Desk row spacing (desk=2 + chair=2 = 4 tiles per row, 1 tile gap between rows)
  const rowSpacing = 4;

  // Chair bottom is at dy+3; must stay above the bottom wall row (h-2)
  const fitsInFloor = (dy: number) => dy + 3 < h - 2;

  if (size === "small") {
    // Single column of desks, left-aligned
    const colX = floorLeft + randInt(rng, 0, 2);
    for (let i = 0; i < desksNeeded && i < 3; i++) {
      const dy = floorTop + i * rowSpacing;
      if (!fitsInFloor(dy)) break;
      placements.push({ x: colX, y: dy, chairY: dy + 2 });
    }
  } else if (size === "medium") {
    // Two columns
    const col1X = floorLeft + randInt(rng, 0, 1);
    const col2X = col1X + randInt(rng, 8, 10);
    let placed = 0;
    for (let i = 0; i < 3 && placed < desksNeeded; i++) {
      const dy = floorTop + i * rowSpacing;
      if (!fitsInFloor(dy)) break;
      placements.push({ x: col1X, y: dy, chairY: dy + 2 });
      placed++;
    }
    for (let i = 0; i < 3 && placed < desksNeeded; i++) {
      const dy = floorTop + i * rowSpacing;
      if (!fitsInFloor(dy)) break;
      placements.push({ x: col2X, y: dy, chairY: dy + 2 });
      placed++;
    }
  } else {
    // Large: two staggered columns + potential third
    const col1X = floorLeft + randInt(rng, 0, 2);
    const col2X = col1X + randInt(rng, 8, 10);
    const col3X = col2X + randInt(rng, 8, 10);
    let placed = 0;
    for (const col of [col1X, col2X, col3X]) {
      if (col + 3 >= w - 2) break; // don't overflow right wall
      for (let i = 0; i < 3 && placed < desksNeeded; i++) {
        const dy = floorTop + i * rowSpacing;
        if (!fitsInFloor(dy)) break;
        placements.push({ x: col, y: dy, chairY: dy + 2 });
        placed++;
      }
    }
  }

  // Place desk tiles
  for (const p of placements) {
    // Desk (3 wide, 2 deep)
    set(furniture, w, p.x, p.y, deskStyle.tl);
    set(furniture, w, p.x + 1, p.y, deskStyle.tc);
    set(furniture, w, p.x + 2, p.y, deskStyle.tr);
    set(furniture, w, p.x, p.y + 1, deskStyle.bl);
    set(furniture, w, p.x + 1, p.y + 1, deskStyle.bc);
    set(furniture, w, p.x + 2, p.y + 1, deskStyle.br);

    // Chair (1 wide, 2 deep, centered under desk)
    set(furniture, w, p.x + 1, p.chairY, chairT);
    set(furniture, w, p.x + 1, p.chairY + 1, chairB);

    // Desk clutter (random single item on desk)
    if (rng() < 0.7) {
      const clutterX = p.x + randInt(rng, 0, 2);
      set(furniture, w, clutterX, p.y, pick(rng, [...CLUTTER]));
    }

    // Chair position is the seat — where agents sit
    deskPositions.push({ x: p.x + 1, y: p.chairY });
  }

  return deskPositions;
}

// ---------------------------------------------------------------------------
// Meeting area (medium + large only)
// ---------------------------------------------------------------------------

function placeMeetingArea(
  furniture: number[],
  w: number,
  h: number,
  size: OfficeSize,
  rng: () => number,
): { x: number; y: number } | null {
  if (size === "small") return null;

  // Meeting area in right portion of the office
  const areaX = w - randInt(rng, 7, 9);
  const areaY = randInt(rng, 6, 8);

  // Table (3 wide, 2 deep)
  const tableStyle = rng() < 0.5
    ? { tl: TABLE.M_TL, tc: TABLE.M_TC, tr: TABLE.M_TR, bl: TABLE.M_BL, bc: TABLE.M_BC, br: TABLE.M_BR }
    : { tl: TABLE.B_TL, tc: TABLE.B_TC, tr: TABLE.B_TR, bl: TABLE.B_BL, bc: TABLE.B_BC, br: TABLE.B_BR };

  set(furniture, w, areaX, areaY, tableStyle.tl);
  set(furniture, w, areaX + 1, areaY, tableStyle.tc);
  set(furniture, w, areaX + 2, areaY, tableStyle.tr);
  set(furniture, w, areaX, areaY + 1, tableStyle.bl);
  set(furniture, w, areaX + 1, areaY + 1, tableStyle.bc);
  set(furniture, w, areaX + 2, areaY + 1, tableStyle.br);

  // Chairs around table
  // Back chairs (above table)
  set(furniture, w, areaX, areaY - 2, CHAIR.BACK_T1);
  set(furniture, w, areaX, areaY - 1, CHAIR.BACK_B1);
  set(furniture, w, areaX + 2, areaY - 2, CHAIR.BACK_T2);
  set(furniture, w, areaX + 2, areaY - 1, CHAIR.BACK_B2);

  // Front chairs (below table)
  set(furniture, w, areaX, areaY + 2, CHAIR.FRONT_T1);
  set(furniture, w, areaX, areaY + 3, CHAIR.FRONT_B1);
  set(furniture, w, areaX + 2, areaY + 2, CHAIR.FRONT_T2);
  set(furniture, w, areaX + 2, areaY + 3, CHAIR.FRONT_B2);

  return { x: areaX + 1, y: areaY };
}

// ---------------------------------------------------------------------------
// Decorations
// ---------------------------------------------------------------------------

function placeDecorations(
  furniture: number[],
  w: number,
  h: number,
  rng: () => number,
): { whiteboard: { x: number; y: number } } {
  // Whiteboard on top wall (row 1-2)
  const wbX = randInt(rng, 4, w - 6);
  const art = rng() < 0.5 ? WALL_ART.A : WALL_ART.B;
  set(furniture, w, wbX, 1, art.tl);
  set(furniture, w, wbX + 1, 1, art.tr);
  set(furniture, w, wbX, 2, art.bl);
  set(furniture, w, wbX + 1, 2, art.br);

  // Tall decorations in corners
  if (rng() < 0.8) {
    const decoGids = shuffle(rng, [...DECO_TALL]);
    // Left corner deco (4 tiles vertical)
    const lx = 1;
    for (let i = 0; i < 4 && i < decoGids.length; i++) {
      set(furniture, w, lx, i, decoGids[i]);
    }
  }

  // Printer somewhere along a wall
  if (w > 20 && rng() < 0.7) {
    const px = randInt(rng, 3, w - 5);
    const py = h - 4;
    set(furniture, w, px, py, PRINTER.TL);
    set(furniture, w, px + 1, py, PRINTER.TR);
    set(furniture, w, px, py + 1, PRINTER.BL);
    set(furniture, w, px + 1, py + 1, PRINTER.BR);
  }

  return { whiteboard: { x: wbX, y: 2 } };
}

// ---------------------------------------------------------------------------
// Collision builder
// ---------------------------------------------------------------------------

function buildCollisions(
  furniture: number[],
  w: number,
  h: number,
  deskPositions: { x: number; y: number }[],
): CollisionObject[] {
  const objects: CollisionObject[] = [];
  const deskSet = new Set(deskPositions.map(p => `${p.x},${p.y}`));

  // Top wall
  objects.push({ name: "top_wall", type: "", x: 0, y: 0, width: w * 16, height: 4 * 16 });
  // Bottom wall
  objects.push({ name: "bot_wall", type: "", x: 0, y: (h - 2) * 16, width: w * 16, height: 2 * 16 });
  // Left wall
  objects.push({ name: "left_wall", type: "", x: 0, y: 0, width: 1 * 16, height: h * 16 });
  // Right wall
  objects.push({ name: "right_wall", type: "", x: (w - 1) * 16, y: 0, width: 1 * 16, height: h * 16 });

  // Furniture collisions — any non-zero furniture tile that's not a desk chair position
  for (let y = 4; y < h - 2; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (get(furniture, w, x, y) !== 0 && !deskSet.has(`${x},${y}`)) {
        objects.push({
          name: "furniture",
          type: "",
          x: x * 16,
          y: y * 16,
          width: 16,
          height: 16,
        });
      }
    }
  }

  return objects;
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/** Generate a unique, deterministic office map for a company. */
export function generateOffice(agentCount: number, companyId?: string): GeneratedOffice {
  const seed = companyId ? hashString(companyId) : 42;
  const rng = createRng(seed);
  const size = getSize(agentCount);
  const { w, h } = DIMS[size];

  // Create layers
  const backdrop = makeLayer("backdrop", w, h);
  const floor = makeLayer("floor", w, h);
  const furniture = makeLayer("furniture", w, h);

  // Build walls (writes to backdrop + furniture)
  buildWalls(backdrop, furniture, w, h, rng);

  // Build floor
  buildFloor(floor, w, h, rng);

  // Place door
  const door = buildDoor(furniture, floor, w, h, rng);

  // Place desks
  const deskPositions = placeDeskRows(furniture, w, h, agentCount, rng);

  // Place meeting area (medium + large)
  const coffeePos = placeMeetingArea(furniture, w, h, size, rng);

  // Place decorations (whiteboard, plants, printer)
  const { whiteboard } = placeDecorations(furniture, w, h, rng);

  // Build collision objectgroup
  const collisionObjects = buildCollisions(furniture, w, h, deskPositions);

  return {
    width: w,
    height: h,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      { name: "backdrop", type: "tilelayer", data: backdrop, width: w, height: h, visible: true, opacity: 1 },
      { name: "floor", type: "tilelayer", data: floor, width: w, height: h, visible: true, opacity: 1 },
      { name: "furniture", type: "tilelayer", data: furniture, width: w, height: h, visible: true, opacity: 1 },
      { name: "Collisions", type: "objectgroup", objects: collisionObjects, visible: true, opacity: 1 },
    ],
    tilesets: [...TILESETS],
    deskPositions,
    poi: {
      coffee: coffeePos,
      whiteboard,
      door,
    },
  };
}

// Suppress unused import warnings — these are re-exported from office-tiles
// and used indirectly via the catalog. FLOOR_TILES and CUBICLE are available
// for future use.
void FLOOR_TILES;
void CUBICLE;
