# Random Office Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each company gets a unique, deterministic, procedurally generated office layout based on its ID and agent count.

**Architecture:** Server generates Tiled-compatible JSON via seeded PRNG, served at `/api/companies/:id/map` (existing endpoint). Client fetches this instead of static escape-room maps. Same tilesets (`room_builder.png` + `office_items.png`), same renderer.

**Tech Stack:** Bun (server), PixiJS 8 (client), Tiled JSON format, LimeZu 16x16 tilesets

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/engine/office-tiles.ts` | Create | GID catalog for LimeZu 16x16 tilesets |
| `server/src/engine/seeded-random.ts` | Create | Deterministic PRNG (mulberry32) |
| `server/src/engine/office-generator.ts` | Rewrite | Procedural office generator using tiles + PRNG |
| `server/src/engine/office-generator.test.ts` | Create | Tests for generator |
| `server/src/index.ts` | Modify (line ~258) | Pass companyId to generator |
| `web/src/canvas/office.ts` | Modify | Fetch API, dynamic desk/POI exports |
| `web/src/canvas/agents.ts` | Modify (line 12, 271-274, 613-616) | Import dynamic desk positions + POI |
| `web/src/canvas/npcs.ts` | Modify (line 11, 102, 105) | Import dynamic POI |
| `web/src/canvas/pathfinding.ts` | Modify (type only, line 24) | Add `poi` to TiledMap type |

---

### Task 1: GID Catalog

**Files:**
- Create: `server/src/engine/office-tiles.ts`

- [ ] **Step 1: Create the GID catalog file**

This catalog was reverse-engineered from the 10 escape-room Tiled maps. The tilesets are:
- `room_builder.png`: 256x224px, 16 cols, 14 rows, firstgid=1 (GIDs 1-224)
- `office_items.png`: 256x848px, 16 cols, 53 rows, firstgid=225 (GIDs 225-1072)

```typescript
// server/src/engine/office-tiles.ts

/**
 * GID catalog for LimeZu 16x16 tilesets (room_builder.png + office_items.png).
 * Reverse-engineered from escape-room Tiled maps.
 *
 * room_builder.png: firstgid=1, 16 cols, 14 rows (224 tiles)
 * office_items.png: firstgid=225, 16 cols, 53 rows (848 tiles)
 */

// ---------------------------------------------------------------------------
// Room structure (room_builder.png, firstgid=1)
// ---------------------------------------------------------------------------

/** Dark void tile used behind walls */
export const VOID = 9;

/** Floor tiles — wood variants for visual variety */
export const FLOOR = {
  WOOD_A: 94,   // light wood
  WOOD_B: 95,   // light wood variant
  WOOD_C: 110,  // medium wood
  WOOD_D: 111,  // medium wood variant
  EDGE: 96,     // floor transition strip
} as const;

/** All floor GIDs for random selection */
export const FLOOR_TILES = [FLOOR.WOOD_A, FLOOR.WOOD_B, FLOOR.WOOD_C, FLOOR.WOOD_D] as const;

/**
 * Wall system — escape-room maps use a multi-row wall with depth.
 * Top wall is 4 rows deep: frame row, 2 wallpaper rows, baseboard row.
 * Side walls use the frame tiles vertically.
 * Bottom wall is 2 rows: baseboard + frame.
 */
export const WALL = {
  // Top wall frame (left/right edges per row)
  T1_L: 24,  T1_R: 26,   // row 1: top corners
  T2_L: 40,  T2_R: 42,   // row 2: middle frame
  T3_L: 56,  T3_R: 58,   // row 3: bottom frame

  // Wallpaper fill (between left/right edges)
  FILL_A: 82,  FILL_B: 83,   // lavender wallpaper
  FILL_C: 98,  FILL_D: 99,   // light wallpaper

  // Baseboard / trim (left, center, right)
  BASE_L: 113, BASE_C: 114, BASE_R: 115,
  TRIM_L: 129, TRIM_C: 130, TRIM_R: 131,

  // Dark lower wall (used in dividers and bottom)
  DARK_L: 177, DARK_C: 178, DARK_R: 179,
  DARK2_L: 193, DARK2_C: 194, DARK2_R: 195,

  // Bottom wall segments
  BOT_A: 21, BOT_B: 25,
} as const;

// ---------------------------------------------------------------------------
// Furniture (office_items.png, firstgid=225)
// ---------------------------------------------------------------------------

/**
 * Chairs — each is 1 tile wide, 2 tiles tall (top + bottom).
 * Front-facing: agent faces the viewer (sitting at desk).
 * Back-facing: agent faces away (at meeting table).
 */
export const CHAIR = {
  FRONT_T1: 354, FRONT_B1: 370,  // front-facing variant 1
  FRONT_T2: 386, FRONT_B2: 402,  // front-facing variant 2
  BACK_T1: 385,  BACK_B1: 401,   // back-facing variant 1
  BACK_T2: 388,  BACK_B2: 404,   // back-facing variant 2
  SIDE_T1: 356,  SIDE_B1: 372,   // side-facing variant 1
  SIDE_T2: 357,  SIDE_B2: 373,   // side-facing variant 2
  SIDE_T3: 358,  SIDE_B3: 374,   // side-facing variant 3
} as const;

/**
 * Desks — 3 tiles wide, 2 tiles deep (top row + bottom row).
 * Two visual styles available.
 */
export const DESK = {
  // Style 1 (lighter)
  S1_TL: 706, S1_TC: 707, S1_TR: 708,
  S1_BL: 722, S1_BC: 723, S1_BR: 724,
  // Style 2 (darker)
  S2_TL: 680, S2_TC: 681, S2_TR: 682,
  S2_BL: 696, S2_BC: 697, S2_BR: 698,
} as const;

/**
 * Meeting/break tables — 3 tiles wide, 2 tiles deep.
 */
export const TABLE = {
  // Meeting table (formal)
  M_TL: 709, M_TC: 710, M_TR: 711,
  M_BL: 725, M_BC: 726, M_BR: 727,
  // Break table (casual)
  B_TL: 712, B_TC: 713, B_TR: 714,
  B_BL: 728, B_BC: 729, B_BR: 730,
} as const;

/**
 * Cubicle partition panels — 7 tiles wide, 3 tiles deep.
 * Used as desk dividers between workstation rows.
 */
export const CUBICLE = {
  T: [641, 642, 643, 644, 645, 646, 647] as readonly number[],
  M: [657, 658, 659, 660, 661, 662, 663] as readonly number[],
  B: [673, 674, 675, 676, 677, 678, 679] as readonly number[],
} as const;

/**
 * Printer — 2 tiles wide, 2 tiles deep.
 */
export const PRINTER = {
  TL: 586, TR: 587,
  BL: 602, BR: 603,
} as const;

/**
 * Desk clutter items — single tiles placed on/near desks for visual variety.
 */
export const CLUTTER = [648, 649, 650, 664, 665, 666, 686, 687, 688, 702, 703, 704] as const;

/**
 * Wall decorations — tall objects (4 tiles vertical) for wall accents.
 */
export const DECO_TALL = [240, 256, 272, 288] as const;

/**
 * Wall art panels — 2x2 tile decorative pieces for walls.
 */
export const WALL_ART = {
  A: { tl: 985, tr: 987, bl: 1001, br: 1003 },
  B: { tl: 1017, tr: 1019, bl: 1033, br: 1035 },
} as const;

/**
 * Wall accent strips — vertical decoration for divider walls.
 */
export const ACCENT_STRIP = [343, 359, 375, 391, 407, 423, 439, 455, 472, 488, 504] as const;

// ---------------------------------------------------------------------------
// Tileset metadata (for Tiled JSON output)
// ---------------------------------------------------------------------------

export const TILESETS = [
  {
    firstgid: 1,
    name: "room_builder",
    image: "/maps/escape-room/room_builder.png",
    tilewidth: 16,
    tileheight: 16,
    columns: 16,
    imagewidth: 256,
    imageheight: 224,
    tilecount: 224,
  },
  {
    firstgid: 225,
    name: "office_items",
    image: "/maps/escape-room/office_items.png",
    tilewidth: 16,
    tileheight: 16,
    columns: 16,
    imagewidth: 256,
    imageheight: 848,
    tilecount: 848,
  },
] as const;
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd server && bunx tsc --noEmit src/engine/office-tiles.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/office-tiles.ts
git commit -m "feat(#156): add LimeZu 16x16 GID catalog for office generation"
```

---

### Task 2: Seeded PRNG

**Files:**
- Create: `server/src/engine/seeded-random.ts`

- [ ] **Step 1: Create the seeded random module**

```typescript
// server/src/engine/seeded-random.ts

/**
 * Deterministic PRNG using mulberry32 algorithm.
 * Same seed always produces the same sequence.
 */

/** Hash a string to a 32-bit integer seed. */
export function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0; // ensure unsigned
}

/** Create a seeded PRNG (mulberry32). Returns a function that yields [0, 1). */
export function createRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a random element from an array using the PRNG. */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Shuffle an array in-place using Fisher-Yates with the PRNG. Returns the same array. */
export function shuffle<T>(rng: () => number, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Random integer in [min, max] inclusive. */
export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd server && bunx tsc --noEmit src/engine/seeded-random.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add server/src/engine/seeded-random.ts
git commit -m "feat(#156): add deterministic seeded PRNG for office generation"
```

---

### Task 3: Rewrite the Office Generator

**Files:**
- Rewrite: `server/src/engine/office-generator.ts`

This is the core task. The generator creates Tiled-compatible JSON maps with 4 layers: `backdrop`, `floor`, `furniture`, `Collisions` (objectgroup).

- [ ] **Step 1: Write the test file**

```typescript
// server/src/engine/office-generator.test.ts

import { describe, it, expect } from "bun:test";
import { generateOffice } from "./office-generator";

describe("generateOffice", () => {
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
    expect(office.deskPositions.length).toBeGreaterThanOrEqual(4);
    expect(office.poi.whiteboard).toBeDefined();
    expect(office.poi.door).toBeDefined();
  });

  it("is deterministic — same inputs produce identical output", () => {
    const a = generateOffice(6, "determinism-test");
    const b = generateOffice(6, "determinism-test");

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("different companyIds produce different layouts", () => {
    const a = generateOffice(6, "company-alpha");
    const b = generateOffice(6, "company-beta");

    // Floor layers should differ (different floor tile patterns)
    const floorA = a.layers.find(l => l.name === "floor")?.data;
    const floorB = b.layers.find(l => l.name === "floor")?.data;
    expect(floorA).not.toEqual(floorB);
  });

  it("scales office size with agent count", () => {
    const small = generateOffice(2, "small-co");
    const medium = generateOffice(5, "medium-co");
    const large = generateOffice(8, "large-co");

    expect(small.width).toBeLessThan(medium.width);
    expect(medium.width).toBeLessThan(large.width);
    expect(small.deskPositions.length).toBeGreaterThanOrEqual(2);
    expect(medium.deskPositions.length).toBeGreaterThanOrEqual(5);
    expect(large.deskPositions.length).toBeGreaterThanOrEqual(8);
  });

  it("desk positions are within map bounds", () => {
    const office = generateOffice(7, "bounds-check");

    for (const pos of office.deskPositions) {
      expect(pos.x).toBeGreaterThanOrEqual(1);
      expect(pos.x).toBeLessThan(office.width - 1);
      expect(pos.y).toBeGreaterThanOrEqual(1);
      expect(pos.y).toBeLessThan(office.height - 1);
    }
  });

  it("poi positions are within map bounds", () => {
    const office = generateOffice(6, "poi-check");

    expect(office.poi.door.x).toBeGreaterThanOrEqual(0);
    expect(office.poi.door.x).toBeLessThan(office.width);
    expect(office.poi.whiteboard.x).toBeGreaterThanOrEqual(0);
    expect(office.poi.whiteboard.x).toBeLessThan(office.width);
  });

  it("ground layer has correct tile count", () => {
    const office = generateOffice(4, "tile-count");
    const ground = office.layers.find(l => l.name === "backdrop");

    expect(ground).toBeDefined();
    expect(ground!.data!.length).toBe(office.width * office.height);
  });

  it("medium+ offices have a meeting area", () => {
    const medium = generateOffice(5, "meeting-test");
    expect(medium.poi.coffee).not.toBeNull();
  });

  it("small offices have no meeting area", () => {
    const small = generateOffice(2, "no-meeting");
    expect(small.poi.coffee).toBeNull();
  });

  it("Collisions objectgroup has collision rectangles", () => {
    const office = generateOffice(6, "collision-test");
    const collisions = office.layers.find(l => l.name === "Collisions");

    expect(collisions).toBeDefined();
    expect(collisions!.type).toBe("objectgroup");
    expect(collisions!.objects!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && bun test src/engine/office-generator.test.ts`
Expected: FAIL (current generator signature is `generateOffice(agentCount)` — no companyId, wrong output format)

- [ ] **Step 3: Rewrite the generator**

Replace the entire content of `server/src/engine/office-generator.ts` with:

```typescript
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

function makeLayer(name: string, w: number, h: number): number[] {
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
  // Main floor area (rows 4 to h-3)
  const mainFloor = pick(rng, [[FLOOR.WOOD_A, FLOOR.WOOD_B], [FLOOR.WOOD_C, FLOOR.WOOD_D]]);

  for (let y = 4; y < h - 2; y++) {
    for (let x = 1; x < w - 1; x++) {
      // Checkerboard pattern with the two variants
      const tile = (x + y) % 2 === 0 ? mainFloor[0] : mainFloor[1];
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

  // Floor area: y from 5 to h-4 (skip top wall + 1 row gap, skip bottom wall + 1 row gap)
  const floorTop = 5;
  const floorBot = h - 4;
  const floorLeft = 2;

  // Desk row spacing (desk=2 + chair=2 + gap=1 = 5 tiles per row)
  const rowSpacing = 5;

  if (size === "small") {
    // Single column of desks, left-aligned
    const colX = floorLeft + randInt(rng, 0, 2);
    for (let i = 0; i < desksNeeded && i < 3; i++) {
      const dy = floorTop + i * rowSpacing;
      if (dy + 4 > floorBot) break;
      placements.push({ x: colX, y: dy, chairY: dy + 2 });
    }
  } else if (size === "medium") {
    // Two columns
    const col1X = floorLeft + randInt(rng, 0, 1);
    const col2X = col1X + randInt(rng, 8, 10);
    let placed = 0;
    for (let i = 0; i < 3 && placed < desksNeeded; i++) {
      const dy = floorTop + i * rowSpacing;
      if (dy + 4 > floorBot) break;
      placements.push({ x: col1X, y: dy, chairY: dy + 2 });
      placed++;
    }
    for (let i = 0; i < 3 && placed < desksNeeded; i++) {
      const dy = floorTop + i * rowSpacing;
      if (dy + 4 > floorBot) break;
      placements.push({ x: col2X, y: dy, chairY: dy + 2 });
      placed++;
    }
  } else {
    // Large: two staggered columns + potential third
    const col1X = floorLeft + randInt(rng, 0, 2);
    const col2X = col1X + randInt(rng, 8, 10);
    const col3X = col2X + randInt(rng, 8, 10);
    let placed = 0;
    for (let col of [col1X, col2X, col3X]) {
      if (col + 3 >= w - 2) break; // don't overflow right wall
      for (let i = 0; i < 3 && placed < desksNeeded; i++) {
        const dy = floorTop + i * rowSpacing;
        if (dy + 4 > floorBot) break;
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
  rng: () => number,
): { x: number; y: number } | null {
  const size = getSize(Math.max(4, Math.floor(w / 5))); // infer from width
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
  const coffeePos = placeMeetingArea(furniture, w, h, rng);

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
```

- [ ] **Step 4: Run the tests**

Run: `cd server && bun test src/engine/office-generator.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/src/engine/office-generator.ts server/src/engine/office-generator.test.ts
git commit -m "feat(#156): rewrite office generator for LimeZu 16x16 with seeded randomization"
```

---

### Task 4: Wire Server Endpoint

**Files:**
- Modify: `server/src/index.ts:254-263`

- [ ] **Step 1: Update the /map endpoint to pass companyId**

In `server/src/index.ts`, find the block (around line 254):

```typescript
    // Generate office map for a company
    if (url.pathname.startsWith("/api/companies/") && url.pathname.endsWith("/map") && req.method === "GET") {
      const companyId = url.pathname.split("/")[3];
      const { rows: agents } = await pool.query(
        `SELECT COUNT(*)::int as c FROM agents WHERE company_id = $1 AND status NOT IN ('retired','disconnected')`,
        [companyId]
      );
      const agentCount = Math.max(agents[0]?.c || 0, 3); // minimum 3 for a reasonable office
      const { generateOffice } = await import("./engine/office-generator");
      return json(generateOffice(agentCount));
    }
```

Replace with:

```typescript
    // Generate office map for a company
    if (url.pathname.startsWith("/api/companies/") && url.pathname.endsWith("/map") && req.method === "GET") {
      const companyId = url.pathname.split("/")[3];
      const { rows: agents } = await pool.query(
        `SELECT COUNT(*)::int as c FROM agents WHERE company_id = $1 AND status NOT IN ('retired','disconnected')`,
        [companyId]
      );
      const agentCount = Math.max(agents[0]?.c || 0, 3);
      const { generateOffice } = await import("./engine/office-generator");
      return json(generateOffice(agentCount, companyId));
    }
```

The only change is passing `companyId` as the second argument.

- [ ] **Step 2: Verify server compiles**

Run: `cd server && bunx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(#156): pass companyId to office generator for deterministic layouts"
```

---

### Task 5: Update Client — office.ts

**Files:**
- Modify: `web/src/canvas/office.ts`
- Modify: `web/src/canvas/pathfinding.ts:17-25` (type update)

- [ ] **Step 1: Add `poi` field to TiledMap type**

In `web/src/canvas/pathfinding.ts`, update the `TiledMap` type (around line 17):

```typescript
export type TiledMap = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: { firstgid: number; name?: string; columns?: number; tilecount?: number; image?: string; imagewidth?: number; imageheight?: number; source?: string }[];
  deskPositions?: { x: number; y: number }[];
  poi?: {
    coffee: { x: number; y: number } | null;
    whiteboard: { x: number; y: number };
    door: { x: number; y: number };
  };
};
```

- [ ] **Step 2: Rewrite office.ts**

Replace the entire content of `web/src/canvas/office.ts` with:

```typescript
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

// Dynamic POI — populated from API response
export let POI = {
  COFFEE: { x: 21, y: 3 },
  WHITEBOARD: { x: 5, y: 10 },
  PRINTER: { x: 35, y: 5 },
  BREAK_AREA: { x: 30, y: 3 },
} as const satisfies Record<string, { x: number; y: number }>;

// Mutable POI that gets overwritten from API
let poiMutable: Record<string, { x: number; y: number }> = { ...POI };
export function getPoi(): Record<string, { x: number; y: number }> {
  return poiMutable;
}

TextureSource.defaultOptions.scaleMode = "nearest";

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
// Fetch office map from API (procedural generator)
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
// Load fallback static map (escape-room-01)
// ---------------------------------------------------------------------------
async function loadFallbackMap(): Promise<TiledMap> {
  return fetch("/maps/escape-room/escape-room-01.json").then(r => r.json());
}

// ---------------------------------------------------------------------------
// Create office
// ---------------------------------------------------------------------------
/** Load or generate an office map and render it as a PixiJS container. */
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
    mapData = await loadFallbackMap();
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

  // Load tilesets — read from map data or use defaults
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

  // Fallback: if no tilesets loaded from map data, try hardcoded paths
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
```

Key changes:
- `DESK_POSITIONS` is now `let` (mutable), populated from API response
- `POI` kept as const for backward compat; `getPoi()` returns dynamic values
- `fetchOfficeMap()` calls API, falls back to static map
- Tilesets loaded from map JSON response (with hardcoded fallback)
- Removed `getRandomRoomIndex()` and the escape-room map selection logic

- [ ] **Step 3: Verify the web project compiles**

Run: `cd web && bun run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add web/src/canvas/office.ts web/src/canvas/pathfinding.ts
git commit -m "feat(#156): office.ts fetches procedural map from API, dynamic desk positions"
```

---

### Task 6: Update agents.ts and npcs.ts Imports

**Files:**
- Modify: `web/src/canvas/agents.ts:12, 271-274, 613-616`
- Modify: `web/src/canvas/npcs.ts:11, 102, 105`

The imports of `DESK_POSITIONS` and `POI` from `office.ts` still work because the exports exist — they're just mutable now. However, `POI` usage in the movement system needs to use the dynamic `getPoi()` function for runtime values.

- [ ] **Step 1: Update agents.ts imports and POI usage**

In `web/src/canvas/agents.ts`, change line 12:

```typescript
// Before:
import { TILE, DESK_POSITIONS, POI, collisionGrid, OFFICE_W, OFFICE_H } from "./office";

// After:
import { TILE, DESK_POSITIONS, getPoi, collisionGrid, OFFICE_W, OFFICE_H } from "./office";
```

Then update the `DEST_TO_POI` map (around line 613):

```typescript
// Before:
const DEST_TO_POI: Record<DestinationType, Point> = {
  whiteboard: POI.WHITEBOARD,
  coffee: POI.COFFEE,
  desk: { x: 0, y: 0 },
};

// After:
function getDestPoi(dest: DestinationType): Point {
  const poi = getPoi();
  if (dest === "whiteboard") return poi.WHITEBOARD;
  if (dest === "coffee") return poi.COFFEE;
  return { x: 0, y: 0 };
}
```

And update `startWalking()` (around line 646):

```typescript
// Before:
const endTile = dest === "desk" ? m.homeDesk : DEST_TO_POI[dest];

// After:
const endTile = dest === "desk" ? m.homeDesk : getDestPoi(dest);
```

- [ ] **Step 2: Update npcs.ts imports**

In `web/src/canvas/npcs.ts`, change line 11:

```typescript
// Before:
import { TILE, OFFICE_W, OFFICE_H, collisionGrid, POI } from "./office";

// After:
import { TILE, OFFICE_W, OFFICE_H, collisionGrid, getPoi } from "./office";
```

Then update POI references (around lines 102, 105):

```typescript
// Before:
target = POI.COFFEE;
// ...
target = POI.WHITEBOARD;

// After:
target = getPoi().COFFEE;
// ...
target = getPoi().WHITEBOARD;
```

- [ ] **Step 3: Verify compilation**

Run: `cd web && bun run lint`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add web/src/canvas/agents.ts web/src/canvas/npcs.ts
git commit -m "feat(#156): agents and npcs use dynamic POI from procedural office"
```

---

### Task 7: Update CLAUDE.md and Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the "NOT built" section in CLAUDE.md**

Find the line:
```
**NOT built:** observer (code exists, not running on real data), entropy, agent movement/pathfinding (#145), SDK (agent-sdk/python is empty scaffold), NPC server logic (client-only, disabled), company lifecycle (partially done)
```

The procedural office generation is now built. No change needed to this line (it doesn't mention office generation), but update the Canvas section:

Find:
```
- **Canvas:** office.ts (Tiled map renderer), agents.ts (sprites + pill labels + bubbles), camera.ts (pixi-viewport + zoom controls), pathfinding.ts (A*), npcs.ts (disabled)
```

Replace with:
```
- **Canvas:** office.ts (Tiled map renderer, fetches procedural map from API), agents.ts (sprites + pill labels + bubbles), camera.ts (pixi-viewport + zoom controls), pathfinding.ts (A*), npcs.ts (disabled)
```

Also find:
```
    engine/handlers.ts    -- Event handlers (messages, reactions, sync)
    engine/office-generator.ts
```

Replace with:
```
    engine/handlers.ts    -- Event handlers (messages, reactions, sync)
    engine/office-generator.ts  -- Procedural office map generator (LimeZu 16x16)
    engine/office-tiles.ts      -- GID catalog for office tilesets
    engine/seeded-random.ts     -- Deterministic PRNG for generation
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for procedural office generation (#156)"
```

---

### Task 8: Integration Test — Full Stack Verification

- [ ] **Step 1: Start the server and verify the /map endpoint**

Run: `cd server && bun run src/index.ts &`

Then test with curl (use any valid company ID from the database):

```bash
curl -s http://localhost:3000/api/companies | jq '.[0].id' -r
# Use the returned ID:
curl -s http://localhost:3000/api/companies/<COMPANY_ID>/map | jq '{width, height, tilewidth, layers: [.layers[].name], deskCount: (.deskPositions | length), poi}'
```

Expected output shape:
```json
{
  "width": 30,
  "height": 18,
  "tilewidth": 16,
  "layers": ["backdrop", "floor", "furniture", "Collisions"],
  "deskCount": 6,
  "poi": {
    "coffee": { "x": 23, "y": 7 },
    "whiteboard": { "x": 12, "y": 2 },
    "door": { "x": 15, "y": 16 }
  }
}
```

- [ ] **Step 2: Verify determinism**

```bash
COMPANY_ID=$(curl -s http://localhost:3000/api/companies | jq '.[0].id' -r)
HASH1=$(curl -s http://localhost:3000/api/companies/$COMPANY_ID/map | md5)
HASH2=$(curl -s http://localhost:3000/api/companies/$COMPANY_ID/map | md5)
echo "Match: $([[ $HASH1 == $HASH2 ]] && echo YES || echo NO)"
```

Expected: `Match: YES`

- [ ] **Step 3: Verify different companies get different maps**

```bash
IDS=$(curl -s http://localhost:3000/api/companies | jq -r '.[].id' | head -2)
ID1=$(echo "$IDS" | head -1)
ID2=$(echo "$IDS" | tail -1)
HASH1=$(curl -s http://localhost:3000/api/companies/$ID1/map | md5)
HASH2=$(curl -s http://localhost:3000/api/companies/$ID2/map | md5)
echo "Different: $([[ $HASH1 != $HASH2 ]] && echo YES || echo NO)"
```

Expected: `Different: YES`

- [ ] **Step 4: Start the web app and verify visually**

Run: `cd web && bun run dev`

Open `http://localhost:3001` (or whichever port), navigate to a company office. Verify:
- Office renders without errors
- Agents appear at desk positions
- Different companies have different layouts
- Zoom controls work
- No console errors

- [ ] **Step 5: Run all tests**

```bash
cd server && bun test
cd web && bun run lint
```

Expected: all pass

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(#156): random office generation — each company gets a unique layout

Companies now get procedurally generated offices based on their ID.
- 3 office sizes (small/medium/large) based on agent count
- Seeded PRNG ensures deterministic layouts
- Desk positions and POI are dynamic from the API
- Uses LimeZu 16x16 tilesets (room_builder + office_items)

Closes #156"
```
