import { describe, it, expect } from "bun:test";
import { pickRenderer } from "../ArtifactViewer";
import { parseUnifiedDiff } from "../renderers/DiffRenderer";

describe("pickRenderer", () => {
  it("routes legacy text types to the text renderer", () => {
    for (const t of ["ticket", "spec", "decision", "component", "pr", "document"]) {
      expect(pickRenderer(t)).toBe("text");
    }
  });

  it("routes message to the text renderer", () => {
    expect(pickRenderer("message")).toBe("text");
  });

  it("routes code_diff to the diff renderer", () => {
    expect(pickRenderer("code_diff")).toBe("diff");
  });

  it("routes image to the image renderer", () => {
    expect(pickRenderer("image")).toBe("image");
  });

  it("routes report to the report renderer", () => {
    expect(pickRenderer("report")).toBe("report");
  });

  it("routes non-launch types (audio/video/action_trace/structured_json/embedding) to fallback", () => {
    for (const t of ["audio", "video", "action_trace", "structured_json", "embedding"]) {
      expect(pickRenderer(t)).toBe("fallback");
    }
  });

  it("degrades unknown future types to fallback", () => {
    expect(pickRenderer("hologram")).toBe("fallback");
  });
});

describe("parseUnifiedDiff", () => {
  it("classifies file header lines as meta", () => {
    const lines = parseUnifiedDiff("--- a/foo.ts\n+++ b/foo.ts");
    expect(lines).toHaveLength(2);
    expect(lines[0].kind).toBe("meta");
    expect(lines[1].kind).toBe("meta");
  });

  it("classifies add/remove prefixes correctly", () => {
    const lines = parseUnifiedDiff("+added\n-removed\n context");
    expect(lines[0]).toEqual({ kind: "add", text: "+added" });
    expect(lines[1]).toEqual({ kind: "remove", text: "-removed" });
    expect(lines[2]).toEqual({ kind: "context", text: " context" });
  });

  it("classifies hunk header as meta", () => {
    const lines = parseUnifiedDiff("@@ -1,3 +1,4 @@");
    expect(lines[0].kind).toBe("meta");
  });

  it("classifies `diff --git` preamble as meta (not as remove)", () => {
    // Without meta precedence, `diff --git` would be misclassified as "remove"
    // because it starts with 'd' then '--' isn't a prefix but the full content
    // would need the explicit meta rule. Regression guard.
    const lines = parseUnifiedDiff("diff --git a/foo b/foo\n--- a/foo\n+++ b/foo");
    expect(lines[0].kind).toBe("meta");
  });

  it("preserves empty lines as context (no crash on split artefacts)", () => {
    const lines = parseUnifiedDiff("context\n\n+added");
    expect(lines).toHaveLength(3);
    expect(lines[1].kind).toBe("context");
    expect(lines[1].text).toBe("");
  });
});
