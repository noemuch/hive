import { describe, it, expect } from "bun:test";
import {
  INHERITANCE_MAX_WEIGHT,
  INHERITANCE_WINDOW_DAYS,
  computeInheritance,
} from "../fork-inheritance";

describe("computeInheritance (pure math — #241 A13)", () => {
  it("starts at 25% weight on fork day (days_since_fork = 0)", () => {
    const r = computeInheritance({
      ownMu: 5.0,
      parentMuAtFork: 8.0,
      daysSinceFork: 0,
    });
    expect(r.inheritanceWeight).toBeCloseTo(0.25, 5);
    expect(r.inheritedMuComponent).toBeCloseTo(2.0, 5);
    expect(r.effectiveMu).toBeCloseTo(7.0, 5);
    expect(r.daysRemaining).toBe(INHERITANCE_WINDOW_DAYS);
  });

  it("decays linearly to 0 over 30 days", () => {
    const r = computeInheritance({
      ownMu: 5.0,
      parentMuAtFork: 8.0,
      daysSinceFork: 15,
    });
    // weight = 0.25 * (1 - 15/30) = 0.125
    expect(r.inheritanceWeight).toBeCloseTo(0.125, 5);
    expect(r.inheritedMuComponent).toBeCloseTo(1.0, 5);
    expect(r.effectiveMu).toBeCloseTo(6.0, 5);
    expect(r.daysRemaining).toBe(15);
  });

  it("returns zero inheritance at 30 days", () => {
    const r = computeInheritance({
      ownMu: 7.5,
      parentMuAtFork: 9.0,
      daysSinceFork: 30,
    });
    expect(r.inheritanceWeight).toBe(0);
    expect(r.inheritedMuComponent).toBe(0);
    expect(r.effectiveMu).toBeCloseTo(7.5, 5);
    expect(r.daysRemaining).toBe(0);
  });

  it("returns zero inheritance after 30 days (no negative weight)", () => {
    const r = computeInheritance({
      ownMu: 7.5,
      parentMuAtFork: 9.0,
      daysSinceFork: 90,
    });
    expect(r.inheritanceWeight).toBe(0);
    expect(r.inheritedMuComponent).toBe(0);
    expect(r.effectiveMu).toBeCloseTo(7.5, 5);
    expect(r.daysRemaining).toBe(0);
  });

  it("caps effective_mu at 10 (HEAR scale)", () => {
    const r = computeInheritance({
      ownMu: 9.5,
      parentMuAtFork: 10.0,
      daysSinceFork: 0,
    });
    // own 9.5 + 0.25*10 = 12 → capped to 10
    expect(r.effectiveMu).toBe(10);
    // Component reflects what was added pre-cap so the UI can still
    // show "inheriting X μ"
    expect(r.inheritedMuComponent).toBeCloseTo(2.5, 5);
  });

  it("returns null effective_mu when ownMu is null and no inheritance left", () => {
    const r = computeInheritance({
      ownMu: null,
      parentMuAtFork: 8.0,
      daysSinceFork: 45,
    });
    expect(r.effectiveMu).toBeNull();
    expect(r.inheritedMuComponent).toBe(0);
  });

  it("treats null ownMu as 0 during the inheritance window so a brand-new fork still shows μ", () => {
    const r = computeInheritance({
      ownMu: null,
      parentMuAtFork: 8.0,
      daysSinceFork: 0,
    });
    // own=null but weight=0.25 and parent=8 → component=2 → effective=2
    expect(r.inheritanceWeight).toBeCloseTo(0.25, 5);
    expect(r.inheritedMuComponent).toBeCloseTo(2.0, 5);
    expect(r.effectiveMu).toBeCloseTo(2.0, 5);
  });

  it("returns null effective_mu when parent_mu_at_fork is null AND own_mu is null", () => {
    const r = computeInheritance({
      ownMu: null,
      parentMuAtFork: null,
      daysSinceFork: 0,
    });
    expect(r.effectiveMu).toBeNull();
    expect(r.inheritedMuComponent).toBe(0);
  });

  it("treats missing parent snapshot as zero component (old forks pre-A13)", () => {
    const r = computeInheritance({
      ownMu: 5.0,
      parentMuAtFork: null,
      daysSinceFork: 5,
    });
    expect(r.inheritedMuComponent).toBe(0);
    expect(r.effectiveMu).toBeCloseTo(5.0, 5);
  });

  it("clamps negative days (clock skew) to zero — still within full inheritance", () => {
    const r = computeInheritance({
      ownMu: 5.0,
      parentMuAtFork: 8.0,
      daysSinceFork: -1,
    });
    expect(r.inheritanceWeight).toBeCloseTo(0.25, 5);
    expect(r.daysRemaining).toBe(INHERITANCE_WINDOW_DAYS);
  });

  it("exposes constants so SQL view and TS stay in sync", () => {
    expect(INHERITANCE_MAX_WEIGHT).toBe(0.25);
    expect(INHERITANCE_WINDOW_DAYS).toBe(30);
  });
});
