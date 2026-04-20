/**
 * Minimal MCP (Model Context Protocol) client over Streamable HTTP transport.
 *
 * Covers the JSON-RPC 2.0 subset Hive agents need:
 *   - `initialize`       — handshake
 *   - `tools/list`       — discover exposed tools
 *   - `tools/call`       — invoke a tool and collect its text output
 *
 * Intentionally single-file and dependency-free (uses `fetch`) to match the
 * `callLLM` convention in `agent.ts` and avoid pulling in the full
 * `@modelcontextprotocol/sdk` for what is a narrow runtime need (#217).
 * Streamed/SSE responses and stdio transport are NOT implemented — HTTP
 * suffices for the tools Hive agents will call in Phase 5 (web_search,
 * file_read, code_interpreter-style shims).
 */

export type MCPServerConfig = {
  /** Human-readable name — used in logs + to pick which client owns a tool. */
  name: string;
  /** Fully-qualified MCP HTTP endpoint, e.g. `https://tools.example.com/mcp`. */
  endpoint: string;
  /** Optional bearer token attached as `Authorization: Bearer <apiKey>`. */
  apiKey?: string;
  /** Per-request timeout (default 15s). */
  timeoutMs?: number;
};

export type MCPTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type OpenAIToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const DEFAULT_TIMEOUT_MS = 15_000;
const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcResponse<T> = {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
};

export class MCPClient {
  readonly name: string;
  private endpoint: string;
  private apiKey?: string;
  private timeoutMs: number;
  private nextId = 1;
  private connected = false;
  private tools: MCPTool[] | null = null;

  constructor(cfg: MCPServerConfig) {
    this.name = cfg.name;
    this.endpoint = cfg.endpoint;
    this.apiKey = cfg.apiKey;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async connect(): Promise<void> {
    await this.rpc<{ protocolVersion: string }>("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: {} },
      clientInfo: { name: "hive-agent", version: "0.1.0" },
    });
    // Per MCP spec: fire-and-forget notification. We still POST it so the
    // server knows the client is ready — but we don't wait on a response id.
    await this.rpc<unknown>("notifications/initialized", {}, { isNotification: true });
    this.connected = true;
  }

  async listTools(force = false): Promise<MCPTool[]> {
    if (this.tools && !force) return this.tools;
    const result = await this.rpc<{ tools: MCPTool[] }>("tools/list", {});
    this.tools = result.tools ?? [];
    return this.tools;
  }

  hasTool(name: string): boolean {
    return !!this.tools?.some((t) => t.name === name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    // Auto-populate the cache on first use so callers who instantiate
    // MCPClient directly (e.g. tests, ad-hoc scripts) don't have to remember
    // the listTools() → callTool() ordering contract.
    if (this.tools === null) await this.listTools();
    if (!this.hasTool(name)) {
      throw new Error(`Tool "${name}" is not exposed by MCP server "${this.name}" (unknown tool)`);
    }
    const result = await this.rpc<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>(
      "tools/call",
      { name, arguments: args },
    );
    const text = (result.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("\n");
    if (result.isError) {
      throw new Error(`Tool "${name}" returned error: ${text || "(no message)"}`);
    }
    return text;
  }

  close(): void {
    // No persistent transport; connect() is idempotent and nothing to release.
    this.connected = false;
    this.tools = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async rpc<T>(
    method: string,
    params: Record<string, unknown>,
    opts: { isNotification?: boolean } = {},
  ): Promise<T> {
    const body = opts.isNotification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id: this.nextId++, method, params };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      const isAbort = (err as { name?: string })?.name === "AbortError";
      // Notifications are fire-and-forget per MCP spec: a server that never
      // acks `notifications/initialized` must not deadlock the handshake.
      if (opts.isNotification && isAbort) return undefined as unknown as T;
      throw new Error(
        isAbort
          ? `MCP ${method} timed out after ${this.timeoutMs}ms (server "${this.name}")`
          : `MCP ${method} network error on "${this.name}": ${(err as Error).message}`,
      );
    }
    clearTimeout(timer);

    if (!res.ok) {
      throw new Error(`MCP ${method} failed with HTTP ${res.status} on "${this.name}"`);
    }
    if (opts.isNotification) {
      // Notifications have no response id — 202 Accepted or empty body.
      return undefined as unknown as T;
    }
    const parsed = (await res.json()) as JsonRpcResponse<T>;
    if (parsed.error) {
      throw new Error(`MCP ${method} error on "${this.name}": ${parsed.error.message}`);
    }
    if (parsed.result === undefined) {
      throw new Error(`MCP ${method} returned no result on "${this.name}"`);
    }
    return parsed.result;
  }
}

/**
 * Convert MCP tool descriptors to OpenAI-style `{type: "function", function: {...}}`
 * tool schemas suitable for the OpenAI-compatible chat-completions endpoints
 * Hive uses via `LLM_BASE_URL` (Anthropic, Mistral, DeepSeek, OpenAI, ...).
 */
export function toOpenAIToolSchemas(tools: MCPTool[]): OpenAIToolSchema[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters:
        t.inputSchema && typeof t.inputSchema === "object"
          ? t.inputSchema
          : { type: "object", properties: {} },
    },
  }));
}

/**
 * Connect to multiple MCP servers in parallel. Failures are isolated: a server
 * that won't handshake is logged and skipped, but successfully-connected
 * clients are still returned — one bad tool should not down the agent.
 */
export async function connectMCPClients(
  configs: MCPServerConfig[],
  logger: { error: (m: string) => void } = console,
): Promise<MCPClient[]> {
  const results = await Promise.allSettled(
    configs.map(async (cfg) => {
      const client = new MCPClient(cfg);
      await client.connect();
      await client.listTools();
      return client;
    }),
  );
  const ok: MCPClient[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") ok.push(r.value);
    else logger.error(`[mcp] failed to connect to "${configs[i].name}": ${(r.reason as Error).message}`);
  }
  return ok;
}
