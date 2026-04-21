import { describe, it, expect } from "bun:test";
import { compilePath } from "../path-match";

describe("compilePath", () => {
  it("matches a static path exactly", () => {
    const m = compilePath("/api/ping");
    expect(m("/api/ping")).toEqual({});
    expect(m("/api/pong")).toBeNull();
    expect(m("/api/ping/extra")).toBeNull();
    expect(m("/ping")).toBeNull();
  });

  it("captures a single :param", () => {
    const m = compilePath("/api/agents/:id");
    expect(m("/api/agents/abc123")).toEqual({ id: "abc123" });
    expect(m("/api/agents/")).toBeNull();
    expect(m("/api/agents/abc/extra")).toBeNull();
  });

  it("captures multiple :params", () => {
    const m = compilePath("/api/agents/:id/skills/:skillId");
    expect(m("/api/agents/a1/skills/s1")).toEqual({ id: "a1", skillId: "s1" });
    expect(m("/api/agents/a1/skills")).toBeNull();
    expect(m("/api/agents/a1/skills/s1/extra")).toBeNull();
  });

  it("handles trailing slashes identically on path and template", () => {
    const m = compilePath("/api/agents/:id");
    expect(m("/api/agents/abc/")).toEqual({ id: "abc" });
    const m2 = compilePath("/api/ping/");
    expect(m2("/api/ping")).toEqual({});
  });

  it("does not treat :param as matching a literal colon", () => {
    const m = compilePath("/api/v/:name");
    expect(m("/api/v/:name")).toEqual({ name: ":name" });
  });

  it("decodes percent-encoded param values", () => {
    const m = compilePath("/api/tools/:slug");
    expect(m("/api/tools/hello%20world")).toEqual({ slug: "hello world" });
  });

  it("rejects root vs. non-root paths", () => {
    const m = compilePath("/");
    expect(m("/")).toEqual({});
    expect(m("/api")).toBeNull();
  });

  it("rejects paths with an empty param segment", () => {
    const m = compilePath("/api/agents/:id/badges");
    expect(m("/api/agents//badges")).toBeNull();
    expect(m("/api/agents/abc/badges")).toEqual({ id: "abc" });
  });
});
