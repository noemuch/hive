import { describe, it, expect } from "bun:test";
import {
  qualifiesFor30DayProven,
  qualifiesFor90DayProven,
  qualifiesFor1000Artifacts,
  qualifiesForPolyglot,
  topNPercentThreshold,
  BADGE_TYPES,
  type BadgeType,
} from "../award-badges";

describe("BADGE_TYPES", () => {
  it("lists all six badge types from issue #226", () => {
    expect(BADGE_TYPES).toEqual([
      "30-day-proven",
      "90-day-proven",
      "top-10-pct-role",
      "1000-artifacts",
      "mistral-champion",
      "polyglot",
    ]);
  });
});

describe("qualifiesFor30DayProven", () => {
  it("returns true when tenure ≥ 30 days and score ≥ 7", () => {
    expect(qualifiesFor30DayProven({ tenureDays: 30, scoreMu: 7 })).toBe(true);
    expect(qualifiesFor30DayProven({ tenureDays: 45, scoreMu: 8.5 })).toBe(true);
  });

  it("returns false when tenure < 30 days", () => {
    expect(qualifiesFor30DayProven({ tenureDays: 29, scoreMu: 9 })).toBe(false);
  });

  it("returns false when score < 7", () => {
    expect(qualifiesFor30DayProven({ tenureDays: 60, scoreMu: 6.99 })).toBe(false);
  });

  it("returns false when score is null (not yet evaluated)", () => {
    expect(qualifiesFor30DayProven({ tenureDays: 60, scoreMu: null })).toBe(false);
  });
});

describe("qualifiesFor90DayProven", () => {
  it("returns true when tenure ≥ 90 days and score ≥ 7.5", () => {
    expect(qualifiesFor90DayProven({ tenureDays: 90, scoreMu: 7.5 })).toBe(true);
  });

  it("returns false when tenure < 90 days (even if score is high)", () => {
    expect(qualifiesFor90DayProven({ tenureDays: 89, scoreMu: 9 })).toBe(false);
  });

  it("returns false when score < 7.5", () => {
    expect(qualifiesFor90DayProven({ tenureDays: 120, scoreMu: 7.49 })).toBe(false);
  });

  it("returns false when score is null", () => {
    expect(qualifiesFor90DayProven({ tenureDays: 120, scoreMu: null })).toBe(false);
  });
});

describe("qualifiesFor1000Artifacts", () => {
  it("returns true at exactly 1000 artifacts", () => {
    expect(qualifiesFor1000Artifacts(1000)).toBe(true);
  });

  it("returns true above 1000", () => {
    expect(qualifiesFor1000Artifacts(5000)).toBe(true);
  });

  it("returns false below 1000", () => {
    expect(qualifiesFor1000Artifacts(999)).toBe(false);
    expect(qualifiesFor1000Artifacts(0)).toBe(false);
  });
});

describe("qualifiesForPolyglot", () => {
  it("returns true when ≥ 3 specializations", () => {
    expect(qualifiesForPolyglot(["backend", "frontend", "data"])).toBe(true);
    expect(qualifiesForPolyglot(["a", "b", "c", "d"])).toBe(true);
  });

  it("returns false when < 3 specializations", () => {
    expect(qualifiesForPolyglot([])).toBe(false);
    expect(qualifiesForPolyglot(["backend"])).toBe(false);
    expect(qualifiesForPolyglot(["backend", "frontend"])).toBe(false);
  });

  it("de-duplicates specializations (case-insensitive)", () => {
    expect(qualifiesForPolyglot(["Backend", "backend", "Frontend"])).toBe(false);
    expect(qualifiesForPolyglot(["Backend", "frontend", "Data", "backend"])).toBe(true);
  });

  it("ignores empty/whitespace entries", () => {
    expect(qualifiesForPolyglot(["backend", "", "  ", "frontend"])).toBe(false);
    expect(qualifiesForPolyglot(["backend", "", "frontend", "data", " "])).toBe(true);
  });
});

describe("topNPercentThreshold", () => {
  it("returns the mu value at the top-10% cutoff", () => {
    // 10 agents: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] — top 10% = index 0 = mu 10
    const scores = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    expect(topNPercentThreshold(scores, 10)).toBe(10);
  });

  it("returns the cutoff score for top-10% in a larger group", () => {
    // 20 agents, top 10% = 2 agents (indexes 0, 1) — cutoff is the 2nd-highest
    const scores = [10, 9.5, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    expect(topNPercentThreshold(scores, 10)).toBe(9.5);
  });

  it("returns null for empty input", () => {
    expect(topNPercentThreshold([], 10)).toBe(null);
  });

  it("returns null when every score is null", () => {
    expect(topNPercentThreshold([null, null], 10)).toBe(null);
  });

  it("filters out null scores before computing cutoff", () => {
    const scores = [10, null, 9, null, 8, 7, 6, 5, 4, 3, 2, 1];
    // 10 non-null scores, top-10% = top-1 = mu 10
    expect(topNPercentThreshold(scores, 10)).toBe(10);
  });

  it("rounds up the cutoff count (always at least one winner)", () => {
    // 5 agents, top-10% of 5 = 0.5 → at least 1 winner
    const scores = [10, 9, 8, 7, 6];
    expect(topNPercentThreshold(scores, 10)).toBe(10);
  });
});
