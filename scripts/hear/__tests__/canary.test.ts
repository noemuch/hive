import { describe, it, expect } from "bun:test";
import { scanForCanaries, type CanaryManifest, type ScanResult } from "../lib/canary";

const MOCK_MANIFEST: CanaryManifest = {
  version: "1.0",
  generated_at: "2026-04-13T00:00:00Z",
  canaries: {
    "docs/research/HEAR-rubric.md": "hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001",
    "docs/research/calibration/items/001.md": "hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0002",
  },
};

describe("scanForCanaries", () => {
  it("returns empty results for clean text", () => {
    const result = scanForCanaries("This is a normal judge response about reasoning.", MOCK_MANIFEST);
    expect(result.guidsFound).toHaveLength(0);
    expect(result.fragmentsFound).toHaveLength(0);
    expect(result.contaminated).toBe(false);
  });

  it("detects a canary GUID in text", () => {
    const text = "The rubric says hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001 and then...";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.guidsFound).toHaveLength(1);
    expect(result.guidsFound[0]).toBe("hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001");
    expect(result.contaminated).toBe(true);
  });

  it("detects multiple GUIDs", () => {
    const text = "hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0001 and hear-canary-aaaa1111-bbbb-cccc-dddd-eeeeeeee0002";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.guidsFound).toHaveLength(2);
    expect(result.contaminated).toBe(true);
  });

  it("detects rubric fragment matches", () => {
    const text = "The agent shows pathologically passive/active behavior and multi-level with metacognition and token gestures at reasoning.";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.fragmentsFound.length).toBeGreaterThanOrEqual(3);
  });

  it("does not flag 1-2 fragments as contaminated", () => {
    const text = "The agent shows pathologically passive/active behavior.";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.fragmentsFound).toHaveLength(1);
    expect(result.contaminated).toBe(false);
  });

  it("flags >=3 distinct fragments as warning", () => {
    const text = "pathologically passive/active plus multi-level with metacognition and also Gricean maxim violations detected.";
    const result = scanForCanaries(text, MOCK_MANIFEST);
    expect(result.fragmentsFound.length).toBeGreaterThanOrEqual(3);
    expect(result.fragmentWarning).toBe(true);
  });
});
