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

// Suppress unused import warning — TEMPLATES is available for external callers
void TEMPLATES;
