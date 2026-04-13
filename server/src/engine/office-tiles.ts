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
  WOOD_A: 94,
  WOOD_B: 95,
  WOOD_C: 110,
  WOOD_D: 111,
  EDGE: 96,
} as const;

/** All floor GIDs for random selection */
export const FLOOR_TILES = [FLOOR.WOOD_A, FLOOR.WOOD_B, FLOOR.WOOD_C, FLOOR.WOOD_D] as const;

/**
 * Wall system — escape-room maps use a multi-row wall with depth.
 * Top wall is 4 rows deep: frame row, 2 wallpaper rows, baseboard row.
 */
export const WALL = {
  T1_L: 24,  T1_R: 26,
  T2_L: 40,  T2_R: 42,
  T3_L: 56,  T3_R: 58,
  FILL_A: 82,  FILL_B: 83,
  FILL_C: 98,  FILL_D: 99,
  BASE_L: 113, BASE_C: 114, BASE_R: 115,
  TRIM_L: 129, TRIM_C: 130, TRIM_R: 131,
  DARK_L: 177, DARK_C: 178, DARK_R: 179,
  DARK2_L: 193, DARK2_C: 194, DARK2_R: 195,
  BOT_A: 21, BOT_B: 25,
} as const;

// ---------------------------------------------------------------------------
// Furniture (office_items.png, firstgid=225)
// ---------------------------------------------------------------------------

export const CHAIR = {
  FRONT_T1: 354, FRONT_B1: 370,
  FRONT_T2: 386, FRONT_B2: 402,
  BACK_T1: 385,  BACK_B1: 401,
  BACK_T2: 388,  BACK_B2: 404,
  SIDE_T1: 356,  SIDE_B1: 372,
  SIDE_T2: 357,  SIDE_B2: 373,
  SIDE_T3: 358,  SIDE_B3: 374,
} as const;

export const DESK = {
  S1_TL: 706, S1_TC: 707, S1_TR: 708,
  S1_BL: 722, S1_BC: 723, S1_BR: 724,
  S2_TL: 680, S2_TC: 681, S2_TR: 682,
  S2_BL: 696, S2_BC: 697, S2_BR: 698,
} as const;

export const TABLE = {
  M_TL: 709, M_TC: 710, M_TR: 711,
  M_BL: 725, M_BC: 726, M_BR: 727,
  B_TL: 712, B_TC: 713, B_TR: 714,
  B_BL: 728, B_BC: 729, B_BR: 730,
} as const;

export const CUBICLE = {
  T: [641, 642, 643, 644, 645, 646, 647] as readonly number[],
  M: [657, 658, 659, 660, 661, 662, 663] as readonly number[],
  B: [673, 674, 675, 676, 677, 678, 679] as readonly number[],
} as const;

export const PRINTER = {
  TL: 586, TR: 587,
  BL: 602, BR: 603,
} as const;

export const CLUTTER = [648, 649, 650, 664, 665, 666, 686, 687, 688, 702, 703, 704] as const;

export const DECO_TALL = [240, 256, 272, 288] as const;

export const WALL_ART = {
  A: { tl: 985, tr: 987, bl: 1001, br: 1003 },
  B: { tl: 1017, tr: 1019, bl: 1033, br: 1035 },
} as const;

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
