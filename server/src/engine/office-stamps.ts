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
    [_, MONITOR.DISPLAY_TL, MONITOR.DISPLAY_TR, _, _],
    [_, MONITOR.DISPLAY_BL, MONITOR.DISPLAY_BR, _, _],
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
