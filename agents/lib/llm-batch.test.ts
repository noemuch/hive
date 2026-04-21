import { describe, it, expect } from "bun:test";
import {
  batchIsSupported,
  resolveAnthropicBase,
  parseJsonl,
  type BatchResult,
} from "./llm-batch";

describe("batchIsSupported", () => {
  it("returns true for empty/undefined base URL (defaults to Anthropic)", () => {
    expect(batchIsSupported(undefined)).toBe(true);
    expect(batchIsSupported(null)).toBe(true);
    expect(batchIsSupported("")).toBe(true);
  });

  it("returns true for Anthropic native + OpenAI-compat endpoints", () => {
    expect(batchIsSupported("https://api.anthropic.com/v1")).toBe(true);
    expect(batchIsSupported("https://api.anthropic.com/v1/openai")).toBe(true);
    expect(batchIsSupported("https://API.Anthropic.com/v1")).toBe(true);
  });

  it("returns false for other providers", () => {
    expect(batchIsSupported("https://api.mistral.ai/v1")).toBe(false);
    expect(batchIsSupported("https://api.openai.com/v1")).toBe(false);
    expect(batchIsSupported("http://localhost:11434/v1")).toBe(false);
  });
});

describe("resolveAnthropicBase", () => {
  it("defaults to the native Anthropic base", () => {
    expect(resolveAnthropicBase(undefined)).toBe("https://api.anthropic.com/v1");
    expect(resolveAnthropicBase("")).toBe("https://api.anthropic.com/v1");
  });

  it("strips /openai suffix from the OpenAI-compat URL", () => {
    expect(resolveAnthropicBase("https://api.anthropic.com/v1/openai")).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  it("strips trailing slashes", () => {
    expect(resolveAnthropicBase("https://api.anthropic.com/v1/")).toBe(
      "https://api.anthropic.com/v1",
    );
  });

  it("falls back to default for non-Anthropic bases", () => {
    expect(resolveAnthropicBase("https://api.mistral.ai/v1")).toBe(
      "https://api.anthropic.com/v1",
    );
  });
});

describe("parseJsonl", () => {
  it("returns [] for empty body", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("\n\n")).toEqual([]);
  });

  it("parses a succeeded result", () => {
    const line = JSON.stringify({
      custom_id: "req-1",
      result: {
        type: "succeeded",
        message: { content: [{ type: "text", text: "hello world" }] },
      },
    });
    const out = parseJsonl(line);
    expect(out).toEqual([{ customId: "req-1", text: "hello world" }] as BatchResult[]);
  });

  it("concatenates multiple text blocks", () => {
    const line = JSON.stringify({
      custom_id: "req-2",
      result: {
        type: "succeeded",
        message: {
          content: [
            { type: "text", text: "part 1 " },
            { type: "text", text: "part 2" },
          ],
        },
      },
    });
    expect(parseJsonl(line)[0]).toEqual({ customId: "req-2", text: "part 1 part 2" });
  });

  it("records an error result", () => {
    const line = JSON.stringify({
      custom_id: "req-err",
      result: {
        type: "errored",
        error: { type: "overloaded_error", message: "try later" },
      },
    });
    const [r] = parseJsonl(line);
    expect(r.customId).toBe("req-err");
    expect(r.text).toBeUndefined();
    expect(r.error).toContain("try later");
  });

  it("tolerates malformed JSON lines without throwing", () => {
    const body = "not-valid-json\n" + JSON.stringify({
      custom_id: "req-ok",
      result: { type: "succeeded", message: { content: [{ type: "text", text: "ok" }] } },
    });
    const out = parseJsonl(body);
    expect(out).toHaveLength(2);
    expect(out[0].customId).toBe("unknown");
    expect(out[0].error).toContain("parse error");
    expect(out[1]).toEqual({ customId: "req-ok", text: "ok" });
  });

  it("reports an error when result type is missing", () => {
    const line = JSON.stringify({ custom_id: "req-weird", result: {} });
    const [r] = parseJsonl(line);
    expect(r.customId).toBe("req-weird");
    expect(r.error).toBeDefined();
  });
});
