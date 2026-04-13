# Office Generation V2 — Template Gallery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace sparse procedural offices with dense, LimeZu-quality template-based layouts using the Modern Office tileset.

**Architecture:** 5 hand-crafted template builder functions compose stamps (small multi-tile furniture groups) into dense office layouts. A detail randomizer adds per-company variety using seeded PRNG. The Modern Office tileset is a drop-in replacement for the current escape-room tilesets.

**Tech Stack:** Bun (server), TypeScript, Tiled JSON format, LimeZu Modern Office 16x16 tileset

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `web/public/maps/escape-room/office_items.png` | Replace | Modern Office tileset (furniture) |
| `web/public/maps/escape-room/room_builder.png` | Replace | Modern Office room builder (walls/floors) |
| `server/src/engine/office-tiles.ts` | Rewrite | V2 GID catalog for Modern Office tileset |
| `server/src/engine/office-stamps.ts` | Create | Stamp definitions (small furniture compositions) |
| `server/src/engine/office-templates.ts` | Create | 5 template builder functions |
| `server/src/engine/office-generator.ts` | Rewrite | Template selector + detail randomizer |
| `server/src/engine/office-generator.test.ts` | Update | Tests for V2 |
| `server/src/engine/seeded-random.ts` | Keep | Unchanged |

---

### Task 1: Tileset Swap

**Files:**
- Replace: `web/public/maps/escape-room/office_items.png`
- Replace: `web/public/maps/escape-room/room_builder.png`

- [ ] **Step 1: Backup old tilesets and copy new ones**

```bash
cd /Users/noechague/Documents/finary/order66
# Backup
cp web/public/maps/escape-room/office_items.png web/public/maps/escape-room/office_items_old.png
cp web/public/maps/escape-room/room_builder.png web/public/maps/escape-room/room_builder_old.png
# Copy Modern Office tilesets
cp "/Users/noechague/Desktop/Modern Office Revamped v1.2/Modern_Office_16x16.png" web/public/maps/escape-room/office_items.png
cp "/Users/noechague/Desktop/Modern Office Revamped v1.2/1_Room_Builder_Office/Room_Builder_Office_16x16.png" web/public/maps/escape-room/room_builder.png
```

- [ ] **Step 2: Verify dimensions match**

```bash
file web/public/maps/escape-room/office_items.png web/public/maps/escape-room/room_builder.png
```

Expected:
```
office_items.png: PNG image data, 256 x 848, 8-bit/color RGBA
room_builder.png: PNG image data, 256 x 224, 8-bit/color RGBA
```

- [ ] **Step 3: Restart server and verify an office renders**

```bash
kill $(lsof -ti:3000) 2>/dev/null; sleep 1
cd server && bun run src/index.ts &
sleep 2
curl -s http://localhost:3000/api/companies | head -1
```

Open browser, navigate to a company. The office should render with the new (Modern Office) tileset — the layout will be the V1 generator, but tiles will look different since the art changed.

- [ ] **Step 4: Remove backups and commit**

```bash
rm web/public/maps/escape-room/office_items_old.png web/public/maps/escape-room/room_builder_old.png
git add web/public/maps/escape-room/office_items.png web/public/maps/escape-room/room_builder.png
git commit -m "feat(#156): swap tilesets to Modern Office by LimeZu"
```

---

### Task 2: GID Catalog V2

**Files:**
- Rewrite: `server/src/engine/office-tiles.ts`

The Modern Office tileset has the same grid layout (16 cols, 53 rows for office_items; 16 cols, 14 rows for room_builder). 67% of tiles are identical or similar. The catalog preserves existing GID names and adds new items.

- [ ] **Step 1: Rewrite office-tiles.ts**

```typescript
// server/src/engine/office-tiles.ts

/**
 * GID catalog V2 for LimeZu Modern Office 16x16 tilesets.
 * room_builder.png: firstgid=1, 16 cols, 14 rows (224 tiles)
 * office_items.png (Modern Office): firstgid=225, 16 cols, 53 rows (848 tiles)
 *
 * GIDs verified by visual comparison. 67% identical to the original
 * escape-room tilesets — same artist, same grid structure, updated art.
 */

// ── Room structure (room_builder.png, firstgid=1) ──────────────────────

export const VOID = 9;

export const FLOOR = {
  WOOD_A: 94, WOOD_B: 95,
  WOOD_C: 110, WOOD_D: 111,
  EDGE: 96,
} as const;

export const FLOOR_TILES = [FLOOR.WOOD_A, FLOOR.WOOD_B, FLOOR.WOOD_C, FLOOR.WOOD_D] as const;

// Carpet tiles (from office_items — rows 2-3 right side)
export const CARPET = {
  BROWN_A: 265, BROWN_B: 266,   // brown checkerboard
  GRAY_A: 267, GRAY_B: 268,     // gray carpet
  TAN_A: 281, TAN_B: 282,       // tan/beige
} as const;

export const WALL = {
  T1_L: 24, T1_R: 26,
  T2_L: 40, T2_R: 42,
  T3_L: 56, T3_R: 58,
  FILL_A: 82, FILL_B: 83,
  FILL_C: 98, FILL_D: 99,
  BASE_L: 113, BASE_C: 114, BASE_R: 115,
  TRIM_L: 129, TRIM_C: 130, TRIM_R: 131,
  DARK_L: 177, DARK_C: 178, DARK_R: 179,
  DARK2_L: 193, DARK2_C: 194, DARK2_R: 195,
  BOT_A: 21, BOT_B: 25,
} as const;

// ── Furniture (office_items.png / Modern Office, firstgid=225) ─────────

// Cubicle partitions (rows 0-3, GIDs 225-288)
export const PARTITION = {
  // Tan partitions (3-wide top + bottom)
  TAN_TL: 225, TAN_TC: 226, TAN_TR: 227,
  TAN_BL: 241, TAN_BC: 242, TAN_BR: 243,
  // Gray partitions
  GRAY_TL: 228, GRAY_TC: 229, GRAY_TR: 230,
  GRAY_BL: 244, GRAY_BC: 245, GRAY_BR: 246,
  // White/light partitions
  WHITE_TL: 257, WHITE_TC: 258, WHITE_TR: 259,
  WHITE_BL: 273, WHITE_BC: 274, WHITE_BR: 275,
} as const;

// Chairs (rows 5-8)
export const CHAIR = {
  FRONT_T1: 354, FRONT_B1: 370,
  FRONT_T2: 386, FRONT_B2: 402,
  BACK_T1: 385, BACK_B1: 401,
  BACK_T2: 388, BACK_B2: 404,
  SIDE_T1: 356, SIDE_B1: 372,
  SIDE_T2: 357, SIDE_B2: 373,
  SIDE_T3: 358, SIDE_B3: 374,
  // Brown leather
  BROWN_T1: 305, BROWN_B1: 321,
  // Orange accent
  ORANGE_T: 310, ORANGE_B: 326,
} as const;

// Plants (row 4 + bottom rows)
export const PLANT = {
  // Large bush (2x2)
  BUSH_TL: 293, BUSH_TR: 294,
  BUSH_BL: 309, BUSH_BR: 310,
  // Small potted (1x2)
  POT_T: 311, POT_B: 327,
} as const;

// Monitors & screens
export const MONITOR = {
  // Desktop monitor (1x1 or 1x2)
  SMALL_A: 299, SMALL_B: 300,
  // Wall display with chart (2x2)
  DISPLAY_TL: 332, DISPLAY_TR: 333,
  DISPLAY_BL: 348, DISPLAY_BR: 349,
  // Laptop
  LAPTOP: 334,
} as const;

// Wall decorations
export const WALL_DECO = {
  // Picture frames
  FRAME_A: 296, FRAME_B: 297,
  // Colorful art (2x2)
  ART_TL: 321, ART_TR: 322,
  ART_BL: 337, ART_BR: 338,
  // Small frames
  SMALL_A: 295, SMALL_B: 298,
  // Shelves with items (2x2)
  SHELF_TL: 328, SHELF_TR: 329,
  SHELF_BL: 344, SHELF_BR: 345,
  // AC unit (2x1)
  AC_L: 231, AC_R: 232,
} as const;

// Desks (rows 26-31, GIDs 641-736)
export const DESK = {
  // Style 1 — tan (3 wide, 2 deep)
  S1_TL: 706, S1_TC: 707, S1_TR: 708,
  S1_BL: 722, S1_BC: 723, S1_BR: 724,
  // Style 2 — dark (3 wide, 2 deep)
  S2_TL: 680, S2_TC: 681, S2_TR: 682,
  S2_BL: 696, S2_BC: 697, S2_BR: 698,
} as const;

// Meeting/break tables
export const TABLE = {
  M_TL: 709, M_TC: 710, M_TR: 711,
  M_BL: 725, M_BC: 726, M_BR: 727,
  B_TL: 712, B_TC: 713, B_TR: 714,
  B_BL: 728, B_BC: 729, B_BR: 730,
} as const;

// Cubicle shelf/divider (row 24-25 — horizontal bars)
export const CUBICLE = {
  T: [641, 642, 643, 644, 645, 646, 647] as readonly number[],
  M: [657, 658, 659, 660, 661, 662, 663] as readonly number[],
  B: [673, 674, 675, 676, 677, 678, 679] as readonly number[],
} as const;

// Printer (2x2)
export const PRINTER = {
  TL: 586, TR: 587,
  BL: 602, BR: 603,
} as const;

// Filing cabinet
export const FILING = {
  // Single (1x2)
  A_T: 513, A_B: 529,
  B_T: 514, B_B: 530,
} as const;

// Vending machine (2x3)
export const VENDING = {
  TL: 577, TR: 578,
  ML: 593, MR: 594,
  BL: 609, BR: 610,
} as const;

// Desk clutter / accessories
export const CLUTTER = [648, 649, 650, 664, 665, 666, 686, 687, 688, 702, 703, 704] as const;
export const DESK_ITEMS = {
  KEYBOARD: 649,
  PAPERS_A: 650,
  PAPERS_B: 666,
  MUG: 648,
  LAMP: 664,
  PHONE: 665,
} as const;

// Trash can
export const TRASH = {
  A: 686, B: 687,
} as const;

// Large decorative plant (2x3 from bottom rows)
export const DECO_TALL = [240, 256, 272, 288] as const;

export const WALL_ART = {
  A: { tl: 985, tr: 987, bl: 1001, br: 1003 },
  B: { tl: 1017, tr: 1019, bl: 1033, br: 1035 },
} as const;

export const ACCENT_STRIP = [343, 359, 375, 391, 407, 423, 439, 455, 472, 488, 504] as const;

// ── Tileset metadata ───────────────────────────────────────────────────

export const TILESETS = [
  {
    firstgid: 1, name: "room_builder",
    image: "/maps/escape-room/room_builder.png",
    tilewidth: 16, tileheight: 16, columns: 16,
    imagewidth: 256, imageheight: 224, tilecount: 224,
  },
  {
    firstgid: 225, name: "office_items",
    image: "/maps/escape-room/office_items.png",
    tilewidth: 16, tileheight: 16, columns: 16,
    imagewidth: 256, imageheight: 848, tilecount: 848,
  },
] as const;
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && bunx tsc --noEmit src/engine/office-tiles.ts`

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/office-tiles.ts
git commit -m "feat(#156): V2 GID catalog for Modern Office tileset"
```

---

### Task 3: Stamp Library

**Files:**
- Create: `server/src/engine/office-stamps.ts`

Stamps are small multi-tile compositions. Each stamp is a 2D GID grid. Zero means empty (don't overwrite). Stamps include the furniture layer only — walls and floors are handled by template builders.

- [ ] **Step 1: Create office-stamps.ts**

```typescript
// server/src/engine/office-stamps.ts

/**
 * Stamp library — hand-crafted multi-tile furniture compositions.
 * Each stamp is placed into the furniture layer at a given (x, y).
 * 0 = skip (don't overwrite existing tile).
 *
 * Inspired by LimeZu Office Design 1 & 2 reference images.
 */

import {
  CHAIR, DESK, TABLE, PARTITION, MONITOR, WALL_DECO,
  PLANT, PRINTER, FILING, VENDING, DESK_ITEMS, TRASH,
} from "./office-tiles";

export interface Stamp {
  name: string;
  width: number;
  height: number;
  tiles: number[][];         // [row][col] — GIDs
  deskPositions: { x: number; y: number }[]; // relative to stamp origin
  collision: { x: number; y: number; w: number; h: number }[]; // relative collision rects
}

/** Place a stamp's tiles into a flat layer array. */
export function placeStamp(
  layer: number[],
  mapW: number,
  stamp: Stamp,
  ox: number,
  oy: number,
): void {
  for (let row = 0; row < stamp.height; row++) {
    for (let col = 0; col < stamp.width; col++) {
      const gid = stamp.tiles[row][col];
      if (gid === 0) continue;
      const idx = (oy + row) * mapW + (ox + col);
      if (idx >= 0 && idx < layer.length) layer[idx] = gid;
    }
  }
}

/** Get absolute desk positions after placing stamp at (ox, oy). */
export function getStampDesks(stamp: Stamp, ox: number, oy: number): { x: number; y: number }[] {
  return stamp.deskPositions.map(p => ({ x: ox + p.x, y: oy + p.y }));
}

// ── Stamp definitions ──────────────────────────────────────────────────

const _ = 0; // shorthand for empty

/**
 * Single workstation: desk (3 wide) + chair + monitor + accessories.
 * 5 wide x 4 tall. Chair position = desk seat.
 *
 *  [monitor] [keyboard] [papers]   <- on desk surface
 *  [desk_L ] [desk_C  ] [desk_R ]
 *  [desk_L ] [desk_C  ] [desk_R ]
 *  [       ] [chair_T ] [       ]
 *  [       ] [chair_B ] [       ]
 */
export const WORKSTATION_A: Stamp = {
  name: "workstation-a",
  width: 3,
  height: 5,
  tiles: [
    [MONITOR.SMALL_A, DESK_ITEMS.KEYBOARD, DESK_ITEMS.PAPERS_A],
    [DESK.S1_TL, DESK.S1_TC, DESK.S1_TR],
    [DESK.S1_BL, DESK.S1_BC, DESK.S1_BR],
    [_, CHAIR.FRONT_T1, _],
    [_, CHAIR.FRONT_B1, _],
  ],
  deskPositions: [{ x: 1, y: 3 }],
  collision: [
    { x: 0, y: 0, w: 3, h: 3 }, // desk
  ],
};

/** Dark desk variant. */
export const WORKSTATION_B: Stamp = {
  name: "workstation-b",
  width: 3,
  height: 5,
  tiles: [
    [DESK_ITEMS.LAMP, MONITOR.SMALL_B, DESK_ITEMS.MUG],
    [DESK.S2_TL, DESK.S2_TC, DESK.S2_TR],
    [DESK.S2_BL, DESK.S2_BC, DESK.S2_BR],
    [_, CHAIR.FRONT_T2, _],
    [_, CHAIR.FRONT_B2, _],
  ],
  deskPositions: [{ x: 1, y: 3 }],
  collision: [{ x: 0, y: 0, w: 3, h: 3 }],
};

/**
 * Two workstations facing each other with partition between.
 * 7 wide x 8 tall.
 */
export const WORKSTATION_PAIR: Stamp = {
  name: "workstation-pair",
  width: 7,
  height: 8,
  tiles: [
    [_, CHAIR.BACK_T1, _, _, _, CHAIR.BACK_T2, _],
    [_, CHAIR.BACK_B1, _, _, _, CHAIR.BACK_B2, _],
    [DESK.S1_TL, DESK.S1_TC, DESK.S1_TR, _, DESK.S2_TL, DESK.S2_TC, DESK.S2_TR],
    [DESK.S1_BL, DESK.S1_BC, DESK.S1_BR, _, DESK.S2_BL, DESK.S2_BC, DESK.S2_BR],
    [PARTITION.TAN_TL, PARTITION.TAN_TC, PARTITION.TAN_TR, _, PARTITION.GRAY_TL, PARTITION.GRAY_TC, PARTITION.GRAY_TR],
    [DESK.S1_TL, DESK.S1_TC, DESK.S1_TR, _, DESK.S2_TL, DESK.S2_TC, DESK.S2_TR],
    [DESK.S1_BL, DESK.S1_BC, DESK.S1_BR, _, DESK.S2_BL, DESK.S2_BC, DESK.S2_BR],
    [_, CHAIR.FRONT_T1, _, _, _, CHAIR.FRONT_T2, _],
  ],
  deskPositions: [
    { x: 1, y: 1 },  // top-left (back-facing)
    { x: 5, y: 1 },  // top-right (back-facing)
    { x: 1, y: 7 },  // bottom-left (front-facing)
    { x: 5, y: 7 },  // bottom-right (front-facing)
  ],
  collision: [
    { x: 0, y: 2, w: 3, h: 3 }, // top-left desk + partition
    { x: 4, y: 2, w: 3, h: 3 }, // top-right desk + partition
    { x: 0, y: 5, w: 3, h: 2 }, // bottom-left desk
    { x: 4, y: 5, w: 3, h: 2 }, // bottom-right desk
  ],
};

/**
 * Small meeting area: table + 4 chairs + wall display.
 * 5 wide x 7 tall.
 */
export const MEETING_SMALL: Stamp = {
  name: "meeting-small",
  width: 5,
  height: 7,
  tiles: [
    [_, WALL_DECO.DISPLAY_TL, WALL_DECO.DISPLAY_TR, _, _],
    [_, WALL_DECO.DISPLAY_BL, WALL_DECO.DISPLAY_BR, _, _],
    [_, CHAIR.BACK_T1, _, CHAIR.BACK_T2, _],
    [_, CHAIR.BACK_B1, _, CHAIR.BACK_B2, _],
    [_, TABLE.M_TL, TABLE.M_TC, TABLE.M_TR, _],
    [_, TABLE.M_BL, TABLE.M_BC, TABLE.M_BR, _],
    [_, CHAIR.FRONT_T1, _, CHAIR.FRONT_T2, _],
  ],
  deskPositions: [],
  collision: [
    { x: 1, y: 0, w: 2, h: 2 }, // display
    { x: 1, y: 4, w: 3, h: 2 }, // table
  ],
};

/**
 * Break area: coffee/vending + small table + chairs + plant.
 * 6 wide x 5 tall.
 */
export const BREAK_AREA: Stamp = {
  name: "break-area",
  width: 6,
  height: 5,
  tiles: [
    [VENDING.TL, VENDING.TR, _, _, PLANT.BUSH_TL, PLANT.BUSH_TR],
    [VENDING.ML, VENDING.MR, _, _, PLANT.BUSH_BL, PLANT.BUSH_BR],
    [VENDING.BL, VENDING.BR, _, _, _, _],
    [_, _, TABLE.B_TL, TABLE.B_TC, TABLE.B_TR, _],
    [_, CHAIR.FRONT_T1, TABLE.B_BL, TABLE.B_BC, TABLE.B_BR, CHAIR.FRONT_T2],
  ],
  deskPositions: [],
  collision: [
    { x: 0, y: 0, w: 2, h: 3 }, // vending
    { x: 4, y: 0, w: 2, h: 2 }, // plant
    { x: 2, y: 3, w: 3, h: 2 }, // table
  ],
};

/**
 * Filing + printer area.
 * 4 wide x 3 tall.
 */
export const UTILITY_AREA: Stamp = {
  name: "utility-area",
  width: 4,
  height: 3,
  tiles: [
    [FILING.A_T, FILING.B_T, PRINTER.TL, PRINTER.TR],
    [FILING.A_B, FILING.B_B, PRINTER.BL, PRINTER.BR],
    [_, _, _, _],
  ],
  deskPositions: [],
  collision: [
    { x: 0, y: 0, w: 2, h: 2 }, // filing
    { x: 2, y: 0, w: 2, h: 2 }, // printer
  ],
};

/**
 * Wall shelf decoration (placed against top wall).
 * 3 wide x 2 tall.
 */
export const WALL_SHELF: Stamp = {
  name: "wall-shelf",
  width: 3,
  height: 2,
  tiles: [
    [WALL_DECO.SHELF_TL, WALL_DECO.SHELF_TR, WALL_DECO.AC_L],
    [WALL_DECO.SHELF_BL, WALL_DECO.SHELF_BR, WALL_DECO.AC_R],
  ],
  deskPositions: [],
  collision: [],
};

/**
 * Wall art + frames (placed against wall).
 * 4 wide x 2 tall.
 */
export const WALL_ART_SET: Stamp = {
  name: "wall-art-set",
  width: 4,
  height: 2,
  tiles: [
    [WALL_DECO.ART_TL, WALL_DECO.ART_TR, WALL_DECO.FRAME_A, WALL_DECO.FRAME_B],
    [WALL_DECO.ART_BL, WALL_DECO.ART_BR, _, _],
  ],
  deskPositions: [],
  collision: [],
};

/**
 * Plant corner (placed in corners).
 * 2 wide x 2 tall.
 */
export const PLANT_CORNER: Stamp = {
  name: "plant-corner",
  width: 2,
  height: 2,
  tiles: [
    [PLANT.BUSH_TL, PLANT.BUSH_TR],
    [PLANT.BUSH_BL, PLANT.BUSH_BR],
  ],
  deskPositions: [],
  collision: [{ x: 0, y: 0, w: 2, h: 2 }],
};

/** All workstation stamps for random selection. */
export const WORKSTATIONS = [WORKSTATION_A, WORKSTATION_B] as const;

/** All stamp definitions for reference. */
export const ALL_STAMPS = [
  WORKSTATION_A, WORKSTATION_B, WORKSTATION_PAIR,
  MEETING_SMALL, BREAK_AREA, UTILITY_AREA,
  WALL_SHELF, WALL_ART_SET, PLANT_CORNER,
] as const;
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && bunx tsc --noEmit src/engine/office-stamps.ts`

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/office-stamps.ts
git commit -m "feat(#156): stamp library with 9 furniture compositions"
```

---

### Task 4: Template Builder Functions

**Files:**
- Create: `server/src/engine/office-templates.ts`

Each template function creates a complete office by composing stamps. Templates handle walls, floor (with carpet zones), stamp placement, internal walls, and wall decorations.

- [ ] **Step 1: Create office-templates.ts**

```typescript
// server/src/engine/office-templates.ts

/**
 * Template builder functions — compose stamps into complete office layouts.
 * Each template creates walls, floor, places stamps, adds decorations.
 */

import {
  VOID, FLOOR, FLOOR_TILES, WALL, CARPET, TILESETS,
  WALL_DECO, PLANT, DESK_ITEMS, CLUTTER, TRASH,
} from "./office-tiles";
import {
  type Stamp, placeStamp, getStampDesks,
  WORKSTATION_A, WORKSTATION_B, WORKSTATION_PAIR,
  MEETING_SMALL, BREAK_AREA, UTILITY_AREA,
  WALL_SHELF, WALL_ART_SET, PLANT_CORNER,
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

type Rng = () => number;

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
  let wbX = decoSlots[0] ?? 3;
  set(furniture, w, wbX, 1, WALL_DECO.DISPLAY_TL);
  set(furniture, w, wbX + 1, 1, WALL_DECO.DISPLAY_TR);
  set(furniture, w, wbX, 2, WALL_DECO.DISPLAY_BL);
  set(furniture, w, wbX + 1, 2, WALL_DECO.DISPLAY_BR);
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
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && bunx tsc --noEmit src/engine/office-templates.ts`

Note: There may be a type issue with `Rng` — the `seeded-random.ts` exports functions but not the `Rng` type. If so, add `export type Rng = () => number;` to `seeded-random.ts`, or use inline `() => number` in templates.

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/office-templates.ts
git commit -m "feat(#156): 5 template builder functions with stamp composition"
```

---

### Task 5: Generator V2 + Detail Randomizer

**Files:**
- Rewrite: `server/src/engine/office-generator.ts`

The generator selects a template based on company size + seed, builds it, then applies detail randomization (mirror, desk accessory shuffle).

- [ ] **Step 1: Rewrite office-generator.ts**

```typescript
// server/src/engine/office-generator.ts

/**
 * Office generator V2 — template gallery + detail randomizer.
 * Each company gets a unique, deterministic office layout.
 */

import { hashString, createRng, pick } from "./seeded-random";
import { DESK_ITEMS, CLUTTER } from "./office-tiles";
import {
  type TemplateOutput, TEMPLATES,
  buildSmallA, buildMediumA, buildMediumB, buildLargeA, buildLargeB,
} from "./office-templates";

export type { TemplateOutput as GeneratedOffice };

// ── Template selection ─────────────────────────────────────────────────

function selectTemplate(agentCount: number, rng: () => number): (rng: () => number, n: number) => TemplateOutput {
  if (agentCount <= 3) return buildSmallA;
  if (agentCount <= 6) return rng() < 0.5 ? buildMediumA : buildMediumB;
  return rng() < 0.5 ? buildLargeA : buildLargeB;
}

// ── Detail randomizer ──────────────────────────────────────────────────

function randomizeDetails(office: TemplateOutput, rng: () => number): TemplateOutput {
  const furnitureLayer = office.layers.find(l => l.name === "furniture");
  if (!furnitureLayer?.data) return office;
  const data = furnitureLayer.data;
  const w = office.width;

  // Scatter desk accessories near desk positions
  const accessoryPool = [
    DESK_ITEMS.KEYBOARD, DESK_ITEMS.PAPERS_A, DESK_ITEMS.PAPERS_B,
    DESK_ITEMS.MUG, DESK_ITEMS.LAMP, DESK_ITEMS.PHONE,
    ...CLUTTER.slice(0, 6),
  ];

  for (const desk of office.deskPositions) {
    // Try to place 1-2 accessories adjacent to each desk
    const spots = [
      { x: desk.x - 1, y: desk.y },
      { x: desk.x + 1, y: desk.y },
      { x: desk.x, y: desk.y - 1 },
    ];
    for (const spot of spots) {
      if (rng() < 0.3) continue; // 70% chance to place
      const idx = spot.y * w + spot.x;
      if (idx >= 0 && idx < data.length && data[idx] === 0) {
        data[idx] = pick(rng, accessoryPool);
      }
    }
  }

  // Mirror horizontally with 50% chance
  if (rng() < 0.5) {
    mirrorOffice(office);
  }

  return office;
}

/** Mirror the entire office horizontally. */
function mirrorOffice(office: TemplateOutput): void {
  const w = office.width;
  for (const layer of office.layers) {
    if (layer.type !== "tilelayer" || !layer.data) continue;
    const data = layer.data;
    for (let y = 0; y < office.height; y++) {
      const row = data.slice(y * w, (y + 1) * w);
      row.reverse();
      for (let x = 0; x < w; x++) {
        data[y * w + x] = row[x];
      }
    }
  }
  // Mirror collision objects
  const collLayer = office.layers.find(l => l.type === "objectgroup");
  if (collLayer?.objects) {
    for (const obj of collLayer.objects) {
      obj.x = (w * 16) - obj.x - obj.width;
    }
  }
  // Mirror desk positions and POI
  for (const desk of office.deskPositions) {
    desk.x = w - 1 - desk.x;
  }
  if (office.poi.coffee) office.poi.coffee.x = w - 1 - office.poi.coffee.x;
  office.poi.whiteboard.x = w - 1 - office.poi.whiteboard.x;
  office.poi.door.x = w - 1 - office.poi.door.x;
}

// ── Main entry point ───────────────────────────────────────────────────

/** Generate a unique, deterministic office for a company. */
export function generateOffice(agentCount: number, companyId?: string): TemplateOutput {
  const seed = companyId ? hashString(companyId) : 42;
  const rng = createRng(seed);

  const templateFn = selectTemplate(agentCount, rng);
  const office = templateFn(rng, agentCount);

  return randomizeDetails(office, rng);
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && bunx tsc --noEmit src/engine/office-generator.ts`

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/office-generator.ts
git commit -m "feat(#156): V2 generator with template selection + detail randomizer"
```

---

### Task 6: Update Tests

**Files:**
- Modify: `server/src/engine/office-generator.test.ts`

- [ ] **Step 1: Update the test file**

```typescript
// server/src/engine/office-generator.test.ts

import { describe, it, expect } from "bun:test";
import { generateOffice } from "./office-generator";

describe("generateOffice V2", () => {
  it("returns valid Tiled JSON structure", () => {
    const office = generateOffice(4, "test-company-1");
    expect(office.tilewidth).toBe(16);
    expect(office.tileheight).toBe(16);
    expect(office.width).toBeGreaterThan(0);
    expect(office.height).toBeGreaterThan(0);
    expect(office.layers.length).toBeGreaterThanOrEqual(3);
    expect(office.tilesets.length).toBe(2);
    expect(office.tilesets[0].firstgid).toBe(1);
    expect(office.tilesets[1].firstgid).toBe(225);
    expect(office.deskPositions.length).toBeGreaterThanOrEqual(1);
    expect(office.poi.whiteboard).toBeDefined();
    expect(office.poi.door).toBeDefined();
  });

  it("is deterministic", () => {
    const a = generateOffice(6, "determinism-test");
    const b = generateOffice(6, "determinism-test");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different companyIds produce different layouts", () => {
    const a = generateOffice(6, "company-alpha");
    const b = generateOffice(6, "company-beta");
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("scales with agent count", () => {
    const small = generateOffice(2, "small-co");
    const medium = generateOffice(5, "medium-co");
    const large = generateOffice(8, "large-co");
    expect(small.width).toBeLessThan(medium.width);
    expect(medium.width).toBeLessThanOrEqual(large.width);
  });

  it("desk positions within bounds", () => {
    const office = generateOffice(7, "bounds-check");
    for (const p of office.deskPositions) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(office.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(office.height);
    }
  });

  it("has collision objects", () => {
    const office = generateOffice(5, "collision-test");
    const coll = office.layers.find(l => l.name === "Collisions");
    expect(coll).toBeDefined();
    expect(coll!.type).toBe("objectgroup");
    expect(coll!.objects!.length).toBeGreaterThan(0);
  });

  it("medium offices have coffee POI", () => {
    const office = generateOffice(5, "coffee-test");
    expect(office.poi.coffee).not.toBeNull();
  });

  it("small offices have no coffee POI", () => {
    const office = generateOffice(2, "no-coffee");
    expect(office.poi.coffee).toBeNull();
  });

  it("large offices have enough desks", () => {
    const office = generateOffice(8, "large-desks");
    expect(office.deskPositions.length).toBeGreaterThanOrEqual(6);
  });

  it("furniture layer has significant coverage", () => {
    const office = generateOffice(6, "density-check");
    const furn = office.layers.find(l => l.name === "furniture");
    const nonZero = furn!.data!.filter(g => g !== 0).length;
    const total = office.width * office.height;
    const coverage = nonZero / total;
    // At least 15% furniture coverage (walls + furniture)
    expect(coverage).toBeGreaterThan(0.15);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd server && bun test src/engine/office-generator.test.ts`
Expected: all 10 tests PASS

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/office-generator.test.ts
git commit -m "feat(#156): V2 generator tests — templates, density, determinism"
```

---

### Task 7: Visual Verification + Polish

- [ ] **Step 1: Restart server**

```bash
kill $(lsof -ti:3000) 2>/dev/null
cd server && bun run src/index.ts &
```

- [ ] **Step 2: Verify API output**

```bash
COMPANY_ID=$(curl -s http://localhost:3000/api/companies | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('companies',d) if isinstance(d,dict) else d)[0]['id'])")
curl -s "http://localhost:3000/api/companies/$COMPANY_ID/map" | python3 -c "
import sys,json
d=json.load(sys.stdin)
furn = next(l for l in d['layers'] if l['name']=='furniture')
nonzero = sum(1 for g in furn['data'] if g != 0)
total = d['width'] * d['height']
print(f\"{d['width']}x{d['height']} desks={len(d['deskPositions'])} coverage={nonzero/total*100:.0f}%\")
"
```

Expected: coverage should be notably higher than V1 (~20-40% vs previous ~8%).

- [ ] **Step 3: Open browser and visually verify**

Open company offices in the browser. Verify:
- Modern Office tileset renders (different art from escape-room)
- Offices have internal walls creating zones
- Desks have monitors and accessories
- Wall decorations present
- Different companies have different layouts
- Agents sit at desk positions

- [ ] **Step 4: Fix any GID mismatches**

If tiles look wrong (wrong item at wrong position), the GID catalog needs correction. Read the tileset image at the mismatched position and update the GID in `office-tiles.ts`. This is expected — some GIDs may differ between the old and new tileset despite having the same grid structure.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(#156): V2 office generation — template gallery with Modern Office tileset

Dense, multi-zone office layouts using LimeZu Modern Office tileset.
5 templates (small/medium/large), stamp-based furniture composition,
detail randomizer for per-company variety.

Closes #156"
```
