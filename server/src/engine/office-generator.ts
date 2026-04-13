// server/src/engine/office-generator.ts

/**
 * Office generator — V1 image-based.
 * Serves the LimeZu Office Design 2 (extracted lossless from .aseprite)
 * as a background PNG with manually mapped desk positions and collisions.
 *
 * Image: 256x400px = 16x25 tiles at 16px.
 * Source: Modern Office Revamped v1.2 / 6_Office_Designs / Office_Design_2.aseprite
 */

interface CollisionObject {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GeneratedOffice {
  backgroundImage: string;
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
  tilesets: never[];
  deskPositions: { x: number; y: number }[];
  poi: {
    coffee: { x: number; y: number } | null;
    whiteboard: { x: number; y: number };
    door: { x: number; y: number };
  };
}

// ── Layout data for Office Design 2 (16x25 tiles) ─────────────────────
//
// Top section (rows 0-12): Open office with 2 rows of cubicle desks
//   Row 0-2: Top wall + wall decorations (AC, shelves, monitors, plants)
//   Row 3-6: First cubicle desk row (4 desks facing down, chairs at row 6)
//   Row 7: Walkway
//   Row 8-11: Second cubicle desk row (4 desks facing down, chairs at row 11)
//   Row 12: Internal wall / transition
//
// Bottom section (rows 13-24): Break area + small offices
//   Row 13-17: Left=manager office, Center=break area, Right=small office
//   Row 18-24: Bottom wall + plants

const T = 16;
const MAP_W = 16;
const MAP_H = 25;

/** Chair positions where agents sit (tile coords, from 6x zoomed grid analysis).
 * Front-facing chairs = agent faces viewer, sits below the desk. */
const DESK_POSITIONS = [
  // Row 1 front-facing chairs (below first desk pair, y=9)
  { x: 3, y: 9 },   // left desk cluster, chair 1
  { x: 4, y: 9 },   // left desk cluster, chair 2
  { x: 9, y: 9 },   // right desk cluster, chair 1
  { x: 10, y: 9 },  // right desk cluster, chair 2
  // Row 1 back-facing chairs (above first desk pair, y=5)
  { x: 3, y: 5 },   // left desk cluster, back chair 1
  { x: 4, y: 5 },   // left desk cluster, back chair 2
  { x: 9, y: 5 },   // right desk cluster, back chair 1
  { x: 10, y: 5 },  // right desk cluster, back chair 2
  // Bottom section offices
  { x: 5, y: 18 },  // bottom-left office
  { x: 12, y: 18 }, // bottom-right office
];

const POI = {
  coffee: { x: 8, y: 17 },
  whiteboard: { x: 8, y: 1 },
  door: { x: 8, y: 24 },
};

/** Collision rectangles (pixel coords). */
const COLLISIONS: CollisionObject[] = [
  // Perimeter walls
  { name: "top", type: "", x: 0, y: 0, width: MAP_W * T, height: 3 * T },
  { name: "bottom", type: "", x: 0, y: 24 * T, width: MAP_W * T, height: 1 * T },
  { name: "left", type: "", x: 0, y: 0, width: 1 * T, height: MAP_H * T },
  { name: "right", type: "", x: 15 * T, y: 0, width: 1 * T, height: MAP_H * T },

  // Internal wall between top office and bottom section
  { name: "int_wall", type: "", x: 0, y: 12 * T, width: 5 * T, height: 1 * T },

  // Top section: cubicle desk rows
  { name: "desk_r1", type: "", x: 1 * T, y: 3 * T, width: 13 * T, height: 2 * T },
  { name: "desk_r2", type: "", x: 1 * T, y: 8 * T, width: 13 * T, height: 2 * T },

  // Right wall equipment (printer, filing)
  { name: "equip_r", type: "", x: 14 * T, y: 3 * T, width: 1 * T, height: 9 * T },

  // Bottom-left: manager office furniture
  { name: "mgr", type: "", x: 2 * T, y: 16 * T, width: 4 * T, height: 2 * T },

  // Bottom-center: break area furniture
  { name: "break", type: "", x: 7 * T, y: 15 * T, width: 3 * T, height: 3 * T },

  // Bottom-right: small office furniture
  { name: "office_r", type: "", x: 11 * T, y: 16 * T, width: 3 * T, height: 2 * T },

  // Bottom plants
  { name: "plant_bl", type: "", x: 0, y: 22 * T, width: 2 * T, height: 2 * T },
  { name: "plant_br", type: "", x: 14 * T, y: 22 * T, width: 2 * T, height: 2 * T },
];

// ── Generator ──────────────────────────────────────────────────────────

export function generateOffice(agentCount: number, _companyId?: string): GeneratedOffice {
  const desks = DESK_POSITIONS.slice(0, Math.max(agentCount, 2));

  return {
    backgroundImage: "/maps/office-v1.png",
    width: MAP_W,
    height: MAP_H,
    tilewidth: 16,
    tileheight: 16,
    layers: [{
      name: "Collisions",
      type: "objectgroup",
      objects: COLLISIONS,
      visible: true,
      opacity: 1,
    }],
    tilesets: [] as never[],
    deskPositions: desks,
    poi: POI,
  };
}
