import { describe, it, expect } from "bun:test";
import { detectCycle, dedupeIssues, parseIssueList } from "../new-initiative";

describe("detectCycle", () => {
  it("returns null when no cycle exists (linear chain)", () => {
    const plan = [
      { id: "a", dependsOn: [] },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ];
    expect(detectCycle(plan)).toBeNull();
  });

  it("detects direct cycle A->B->A", () => {
    const plan = [
      { id: "a", dependsOn: ["b"] },
      { id: "b", dependsOn: ["a"] },
    ];
    const cycle = detectCycle(plan);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(2);
  });

  it("detects indirect cycle A->B->C->A", () => {
    const plan = [
      { id: "a", dependsOn: ["c"] },
      { id: "b", dependsOn: ["a"] },
      { id: "c", dependsOn: ["b"] },
    ];
    expect(detectCycle(plan)).not.toBeNull();
  });

  it("handles multiple independent DAGs", () => {
    const plan = [
      { id: "a", dependsOn: [] },
      { id: "b", dependsOn: ["a"] },
      { id: "x", dependsOn: [] },
      { id: "y", dependsOn: ["x"] },
    ];
    expect(detectCycle(plan)).toBeNull();
  });

  it("handles self-loop", () => {
    const plan = [{ id: "a", dependsOn: ["a"] }];
    expect(detectCycle(plan)).not.toBeNull();
  });

  it("tolerates dep pointing at unknown id (external ref)", () => {
    const plan = [{ id: "a", dependsOn: ["external-99"] }];
    expect(detectCycle(plan)).toBeNull();
  });
});

describe("dedupeIssues", () => {
  it("returns existing issue numbers with similar titles", () => {
    const existing = [
      { number: 100, title: "feat: add agent profile v2" },
      { number: 200, title: "chore: bump deps" },
    ];
    expect(dedupeIssues("add agent profile v2", existing)).toEqual([100]);
  });

  it("ignores case + whitespace + punctuation", () => {
    const existing = [{ number: 100, title: "Feat: Add Agent-Profile V2!" }];
    expect(dedupeIssues("add agent profile v2", existing)).toEqual([100]);
  });

  it("returns empty when no match", () => {
    const existing = [{ number: 100, title: "rewrite auth" }];
    expect(dedupeIssues("add agent profile", existing)).toEqual([]);
  });

  it("matches across multiple", () => {
    const existing = [
      { number: 1, title: "add foo" },
      { number: 2, title: "Add FOO!" },
      { number: 3, title: "remove foo" },
    ];
    expect(dedupeIssues("add foo", existing).sort()).toEqual([1, 2]);
  });
});

describe("parseIssueList", () => {
  it("parses gh JSON output format", () => {
    const raw = '[{"number":1,"title":"a"},{"number":2,"title":"b"}]';
    expect(parseIssueList(raw)).toEqual([
      { number: 1, title: "a" },
      { number: 2, title: "b" },
    ]);
  });

  it("throws on non-array input", () => {
    expect(() => parseIssueList('{"number":1}')).toThrow();
  });
});
