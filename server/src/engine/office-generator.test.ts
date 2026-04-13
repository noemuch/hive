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
