import { describe, it, expect, afterAll, beforeAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverRoutes, sortRoutes } from "../discovery";
import type { Route } from "../route-types";

const handlerTpl = (method: string, path: string, tag: string) => `
import type { Route } from "${process.cwd()}/src/router/route-types";

export const routes: Route[] = [
  {
    method: "${method}",
    path: "${path}",
    handler: () => new Response("${tag}", { status: 200 }),
  },
];
`;

describe("discoverRoutes", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "hive-discovery-"));
    writeFileSync(join(tmp, "alpha.ts"), handlerTpl("GET", "/api/alpha", "alpha"));
    writeFileSync(join(tmp, "beta.ts"), handlerTpl("GET", "/api/beta/:id", "beta"));
    writeFileSync(join(tmp, "beta.test.ts"), `// should be skipped\n`);
    writeFileSync(join(tmp, "shared-helper.ts"), `export const UUID_RE = /./;\n`);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("picks up routes from every .ts handler file and skips *.test.ts and helpers", async () => {
    const routes = await discoverRoutes(tmp);
    const signatures = routes.map((r) => `${r.method} ${r.path}`);
    expect(signatures).toContain("GET /api/alpha");
    expect(signatures).toContain("GET /api/beta/:id");
    expect(routes.length).toBe(2);
  });

  it("a handler added to the directory appears on next discovery — the core concurrency-safe property", async () => {
    writeFileSync(join(tmp, "gamma.ts"), handlerTpl("POST", "/api/gamma", "gamma"));
    const routes = await discoverRoutes(tmp);
    const gamma = routes.find((r) => r.path === "/api/gamma");
    expect(gamma).toBeDefined();
    expect(gamma?.method).toBe("POST");
    const response = await gamma!.handler({
      req: new Request("http://localhost/api/gamma", { method: "POST" }),
      url: new URL("http://localhost/api/gamma"),
      params: {},
      // Shape-only for type safety; the stub handler never touches these.
      pool: {} as never,
      server: {} as never,
      ip: "127.0.0.1",
    });
    expect(response).toBeDefined();
    expect((response as Response).status).toBe(200);
  });

  it("throws on duplicate (method, path) entries — surfaces authoring mistakes", async () => {
    const dupTmp = mkdtempSync(join(tmpdir(), "hive-discovery-dup-"));
    try {
      writeFileSync(dupTmp + "/a.ts", handlerTpl("GET", "/api/dup", "a"));
      writeFileSync(dupTmp + "/b.ts", handlerTpl("GET", "/api/dup", "b"));
      await expect(discoverRoutes(dupTmp)).rejects.toThrow(/Duplicate route/);
    } finally {
      rmSync(dupTmp, { recursive: true, force: true });
    }
  });
});

describe("sortRoutes", () => {
  const mkRoute = (method: string, path: string, predicate?: () => boolean): Route => ({
    method,
    path,
    predicate,
    handler: () => new Response("ok"),
  });

  it("sorts static segments before parametric for the same prefix", () => {
    const sorted = sortRoutes([
      mkRoute("GET", "/api/agents/:id"),
      mkRoute("GET", "/api/agents/marketplace"),
    ]);
    expect(sorted[0].path).toBe("/api/agents/marketplace");
    expect(sorted[1].path).toBe("/api/agents/:id");
  });

  it("places predicate-gated routes before unqualified ones sharing the same path", () => {
    const sorted = sortRoutes([
      mkRoute("GET", "/api/leaderboard"),
      mkRoute("GET", "/api/leaderboard", () => true),
    ]);
    expect(sorted[0].predicate).toBeDefined();
    expect(sorted[1].predicate).toBeUndefined();
  });

  it("picks longer paths first when static counts tie (finer-grained before catch-all)", () => {
    const sorted = sortRoutes([
      mkRoute("GET", "/api/agents/:id"),
      mkRoute("GET", "/api/agents/:id/reviews"),
    ]);
    expect(sorted[0].path).toBe("/api/agents/:id/reviews");
  });
});
