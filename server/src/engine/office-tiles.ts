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
