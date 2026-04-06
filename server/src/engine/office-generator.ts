/**
 * Procedural office generator using verified LimeZu tile GIDs.
 * Generates Tiled-compatible JSON maps that PixiJS can render.
 *
 * Uses room.png tileset (32x32 tiles, 11 columns, firstgid=1).
 */

// Verified GIDs from office-tile-catalog.json
const T = {
  // Walls
  WALL_TOP_L: 5,
  WALL_TOP: 6,
  WALL_TOP_R: 8,
  WALL_LEFT: 27,
  WALL_RIGHT: 30,
  WALL_BOT_L: 60,
  WALL_BOT: 38,
  WALL_BOT_R: 63,

  // Door
  DOOR_TL: 199, DOOR_TC: 200, DOOR_TR: 201,
  DOOR_BL: 210, DOOR_BC: 211, DOOR_BR: 212,

  // Floors
  FLOOR_WOOD: 222,
  FLOOR_CARPET: 244,
  FLOOR_TILE: 245,

  // Desks (3-wide front-facing)
  DESK_L: 224, DESK_C: 225, DESK_R: 226,

  // Tables (composable)
  TABLE_L: 213, TABLE_C: 214, TABLE_R: 215,

  // Chairs
  CHAIR_OFFICE: 240,
  CHAIR_SWIVEL: 208,
  CHAIR_CONFERENCE: 186,
  CHAIR_WOODEN: 153,

  // Computers
  MONITOR: 206,
  PC_TOWER: 217,
  LAPTOP: 218,
  COMP_DESK_TL: 169, COMP_DESK_TR: 170,
  COMP_DESK_BL: 180, COMP_DESK_BR: 181,

  // Whiteboard (2x2)
  WB_TL: 46, WB_TR: 47,
  WB_BL: 57, WB_BR: 58,

  // Bookshelf (2x2)
  BOOK_TL: 97, BOOK_TR: 98,
  BOOK_BL: 108, BOOK_BR: 109,

  // Cabinet (3x2)
  CAB_TL: 166, CAB_TC: 167, CAB_TR: 168,
  CAB_BL: 177, CAB_BC: 178, CAB_BR: 179,

  // Single items
  COFFEE_MACHINE: 173,
  PRINTER: 184,
  WATER_COOLER: 187,
  FILING_CABINET: 176,
  PLANT_TOP: 205,
  PLANT_BOT: 216,
  SHELF_A: 104,
  SHELF_B: 105,
  CHAIR_SIDE: 185,
};

type OfficeSize = "small" | "medium" | "large";

interface GeneratedOffice {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: {
    name: string;
    type: "tilelayer" | "objectgroup";
    data?: number[];
    objects?: { name: string; x: number; y: number; width: number; height: number }[];
    width?: number;
    height?: number;
    visible: boolean;
    opacity: number;
  }[];
  tilesets: { firstgid: number; name: string; image: string; tilewidth: number; tileheight: number; columns: number; imagewidth: number; imageheight: number }[];
  deskPositions: { x: number; y: number }[];
}

export function generateOffice(agentCount: number): GeneratedOffice {
  const size: OfficeSize = agentCount <= 3 ? "small" : agentCount <= 6 ? "medium" : "large";

  const dims = { small: { w: 16, h: 12 }, medium: { w: 22, h: 14 }, large: { w: 30, h: 16 } };
  const { w, h } = dims[size];

  const ground = new Array(w * h).fill(0);
  const objects = new Array(w * h).fill(0);
  const foreground = new Array(w * h).fill(0);

  const set = (layer: number[], x: number, y: number, gid: number) => {
    if (x >= 0 && x < w && y >= 0 && y < h) layer[y * w + x] = gid;
  };

  // === FLOOR ===
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      set(ground, x, y, T.FLOOR_WOOD);
    }
  }

  // Carpet in meeting area (right side)
  if (size !== "small") {
    const carpetX = w - 7;
    for (let y = 3; y < h - 3; y++) {
      for (let x = carpetX; x < w - 2; x++) {
        set(ground, x, y, T.FLOOR_CARPET);
      }
    }
  }

  // Tile floor in kitchen area (bottom right for large)
  if (size === "large") {
    for (let y = h - 5; y < h - 1; y++) {
      for (let x = w - 7; x < w - 1; x++) {
        set(ground, x, y, T.FLOOR_TILE);
      }
    }
  }

  // === WALLS ===
  // Top wall
  set(ground, 0, 0, T.WALL_TOP_L);
  for (let x = 1; x < w - 1; x++) set(ground, x, 0, T.WALL_TOP);
  set(ground, w - 1, 0, T.WALL_TOP_R);
  // Second row of wall (gives depth)
  for (let x = 1; x < w - 1; x++) set(ground, x, 1, T.WALL_LEFT + 1); // middle wall fill

  // Left wall
  for (let y = 1; y < h - 1; y++) set(ground, 0, y, T.WALL_LEFT);
  // Right wall
  for (let y = 1; y < h - 1; y++) set(ground, w - 1, y, T.WALL_RIGHT);
  // Bottom wall
  set(ground, 0, h - 1, T.WALL_BOT_L);
  for (let x = 1; x < w - 1; x++) set(ground, x, h - 1, T.WALL_BOT);
  set(ground, w - 1, h - 1, T.WALL_BOT_R);

  // Door (bottom center)
  const doorX = Math.floor(w / 2) - 1;
  set(ground, doorX, h - 2, T.DOOR_TL);
  set(ground, doorX + 1, h - 2, T.DOOR_TC);
  set(ground, doorX + 2, h - 2, T.DOOR_TR);
  set(ground, doorX, h - 1, T.DOOR_BL);
  set(ground, doorX + 1, h - 1, T.DOOR_BC);
  set(ground, doorX + 2, h - 1, T.DOOR_BR);

  // === FURNITURE (objects layer) ===
  const deskPositions: { x: number; y: number }[] = [];
  const desksNeeded = Math.min(agentCount, 8);

  // Place desk workstations in rows
  const deskStartY = 3;
  const deskSpacingY = 3;
  let desksPlaced = 0;

  // Left column of desks
  for (let i = 0; i < 4 && desksPlaced < desksNeeded; i++) {
    const dx = 2;
    const dy = deskStartY + i * deskSpacingY;
    if (dy + 2 >= h - 2) break;

    // Desk (3 wide)
    set(objects, dx, dy, T.DESK_L);
    set(objects, dx + 1, dy, T.DESK_C);
    set(objects, dx + 2, dy, T.DESK_R);
    // Monitor on desk
    set(objects, dx + 1, dy - 1, T.MONITOR);
    // Chair
    set(objects, dx + 1, dy + 1, T.CHAIR_OFFICE);

    deskPositions.push({ x: dx + 1, y: dy + 1 });
    desksPlaced++;
  }

  // Right column of desks (if medium or large)
  if (size !== "small") {
    const rightDeskX = size === "medium" ? 9 : 10;
    for (let i = 0; i < 4 && desksPlaced < desksNeeded; i++) {
      const dx = rightDeskX;
      const dy = deskStartY + i * deskSpacingY;
      if (dy + 2 >= h - 2) break;

      set(objects, dx, dy, T.DESK_L);
      set(objects, dx + 1, dy, T.DESK_C);
      set(objects, dx + 2, dy, T.DESK_R);
      set(objects, dx + 1, dy - 1, T.MONITOR);
      set(objects, dx + 1, dy + 1, T.CHAIR_OFFICE);

      deskPositions.push({ x: dx + 1, y: dy + 1 });
      desksPlaced++;
    }
  }

  // === MEETING AREA (medium/large) ===
  if (size !== "small") {
    const mx = w - 6;
    const my = 4;
    // Meeting table (3 wide)
    set(objects, mx, my, T.TABLE_L);
    set(objects, mx + 1, my, T.TABLE_C);
    set(objects, mx + 2, my, T.TABLE_R);
    // Chairs around table
    set(objects, mx, my - 1, T.CHAIR_CONFERENCE);
    set(objects, mx + 2, my - 1, T.CHAIR_CONFERENCE);
    set(objects, mx, my + 1, T.CHAIR_CONFERENCE);
    set(objects, mx + 2, my + 1, T.CHAIR_CONFERENCE);
    // Whiteboard on wall
    set(objects, mx, 1, T.WB_TL);
    set(objects, mx + 1, 1, T.WB_TR);
    set(objects, mx, 2, T.WB_BL);
    set(objects, mx + 1, 2, T.WB_BR);
  }

  // === DECORATIONS ===
  // Plants in corners
  set(objects, 1, 1, T.PLANT_TOP);
  set(objects, 1, 2, T.PLANT_BOT);
  if (w > 16) {
    set(objects, w - 2, 1, T.PLANT_TOP);
    set(objects, w - 2, 2, T.PLANT_BOT);
  }

  // Bookshelf on top wall
  const bookX = 6;
  set(objects, bookX, 1, T.BOOK_TL);
  set(objects, bookX + 1, 1, T.BOOK_TR);
  set(objects, bookX, 2, T.BOOK_BL);
  set(objects, bookX + 1, 2, T.BOOK_BR);

  // Coffee machine
  if (size !== "small") {
    set(objects, w - 2, h - 3, T.COFFEE_MACHINE);
    set(objects, w - 3, h - 3, T.WATER_COOLER);
  }

  // Printer near desks
  set(objects, 7, h - 3, T.PRINTER);

  // Filing cabinet
  if (size !== "small") {
    set(objects, 1, h - 3, T.FILING_CABINET);
  }

  return {
    width: w,
    height: h,
    tilewidth: 32,
    tileheight: 32,
    layers: [
      { name: "ground", type: "tilelayer", data: ground, width: w, height: h, visible: true, opacity: 1 },
      { name: "objects", type: "tilelayer", data: objects, width: w, height: h, visible: true, opacity: 1 },
      { name: "foreground", type: "tilelayer", data: foreground, width: w, height: h, visible: true, opacity: 1 },
    ],
    tilesets: [{
      firstgid: 1,
      name: "room",
      image: "/maps/room.png",
      tilewidth: 32,
      tileheight: 32,
      columns: 11,
      imagewidth: 352,
      imageheight: 832,
    }],
    deskPositions,
  };
}
