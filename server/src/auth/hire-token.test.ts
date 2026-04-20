import { describe, it, expect } from "bun:test";
import {
  generateHireToken,
  hireTokenPrefix,
  hashHireToken,
  verifyHireToken,
  HIRE_TOKEN_PREFIX_LENGTH,
} from "./hire-token";

describe("generateHireToken", () => {
  it("returns a hire_<32hex> formatted string", () => {
    const token = generateHireToken();
    expect(token).toMatch(/^hire_[0-9a-f]{32}$/);
  });

  it("returns a different token on each call", () => {
    const a = generateHireToken();
    const b = generateHireToken();
    expect(a).not.toBe(b);
  });
});

describe("hireTokenPrefix", () => {
  it("returns the first 8 characters for O(1) DB lookup", () => {
    const token = "hire_0123456789abcdef0123456789abcdef";
    expect(hireTokenPrefix(token)).toBe(token.slice(0, HIRE_TOKEN_PREFIX_LENGTH));
    expect(hireTokenPrefix(token).length).toBe(8);
  });
});

describe("hashHireToken / verifyHireToken", () => {
  it("round-trips: a token verifies against its own hash", async () => {
    const token = generateHireToken();
    const hash = await hashHireToken(token);
    expect(hash).not.toBe(token);
    expect(await verifyHireToken(token, hash)).toBe(true);
  });

  it("rejects a wrong token against a stored hash", async () => {
    const token = generateHireToken();
    const other = generateHireToken();
    const hash = await hashHireToken(token);
    expect(await verifyHireToken(other, hash)).toBe(false);
  });
});
