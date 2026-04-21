import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  encryptLLMKey,
  decryptLLMKey,
  ENCRYPTED_KEY_PREFIX,
} from "./key-encryption";

// Deterministic 32-byte hex master key for tests only (NOT a secret).
const TEST_KEY_HEX = "0".repeat(64);
let previous: string | undefined;

beforeAll(() => {
  previous = process.env.LLM_KEYS_MASTER_KEY;
  process.env.LLM_KEYS_MASTER_KEY = TEST_KEY_HEX;
});
afterAll(() => {
  if (previous === undefined) delete process.env.LLM_KEYS_MASTER_KEY;
  else process.env.LLM_KEYS_MASTER_KEY = previous;
});

describe("encryptLLMKey / decryptLLMKey", () => {
  it("round-trips plaintext", () => {
    const plain = "byok-demo-plaintext-FAKE";
    const cipher = encryptLLMKey(plain);
    expect(cipher.startsWith(ENCRYPTED_KEY_PREFIX)).toBe(true);
    expect(cipher).not.toContain(plain);
    expect(decryptLLMKey(cipher)).toBe(plain);
  });

  it("produces distinct ciphertexts for identical plaintext (random IV)", () => {
    const plain = "same-input";
    expect(encryptLLMKey(plain)).not.toBe(encryptLLMKey(plain));
  });

  it("throws when ciphertext is tampered (auth tag mismatch)", () => {
    const plain = "byok-xyz-FAKE";
    const cipher = encryptLLMKey(plain);
    const body = cipher.slice(ENCRYPTED_KEY_PREFIX.length);
    const bytes = Buffer.from(body, "base64");
    bytes[bytes.length - 1] ^= 0x01;
    const tampered = ENCRYPTED_KEY_PREFIX + bytes.toString("base64");
    expect(() => decryptLLMKey(tampered)).toThrow();
  });

  it("passes through legacy plaintext (no prefix) for backward compat", () => {
    expect(decryptLLMKey("plain-legacy-key")).toBe("plain-legacy-key");
  });

  it("throws when master key env var is unset at encrypt time", () => {
    const saved = process.env.LLM_KEYS_MASTER_KEY;
    delete process.env.LLM_KEYS_MASTER_KEY;
    try {
      expect(() => encryptLLMKey("anything")).toThrow(/LLM_KEYS_MASTER_KEY/);
    } finally {
      process.env.LLM_KEYS_MASTER_KEY = saved;
    }
  });

  it("throws when master key has wrong length", () => {
    const saved = process.env.LLM_KEYS_MASTER_KEY;
    process.env.LLM_KEYS_MASTER_KEY = "short";
    try {
      expect(() => encryptLLMKey("anything")).toThrow();
    } finally {
      process.env.LLM_KEYS_MASTER_KEY = saved;
    }
  });
});
