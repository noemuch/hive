/**
 * LLM tool-call loop for Hive agents (#217).
 *
 * Drives the OpenAI-compatible chat-completions flow:
 *   system + user → LLM → (tool_calls?) → invoke MCP tools → feed back → LLM → …
 *
 * Capped iterations prevent runaway loops. Errors (tool down, bad args, missing
 * tool) are surfaced back to the LLM as `role: tool` messages so the model can
 * recover or decide to stop — a hard throw would let a flaky MCP server lock
 * the agent out of responding. See acceptance list on issue #217.
 */

import { MCPClient, toOpenAIToolSchemas, type OpenAIToolSchema } from "./mcp-client";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LLMResponse = {
  content?: string | null;
  tool_calls?: ToolCall[];
};

type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCallLoopOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens?: number;
  /** Max LLM round-trips before giving up. Default 5 — matches #217 spec. */
  maxIterations?: number;
  /** Per-LLM-call timeout. Default 30s — same as `callLLM` in agent.ts. */
  timeoutMs?: number;
  logger?: { log: (m: string) => void; error: (m: string) => void };
};

const DEFAULT_MAX_ITERATIONS = 5;
const DEFAULT_LLM_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 400;

export async function runWithTools(
  systemPrompt: string,
  userPrompt: string,
  clients: MCPClient[],
  opts: ToolCallLoopOptions,
): Promise<string | null> {
  const maxIterations = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const logger = opts.logger ?? { log: () => {}, error: (m) => console.error(m) };

  const toolSchemas = await collectToolSchemas(clients);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const response = await callLLMWithTools(messages, toolSchemas, opts);
    if (!response) return null;

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return (response.content ?? "").trim() || null;
    }

    messages.push({
      role: "assistant",
      content: response.content ?? null,
      tool_calls: response.tool_calls,
    });

    for (const call of response.tool_calls) {
      const toolMessage = await invokeTool(call, clients, logger);
      messages.push(toolMessage);
    }
  }

  logger.error(`[tool-loop] hit max iterations (${maxIterations}) without final text`);
  return null;
}

async function collectToolSchemas(clients: MCPClient[]): Promise<OpenAIToolSchema[]> {
  const all: OpenAIToolSchema[] = [];
  for (const client of clients) {
    try {
      const tools = await client.listTools();
      all.push(...toOpenAIToolSchemas(tools));
    } catch (err) {
      console.error(`[tool-loop] could not list tools from "${client.name}":`, (err as Error).message);
    }
  }
  return all;
}

async function invokeTool(
  call: ToolCall,
  clients: MCPClient[],
  logger: { log: (m: string) => void; error: (m: string) => void },
): Promise<Extract<ChatMessage, { role: "tool" }>> {
  const name = call.function.name;
  const owner = clients.find((c) => c.hasTool(name));
  if (!owner) {
    const msg = `Tool "${name}" is not available to this agent.`;
    logger.error(`[tool-loop] ${msg}`);
    return { role: "tool", tool_call_id: call.id, content: msg };
  }
  const args = parseArguments(call.function.arguments);
  try {
    const result = await owner.callTool(name, args);
    logger.log(`[tool-loop] ${owner.name}/${name} → ${result.slice(0, 80)}${result.length > 80 ? "…" : ""}`);
    return { role: "tool", tool_call_id: call.id, content: result };
  } catch (err) {
    const message = (err as Error).message;
    logger.error(`[tool-loop] ${owner.name}/${name} failed: ${message}`);
    return { role: "tool", tool_call_id: call.id, content: `ERROR: ${message}` };
  }
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function callLLMWithTools(
  messages: ChatMessage[],
  tools: OpenAIToolSchema[],
  opts: ToolCallLoopOptions,
): Promise<LLMResponse | null> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
  const payload: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages,
  };
  if (tools.length > 0) {
    payload.tools = tools;
    payload.tool_choice = "auto";
  }
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[tool-loop] LLM HTTP ${res.status} ${res.statusText}`);
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
    };
    const msg = data.choices?.[0]?.message;
    if (!msg) return null;
    return { content: msg.content ?? null, tool_calls: msg.tool_calls };
  } catch (err) {
    clearTimeout(timer);
    console.error(`[tool-loop] LLM call failed:`, (err as Error).message);
    return null;
  }
}
