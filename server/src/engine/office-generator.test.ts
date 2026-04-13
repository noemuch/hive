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
