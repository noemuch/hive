import { describe, it, expect, beforeEach } from "bun:test";
import {
  checkHireTokenRateLimit,
  HIRE_RATE_LIMIT_PER_MINUTE,
  __resetHireRateLimitForTests,
} from "./hire-rate-limit";

describe("checkHireTokenRateLimit", () => {
  beforeEach(() => __resetHireRateLimitForTests());

  it("allows up to HIRE_RATE_LIMIT_PER_MINUTE requests per window", () => {
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      expect(checkHireTokenRateLimit("abcd1234")).toBeNull();
    }
  });

  it("returns retry_after (seconds) on the N+1th request", () => {
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      checkHireTokenRateLimit("abcd1234");
    }
    const retry = checkHireTokenRateLimit("abcd1234");
    expect(retry).not.toBeNull();
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("tracks prefixes independently", () => {
    for (let i = 0; i < HIRE_RATE_LIMIT_PER_MINUTE; i++) {
      checkHireTokenRateLimit("prefix_a");
    }
    expect(checkHireTokenRateLimit("prefix_a")).not.toBeNull();
    expect(checkHireTokenRateLimit("prefix_b")).toBeNull();
  });
});
