import { describe, it, expect, afterEach } from "bun:test";
import { runWithTools, type LLMResponse, type ToolCallLoopOptions } from "./tool-loop";
import { MCPClient } from "./mcp-client";

type StubToolConfig = { name: string; result?: string; error?: string };

/**
 * Minimal `fetch` mock swapped into `globalThis` for the duration of a test.
 * Responds with a queue of pre-canned `LLMResponse`s mapped to the fake
 * OpenAI-compatible chat-completions payload.
 */
function installLLMMock(queue: LLMResponse[]) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse((init?.body as string) ?? "{}");
    calls.push({ body });
    if (i >= queue.length) throw new Error(`LLM mock ran out of responses (${i})`);
    const choice = queue[i++];
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: choice.content ?? null,
              tool_calls: choice.tool_calls ?? undefined,
            },
            finish_reason: choice.tool_calls ? "tool_calls" : "stop",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/**
 * Stub MCPClient wrapping an in-memory tool table. Avoids spinning up a real
 * HTTP server for tool-loop tests.
 */
function makeStubClient(tools: StubToolConfig[]): MCPClient {
  const client = new MCPClient({ name: "stub", endpoint: "http://stub.invalid" });
  (client as unknown as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools =
    tools.map((t) => ({ name: t.name, description: "", inputSchema: { type: "object" } }));
  client.listTools = async () =>
    (client as unknown as { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }).tools;
  client.hasTool = (name: string) => tools.some((t) => t.name === name);
  client.callTool = async (name: string, _args: Record<string, unknown>) => {
    const t = tools.find((x) => x.name === name);
    if (!t) throw new Error(`unknown tool ${name}`);
    if (t.error) throw new Error(t.error);
    return t.result ?? "";
  };
  return client;
}

const baseOpts: ToolCallLoopOptions = {
  baseUrl: "http://llm.invalid",
  apiKey: "test",
  model: "mock-model",
  maxTokens: 200,
};

describe("runWithTools", () => {
  let mock: ReturnType<typeof installLLMMock>;
  afterEach(() => mock?.restore?.());

  it("returns text immediately when LLM produces no tool_calls", async () => {
    mock = installLLMMock([{ content: "hello world" }]);
    const out = await runWithTools("sys", "user", [], baseOpts);
    expect(out).toBe("hello world");
    expect(mock.calls).toHaveLength(1);
    // No tools attached → no `tools` field in request
    expect(mock.calls[0].body.tools).toBeUndefined();
  });

  it("exposes tool schemas to the LLM when clients are attached", async () => {
    mock = installLLMMock([{ content: "final answer" }]);
    const client = makeStubClient([{ name: "web_search", result: "results" }]);
    await runWithTools("sys", "user", [client], baseOpts);
    const tools = mock.calls[0].body.tools as Array<{ function: { name: string } }>;
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("web_search");
  });

  it("invokes requested tool, feeds result back, loops until final text", async () => {
    mock = installLLMMock([
      {
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "web_search", arguments: JSON.stringify({ q: "bun" }) } },
        ],
      },
      { content: "the answer is bun" },
    ]);
    const client = makeStubClient([{ name: "web_search", result: "bun is a runtime" }]);
    const out = await runWithTools("sys", "user", [client], baseOpts);
    expect(out).toBe("the answer is bun");
    expect(mock.calls).toHaveLength(2);
    // Second call must carry the tool result back as a `tool` message.
    const msgs = mock.calls[1].body.messages as Array<{ role: string; tool_call_id?: string; content?: unknown }>;
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_1");
    expect(toolMsg?.content).toBe("bun is a runtime");
  });

  it("stops at maxIterations and returns null when no final text emerges", async () => {
    mock = installLLMMock([
      { tool_calls: [{ id: "a", type: "function", function: { name: "web_search", arguments: "{}" } }] },
      { tool_calls: [{ id: "b", type: "function", function: { name: "web_search", arguments: "{}" } }] },
      { tool_calls: [{ id: "c", type: "function", function: { name: "web_search", arguments: "{}" } }] },
    ]);
    const client = makeStubClient([{ name: "web_search", result: "ok" }]);
    const out = await runWithTools("sys", "user", [client], { ...baseOpts, maxIterations: 3 });
    expect(out).toBeNull();
    expect(mock.calls).toHaveLength(3);
  });

  it("surfaces tool errors as tool messages and continues the loop", async () => {
    mock = installLLMMock([
      { tool_calls: [{ id: "a", type: "function", function: { name: "broken", arguments: "{}" } }] },
      { content: "recovered" },
    ]);
    const client = makeStubClient([{ name: "broken", error: "upstream 500" }]);
    const out = await runWithTools("sys", "user", [client], baseOpts);
    expect(out).toBe("recovered");
    const msgs = mock.calls[1].body.messages as Array<{ role: string; content?: string }>;
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg?.content).toContain("upstream 500");
  });

  it("reports an error to the LLM when no client exposes the requested tool", async () => {
    mock = installLLMMock([
      { tool_calls: [{ id: "a", type: "function", function: { name: "ghost", arguments: "{}" } }] },
      { content: "ok fine" },
    ]);
    const client = makeStubClient([{ name: "real_tool" }]);
    const out = await runWithTools("sys", "user", [client], baseOpts);
    expect(out).toBe("ok fine");
    const msgs = mock.calls[1].body.messages as Array<{ role: string; content?: string }>;
    const toolMsg = msgs.find((m) => m.role === "tool");
    expect(toolMsg?.content).toMatch(/not available|unknown/i);
  });

  it("tolerates malformed tool-call arguments by passing an empty object", async () => {
    mock = installLLMMock([
      { tool_calls: [{ id: "a", type: "function", function: { name: "web_search", arguments: "<<not json>>" } }] },
      { content: "done" },
    ]);
    const client = makeStubClient([{ name: "web_search", result: "ok" }]);
    const out = await runWithTools("sys", "user", [client], baseOpts);
    expect(out).toBe("done");
    // The loop must not throw; it falls back to {} args.
    expect(mock.calls).toHaveLength(2);
  });

  it("returns null when the LLM call itself fails", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("no", { status: 500 })) as typeof fetch;
    try {
      const out = await runWithTools("sys", "user", [], baseOpts);
      expect(out).toBeNull();
    } finally {
      globalThis.fetch = original;
    }
  });
});
