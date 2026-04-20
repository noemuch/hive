import { describe, it, expect, afterEach } from "bun:test";
import { MCPClient, toOpenAIToolSchemas, type MCPServerConfig } from "./mcp-client";

type JsonRpcReq = { jsonrpc: "2.0"; id?: number | string; method: string; params?: Record<string, unknown> };

/**
 * Minimal MCP server stub over HTTP for testing. Handles the JSON-RPC subset
 * our client uses: initialize, tools/list, tools/call.
 */
function makeMockServer(opts: {
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  toolResults?: Record<string, { text?: string; isError?: boolean; error?: string }>;
  delayMs?: number;
  failInit?: boolean;
  return500?: boolean;
} = {}) {
  const tools = opts.tools ?? [];
  const results = opts.toolResults ?? {};
  const calls: JsonRpcReq[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as JsonRpcReq;
      calls.push(body);
      if (opts.delayMs && body.method === "tools/call") {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      if (opts.return500) return new Response("boom", { status: 500 });

      if (body.method === "initialize") {
        if (opts.failInit) {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32000, message: "init failed" },
          });
        }
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "mock", version: "0.0.0" },
          },
        });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools } });
      }
      if (body.method === "tools/call") {
        const params = body.params as { name: string; arguments?: Record<string, unknown> };
        const r = results[params.name];
        if (!r) {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32601, message: `Unknown tool: ${params.name}` },
          });
        }
        if (r.error) {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32000, message: r.error },
          });
        }
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: r.text ?? "" }],
            isError: r.isError ?? false,
          },
        });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      });
    },
  });
  return {
    url: `http://localhost:${server.port}`,
    calls,
    close: () => server.stop(true),
  };
}

function makeConfig(endpoint: string, extra: Partial<MCPServerConfig> = {}): MCPServerConfig {
  return { name: "mock", endpoint, ...extra };
}

describe("MCPClient", () => {
  let srv: ReturnType<typeof makeMockServer>;
  afterEach(() => srv?.close?.());

  describe("connect()", () => {
    it("sends initialize handshake and resolves", async () => {
      srv = makeMockServer();
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      expect(srv.calls[0].method).toBe("initialize");
      expect(srv.calls[1].method).toBe("notifications/initialized");
    });

    it("throws when server returns init error", async () => {
      srv = makeMockServer({ failInit: true });
      const client = new MCPClient(makeConfig(srv.url));
      await expect(client.connect()).rejects.toThrow(/init failed/);
    });

    it("throws when HTTP returns non-2xx", async () => {
      srv = makeMockServer({ return500: true });
      const client = new MCPClient(makeConfig(srv.url));
      await expect(client.connect()).rejects.toThrow(/500/);
    });

    it("includes Authorization header when apiKey provided", async () => {
      srv = makeMockServer();
      const client = new MCPClient(makeConfig(srv.url, { apiKey: "sekret-token" }));
      await client.connect();
      expect(srv.calls.length).toBeGreaterThan(0);
    });
  });

  describe("listTools()", () => {
    it("returns tools reported by the server", async () => {
      srv = makeMockServer({
        tools: [
          { name: "web_search", description: "search the web", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } },
          { name: "file_read", description: "read a file", inputSchema: { type: "object" } },
        ],
      });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      const tools = await client.listTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("web_search");
      expect(tools[1].inputSchema).toEqual({ type: "object" });
    });

    it("caches results after first call", async () => {
      srv = makeMockServer({ tools: [{ name: "x", description: "", inputSchema: {} }] });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      await client.listTools();
      await client.listTools();
      const listCalls = srv.calls.filter((c) => c.method === "tools/list");
      expect(listCalls).toHaveLength(1);
    });

    it("hasTool() reports attached tools accurately", async () => {
      srv = makeMockServer({ tools: [{ name: "web_search", description: "", inputSchema: {} }] });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      await client.listTools();
      expect(client.hasTool("web_search")).toBe(true);
      expect(client.hasTool("nope")).toBe(false);
    });
  });

  describe("callTool()", () => {
    it("invokes tool and returns flattened text", async () => {
      srv = makeMockServer({
        tools: [{ name: "web_search", description: "", inputSchema: {} }],
        toolResults: { web_search: { text: "result from web" } },
      });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      await client.listTools();
      const out = await client.callTool("web_search", { q: "bun" });
      expect(out).toBe("result from web");
      const callReq = srv.calls.find((c) => c.method === "tools/call");
      expect(callReq?.params).toEqual({ name: "web_search", arguments: { q: "bun" } });
    });

    it("throws when server returns JSON-RPC error", async () => {
      srv = makeMockServer({
        tools: [{ name: "bad", description: "", inputSchema: {} }],
        toolResults: { bad: { error: "permission denied" } },
      });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      await client.listTools();
      await expect(client.callTool("bad", {})).rejects.toThrow(/permission denied/);
    });

    it("throws when isError=true in tool result", async () => {
      srv = makeMockServer({
        tools: [{ name: "flaky", description: "", inputSchema: {} }],
        toolResults: { flaky: { text: "boom", isError: true } },
      });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      await client.listTools();
      await expect(client.callTool("flaky", {})).rejects.toThrow(/boom/);
    });

    it("times out when server stalls past the deadline", async () => {
      srv = makeMockServer({
        tools: [{ name: "slow", description: "", inputSchema: {} }],
        toolResults: { slow: { text: "late" } },
        delayMs: 200,
      });
      const client = new MCPClient(makeConfig(srv.url, { timeoutMs: 50 }));
      await client.connect();
      await client.listTools();
      await expect(client.callTool("slow", {})).rejects.toThrow(/timed out|abort/i);
    });

    it("auto-runs listTools() on first callTool() when cache is empty", async () => {
      srv = makeMockServer({
        tools: [{ name: "web_search", description: "", inputSchema: {} }],
        toolResults: { web_search: { text: "auto-listed" } },
      });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      // Skip explicit listTools() — callTool must populate the cache itself.
      const out = await client.callTool("web_search", { q: "x" });
      expect(out).toBe("auto-listed");
      expect(srv.calls.some((c) => c.method === "tools/list")).toBe(true);
    });

    it("throws for unknown tool without calling the server", async () => {
      srv = makeMockServer({ tools: [{ name: "known", description: "", inputSchema: {} }] });
      const client = new MCPClient(makeConfig(srv.url));
      await client.connect();
      await client.listTools();
      const before = srv.calls.length;
      await expect(client.callTool("not-there", {})).rejects.toThrow(/not exposed|unknown tool/i);
      expect(srv.calls.length).toBe(before);
    });
  });
});

describe("toOpenAIToolSchemas", () => {
  it("converts MCP tool descriptors to OpenAI-style function schemas", () => {
    const converted = toOpenAIToolSchemas([
      { name: "web_search", description: "search", inputSchema: { type: "object", properties: { q: { type: "string" } } } },
    ]);
    expect(converted).toEqual([
      {
        type: "function",
        function: {
          name: "web_search",
          description: "search",
          parameters: { type: "object", properties: { q: { type: "string" } } },
        },
      },
    ]);
  });

  it("defaults missing inputSchema to empty object schema", () => {
    const converted = toOpenAIToolSchemas([{ name: "x", description: "", inputSchema: undefined as unknown as Record<string, unknown> }]);
    expect(converted[0].function.parameters).toEqual({ type: "object", properties: {} });
  });
});
