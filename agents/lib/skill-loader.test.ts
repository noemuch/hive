import { describe, it, expect } from "bun:test";
import {
  estimateTokens,
  scoreSkill,
  pickRelevantSkills,
  buildSkillsContext,
  composeSystemPromptWithSkills,
  fetchAgentSkills,
  type AgentSkill,
} from "./skill-loader";

const AGENT_ID = "33333333-3333-3333-3333-333333333333";

function skill(partial: Partial<AgentSkill> & { slug: string; title: string }): AgentSkill {
  return {
    id: partial.id ?? "00000000-0000-0000-0000-000000000000",
    slug: partial.slug,
    title: partial.title,
    description: partial.description ?? null,
    content_md: partial.content_md ?? "",
    category: partial.category ?? null,
    version: partial.version ?? null,
  };
}

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("uses char/4 heuristic rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("scoreSkill", () => {
  it("returns 0 when no tokens match", () => {
    const s = skill({ slug: "cold-email", title: "Cold email writer", description: "helps with outbound sales" });
    expect(scoreSkill("hello world", s)).toBe(0);
  });

  it("gives highest weight to slug token hits", () => {
    const s = skill({ slug: "cold-email", title: "Unrelated title", description: "unrelated" });
    expect(scoreSkill("write a cold email today", s)).toBeGreaterThan(0);
  });

  it("weights slug > title > description", () => {
    const slugOnly = skill({ slug: "alpha-beta", title: "xyz", description: "qqq" });
    const titleOnly = skill({ slug: "zzz-yyy", title: "alpha", description: "qqq" });
    const descOnly = skill({ slug: "zzz-yyy", title: "xyz", description: "alpha" });
    const msg = "alpha";
    expect(scoreSkill(msg, slugOnly)).toBeGreaterThan(scoreSkill(msg, titleOnly));
    expect(scoreSkill(msg, titleOnly)).toBeGreaterThan(scoreSkill(msg, descOnly));
  });

  it("is case-insensitive", () => {
    const s = skill({ slug: "testing", title: "Testing guide", description: null });
    expect(scoreSkill("TESTING is important", s)).toBeGreaterThan(0);
  });

  it("ignores short tokens (< 3 chars) to avoid noise", () => {
    const s = skill({ slug: "an-it", title: "a b c", description: "i is" });
    expect(scoreSkill("an it is a", s)).toBe(0);
  });
});

describe("pickRelevantSkills", () => {
  it("returns [] when no skills provided", () => {
    expect(pickRelevantSkills("anything", [], 8000)).toEqual([]);
  });

  it("returns [] when no skill scores > 0", () => {
    const skills = [skill({ slug: "foo", title: "Foo" })];
    expect(pickRelevantSkills("xyz unrelated", skills, 8000)).toEqual([]);
  });

  it("returns skills sorted by score descending", () => {
    // a hits on slug + title + description → 3+2+1 = 6
    // b hits on title + description only  → 2+1 = 3
    const a = skill({ slug: "alpha", title: "alpha", description: "alpha" });
    const b = skill({ slug: "zzz-yyy", title: "beta", description: "beta" });
    const picked = pickRelevantSkills("alpha beta", [b, a], 8000);
    expect(picked[0].slug).toBe("alpha");
    expect(picked[1].slug).toBe("zzz-yyy");
  });

  it("respects token budget by skipping low-score skills that would exceed it", () => {
    const big = skill({
      slug: "small-match",
      title: "match",
      content_md: "x".repeat(40_000),
    });
    const small = skill({
      slug: "match-direct",
      title: "match",
      content_md: "x".repeat(200),
    });
    const picked = pickRelevantSkills("match please", [big, small], 1000);
    expect(picked.map((s) => s.slug)).toEqual(["match-direct"]);
  });

  it("keeps picked set within token budget", () => {
    const s1 = skill({ slug: "alpha-match", title: "alpha", content_md: "x".repeat(3000) });
    const s2 = skill({ slug: "beta-match", title: "beta", content_md: "x".repeat(3000) });
    const s3 = skill({ slug: "gamma-match", title: "gamma", content_md: "x".repeat(3000) });
    const picked = pickRelevantSkills("alpha beta gamma", [s1, s2, s3], 1500);
    const used = picked.reduce((sum, s) => sum + estimateTokens(s.content_md), 0);
    expect(used).toBeLessThanOrEqual(1500);
  });
});

describe("buildSkillsContext", () => {
  it("returns empty string for empty array", () => {
    expect(buildSkillsContext([])).toBe("");
  });

  it("formats skills as ### Skill: <title> + content_md", () => {
    const skills = [
      skill({ slug: "a", title: "First", content_md: "body 1" }),
      skill({ slug: "b", title: "Second", content_md: "body 2" }),
    ];
    const ctx = buildSkillsContext(skills);
    expect(ctx).toContain("### Skill: First");
    expect(ctx).toContain("body 1");
    expect(ctx).toContain("### Skill: Second");
    expect(ctx).toContain("body 2");
  });
});

describe("composeSystemPromptWithSkills", () => {
  it("returns base prompt unchanged when no skills match", () => {
    const base = "You are X.";
    const { prompt, picked } = composeSystemPromptWithSkills(base, "hello world", [], 8000);
    expect(prompt).toBe(base);
    expect(picked).toEqual([]);
  });

  it("appends skills section when skills match", () => {
    const base = "You are X.";
    const skills = [skill({ slug: "relevant", title: "Relevant", content_md: "HOW TO" })];
    const { prompt, picked } = composeSystemPromptWithSkills(base, "use relevant now", skills, 8000);
    expect(prompt).toContain(base);
    expect(prompt).toContain("### Skill: Relevant");
    expect(prompt).toContain("HOW TO");
    expect(picked).toHaveLength(1);
  });
});

describe("fetchAgentSkills", () => {
  it("GETs the correct URL with Bearer auth", async () => {
    let captured: { url?: string; init?: RequestInit } = {};
    const fakeFetch: typeof fetch = async (url, init) => {
      captured = { url: url.toString(), init };
      return new Response(JSON.stringify({ skills: [] }), { status: 200 });
    };
    await fetchAgentSkills(AGENT_ID, "api-key-123", "http://localhost:3000", fakeFetch);
    expect(captured.url).toBe(`http://localhost:3000/api/agents/${AGENT_ID}/skills`);
    expect((captured.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer api-key-123"
    );
  });

  it("strips trailing slashes from apiUrl", async () => {
    let capturedUrl = "";
    const fakeFetch: typeof fetch = async (url) => {
      capturedUrl = url.toString();
      return new Response(JSON.stringify({ skills: [] }), { status: 200 });
    };
    await fetchAgentSkills(AGENT_ID, "k", "http://localhost:3000///", fakeFetch);
    expect(capturedUrl).toBe(`http://localhost:3000/api/agents/${AGENT_ID}/skills`);
  });

  it("returns skills array on success", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          skills: [{ id: "a", slug: "x", title: "X", description: null, content_md: "" }],
        }),
        { status: 200 }
      );
    const skills = await fetchAgentSkills(AGENT_ID, "k", "http://h", fakeFetch);
    expect(skills).toHaveLength(1);
    expect(skills[0].slug).toBe("x");
  });

  it("returns [] on 404 (endpoint not yet deployed / no attachments)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("not found", { status: 404 });
    const skills = await fetchAgentSkills(AGENT_ID, "k", "http://h", fakeFetch);
    expect(skills).toEqual([]);
  });

  it("returns [] on network error", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const skills = await fetchAgentSkills(AGENT_ID, "k", "http://h", fakeFetch);
    expect(skills).toEqual([]);
  });

  it("returns [] on malformed response shape", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ unrelated: 1 }), { status: 200 });
    const skills = await fetchAgentSkills(AGENT_ID, "k", "http://h", fakeFetch);
    expect(skills).toEqual([]);
  });
});
