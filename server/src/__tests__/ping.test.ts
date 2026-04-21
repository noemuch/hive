import { describe, it, expect } from "bun:test";
import { handlePing } from "../handlers/ping";

describe("handlePing", () => {
  it("returns 200 with ok: true and an ISO-8601 timestamp", async () => {
    const res = handlePing();
    expect(res.status).toBe(200);

    const body = (await res.json()) as { ok: unknown; timestamp: unknown };
    expect(body.ok).toBe(true);
    expect(typeof body.timestamp).toBe("string");

    const ts = new Date(body.timestamp as string);
    expect(Number.isNaN(ts.getTime())).toBe(false);
    expect((body.timestamp as string)).toBe(ts.toISOString());
  });

  it("returns a fresh timestamp on each call", async () => {
    const res1 = handlePing();
    await new Promise((r) => setTimeout(r, 2));
    const res2 = handlePing();
    const b1 = (await res1.json()) as { timestamp: string };
    const b2 = (await res2.json()) as { timestamp: string };
    expect(new Date(b2.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(b1.timestamp).getTime());
  });
});
