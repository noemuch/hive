// server/src/engine/office-generator.ts

/**
 * Office generator — V1 image-based.
 * Serves the LimeZu Office Design 2 as a background image
 * with manually mapped desk positions, POI, and collision data.
 *
 * The PNG is purely visual. All game logic (pathfinding, agent
 * placement, collisions) comes from the metadata in this file.
 */

// ── Types ──────────────────────────────────────────────────────────────

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

// ── Office Design 2 layout data ────────────────────────────────────────
// Mapped from /6_Office_Designs/Office_Design_2.gif (32x34 tiles)
//
// Layout:
//   Top section (rows 0-17): Open office with 2 double-rows of cubicle desks
//     - Row 1 top: 4 desks facing away (y≈5-6), chairs at y≈4
//     - Row 1 bot: 4 desks facing toward (y≈8-9), chairs at y≈10
//     - Row 2 top: 4 desks facing away (y≈12-13), chairs at y≈11
//     - Row 2 bot: 4 desks facing toward (y≈14-15), chairs at y≈16
//   Internal wall at rows 18-19
//   Bottom section (rows 19-33): Break area + 2 small offices
//     - Bottom-left: manager office with desk
//     - Bottom-center: break area (plants, water cooler, table)
//     - Bottom-right: small office with desk

const T = 16; // tile size in pixels

/** Chair positions where agents sit (tile coordinates). */
const DESK_POSITIONS = [
  // Top cubicle row 1 — front-facing chairs (below desks)
  { x: 4, y: 10 },
  { x: 8, y: 10 },
  { x: 19, y: 10 },
  { x: 23, y: 10 },
  // Top cubicle row 2 — front-facing chairs
  { x: 4, y: 16 },
  { x: 8, y: 16 },
  { x: 19, y: 16 },
  { x: 23, y: 16 },
  // Bottom-left office
  { x: 6, y: 27 },
  // Bottom-right office
  { x: 25, y: 27 },
];

const POI = {
  coffee: { x: 16, y: 25 },
  whiteboard: { x: 15, y: 2 },
  door: { x: 16, y: 33 },
};

/** Collision rectangles (pixel coordinates). Blocks agent movement. */
const COLLISIONS: CollisionObject[] = [
  // ── Perimeter walls ──
  { name: "top_wall", type: "", x: 0, y: 0, width: 32 * T, height: 4 * T },
  { name: "bottom_wall", type: "", x: 0, y: 33 * T, width: 32 * T, height: 1 * T },
  { name: "left_wall", type: "", x: 0, y: 0, width: 1 * T, height: 34 * T },
  { name: "right_wall", type: "", x: 31 * T, y: 0, width: 1 * T, height: 34 * T },

  // ── Internal horizontal wall (separating open office from bottom section) ──
  { name: "internal_wall", type: "", x: 0, y: 18 * T, width: 9 * T, height: 2 * T },
  { name: "internal_wall_r", type: "", x: 0, y: 18 * T, width: 1 * T, height: 16 * T },

  // ── Top section: cubicle desk rows ──
  // Row 1 desks (back-facing): desk surfaces + cubicle partitions
  { name: "desk_r1_left", type: "", x: 2 * T, y: 5 * T, width: 7 * T, height: 4 * T },
  { name: "desk_r1_right", type: "", x: 16 * T, y: 5 * T, width: 9 * T, height: 4 * T },
  // Row 2 desks (front-facing)
  { name: "desk_r2_left", type: "", x: 2 * T, y: 11 * T, width: 7 * T, height: 4 * T },
  { name: "desk_r2_right", type: "", x: 16 * T, y: 11 * T, width: 9 * T, height: 4 * T },

  // ── Right-side furniture (printers, filing) ──
  { name: "printer_area", type: "", x: 27 * T, y: 4 * T, width: 4 * T, height: 3 * T },
  { name: "plants_right", type: "", x: 29 * T, y: 9 * T, width: 2 * T, height: 2 * T },
  { name: "plants_right2", type: "", x: 29 * T, y: 15 * T, width: 2 * T, height: 2 * T },

  // ── Bottom-left: manager office ──
  { name: "mgr_desk", type: "", x: 3 * T, y: 24 * T, width: 5 * T, height: 3 * T },
  { name: "mgr_filing", type: "", x: 2 * T, y: 22 * T, width: 3 * T, height: 2 * T },

  // ── Bottom-center: break area ──
  { name: "break_table", type: "", x: 13 * T, y: 24 * T, width: 4 * T, height: 3 * T },
  { name: "break_cooler", type: "", x: 16 * T, y: 21 * T, width: 2 * T, height: 2 * T },
  { name: "break_plant", type: "", x: 12 * T, y: 22 * T, width: 2 * T, height: 3 * T },

  // ── Bottom-right: small office ──
  { name: "office_desk", type: "", x: 22 * T, y: 24 * T, width: 5 * T, height: 3 * T },
  { name: "office_shelf", type: "", x: 27 * T, y: 22 * T, width: 3 * T, height: 2 * T },

  // ── Bottom wall plants ──
  { name: "plant_bl", type: "", x: 1 * T, y: 31 * T, width: 2 * T, height: 2 * T },
  { name: "plant_br", type: "", x: 29 * T, y: 31 * T, width: 2 * T, height: 2 * T },

  // ── Void area (outside office, bottom-left L-shape) ──
  { name: "void_bl", type: "", x: 0, y: 19 * T, width: 9 * T, height: 1 * T },
];

// ── Generator ──────────────────────────────────────────────────────────

/** Generate the office map for a company. V1: single image-based design. */
export function generateOffice(agentCount: number, _companyId?: string): GeneratedOffice {
  // V1: every company gets the same beautiful LimeZu office
  // Desk positions are trimmed to agent count
  const desks = DESK_POSITIONS.slice(0, Math.max(agentCount, 2));

  return {
    backgroundImage: "/maps/office-v1.png",
    width: 32,
    height: 34,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      {
        name: "Collisions",
        type: "objectgroup",
        objects: COLLISIONS,
        visible: true,
        opacity: 1,
      },
    ],
    tilesets: [] as never[],
    deskPositions: desks,
    poi: POI,
  };
}
