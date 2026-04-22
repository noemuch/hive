import { describe, it, expect } from "bun:test";
import { buildAgentSvg, renderAgentOg, type AgentOgInput } from "../render";

const BASE: AgentOgInput = {
  name: "Atlas",
  role: "developer",
  avatar_seed: "atlas-seed",
  score_state_mu: 7.4,
  bureau_name: "Lyse",
  llm_provider: "mistral",
};

describe("buildAgentSvg", () => {
  it("produces a 1200×630 SVG containing the agent's fields", () => {
    const svg = buildAgentSvg(BASE);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
    expect(svg).toContain(">Atlas<");
    expect(svg).toContain("developer @ Lyse");
    expect(svg).toContain("mistral");
    expect(svg).toContain(">7.4<");
  });

  it("shows em-dash + empty-state label when score is null", () => {
    const svg = buildAgentSvg({ ...BASE, score_state_mu: null });
    expect(svg).toContain(">—<");
    expect(svg).toContain("Not evaluated yet");
  });

  it("omits the 'Powered by' line when llm_provider is null", () => {
    const svg = buildAgentSvg({ ...BASE, llm_provider: null });
    expect(svg).not.toContain("Powered by");
  });

  it("drops the bureau segment when bureau_name is null", () => {
    const svg = buildAgentSvg({ ...BASE, bureau_name: null });
    expect(svg).not.toContain("@");
    expect(svg).toContain(">developer<");
  });

  it("escapes XML-unsafe characters in user-controlled fields", () => {
    const svg = buildAgentSvg({
      ...BASE,
      name: "<script>alert(1)</script>",
      bureau_name: 'A"B',
    });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&quot;");
  });

  it("truncates overly long names so the layout doesn't overflow", () => {
    const longName = "A".repeat(80);
    const svg = buildAgentSvg({ ...BASE, name: longName });
    // The rendered text node is the escaped+truncated form; must end with an ellipsis
    // and be materially shorter than the original.
    expect(svg).toContain("…");
    expect(svg).not.toContain("A".repeat(80));
  });

  it("embeds the DiceBear avatar SVG inline (no data URI)", () => {
    const svg = buildAgentSvg(BASE);
    // DiceBear pixelArt always emits <g> groups for hair/eyes/etc. Inline
    // means those elements appear directly inside our outer <svg>.
    expect(svg).toMatch(/<svg[^>]*x="80"[^>]*viewBox/);
    expect(svg).not.toContain("data:image/svg");
  });
});

describe("renderAgentOg", () => {
  it("returns a valid PNG byte buffer", () => {
    const png = renderAgentOg(BASE);
    expect(png.length).toBeGreaterThan(0);
    // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
  });

  it("renders null-score agents without throwing", () => {
    const png = renderAgentOg({ ...BASE, score_state_mu: null, llm_provider: null, bureau_name: null });
    expect(png.length).toBeGreaterThan(0);
    expect(png[0]).toBe(0x89);
  });
});
