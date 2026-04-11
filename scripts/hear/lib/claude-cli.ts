/**
 * HEAR Judge Service — Claude invocation layer.
 *
 * Provides a single `callClaude()` function with two backends:
 *   - SDK (ANTHROPIC_API_KEY set): uses @anthropic-ai/sdk directly.
 *     Used in production (Railway) where claude CLI is not authenticated.
 *   - CLI (ANTHROPIC_API_KEY not set): spawns `claude -p`.
 *     Used locally with a Claude Max subscription.
 *
 * The orchestrator imports only `callClaude` and is unaware of the backend.
 */

import { spawn } from "node:child_process";

export type ClaudeResponse = {
  text: string;
  /** Approximate cost in USD. 0 if not available. */
  cost: number;
  usage?: unknown;
};

/**
 * Call Claude with the given prompt and model.
 * Uses SDK if ANTHROPIC_API_KEY is set, CLI otherwise.
 */
export async function callClaude(
  prompt: string,
  model: string,
): Promise<ClaudeResponse> {
  if (process.env.ANTHROPIC_API_KEY) {
    return callClaudeSdk(prompt, model);
  }
  return callClaudeCli(prompt, model);
}

// ---- SDK backend ----

async function callClaudeSdk(
  prompt: string,
  model: string,
): Promise<ClaudeResponse> {
  // Dynamic import to avoid loading the SDK when using the CLI path.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  const msg = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = msg.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Per-model pricing (USD per million tokens, input/output).
  // Update when Anthropic changes pricing or adds new models.
  const PRICING: Record<string, [number, number]> = {
    "claude-opus-4-6": [15, 75],
    "claude-sonnet-4-6": [3, 15],
    "claude-haiku-4-5": [0.8, 4],
  };
  const [inputRate, outputRate] = PRICING[model] ?? [15, 75]; // fallback: Opus (safe, errs high)
  const inputCostUsd = (msg.usage.input_tokens / 1_000_000) * inputRate;
  const outputCostUsd = (msg.usage.output_tokens / 1_000_000) * outputRate;

  return {
    text,
    cost: inputCostUsd + outputCostUsd,
    usage: msg.usage,
  };
}

// ---- CLI backend ----

async function callClaudeCli(
  prompt: string,
  model: string,
): Promise<ClaudeResponse> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `claude CLI exited with code ${code}\nstderr: ${stderr.slice(0, 500)}`,
          ),
        );
        return;
      }
      try {
        const envelope = JSON.parse(stdout);
        const text = envelope.result ?? envelope.message ?? envelope.text;
        if (typeof text !== "string") {
          throw new Error(
            `unexpected CLI envelope shape: ${JSON.stringify(envelope).slice(0, 500)}`,
          );
        }
        resolve({
          text,
          cost: envelope.total_cost_usd ?? 0,
          usage: envelope.usage,
        });
      } catch (err) {
        reject(
          new Error(
            `failed to parse claude CLI JSON output: ${(err as Error).message}\nfirst 500 chars: ${stdout.slice(0, 500)}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      reject(
        new Error(
          `failed to spawn 'claude' — is Claude Code installed and in PATH? (${err.message})`,
        ),
      );
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
