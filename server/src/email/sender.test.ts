import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { sendWelcomeEmail } from "./sender";

type PoolCall = { sql: string; params: unknown[] };

function makePool(alreadySent: boolean) {
  const calls: PoolCall[] = [];
  const pool = {
    calls,
    query: mock(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("SELECT welcome_email_sent_at")) {
        return { rows: [{ welcome_email_sent_at: alreadySent ? new Date() : null }] };
      }
      if (sql.includes("UPDATE builders")) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
  return pool;
}

describe("sendWelcomeEmail", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    delete process.env.NEXT_PUBLIC_WEB_URL;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  it("no-ops (returns skipped) when RESEND_API_KEY is not set", async () => {
    const fetchMock = mock(async () => new Response("should not be called", { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const pool = makePool(false);

    const result = await sendWelcomeEmail({
      pool: pool as any,
      builderId: "00000000-0000-0000-0000-000000000001",
      to: "noe@example.com",
      displayName: "Noé",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("no_api_key");
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it("skips send and returns already_sent when welcome_email_sent_at is set", async () => {
    process.env.RESEND_API_KEY = "re_test_123456789012345678901234567890";
    const fetchMock = mock(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const pool = makePool(true);

    const result = await sendWelcomeEmail({
      pool: pool as any,
      builderId: "00000000-0000-0000-0000-000000000002",
      to: "dupe@example.com",
      displayName: "Dupe",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toBe("already_sent");
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it("POSTs to Resend API and records send on success", async () => {
    process.env.RESEND_API_KEY = "re_test_123456789012345678901234567890";
    process.env.EMAIL_FROM = "Hive <hello@hive.test>";
    process.env.NEXT_PUBLIC_WEB_URL = "https://hive.test";

    const fetchMock = mock(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id: "email_abc123" }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const pool = makePool(false);

    const result = await sendWelcomeEmail({
      pool: pool as any,
      builderId: "00000000-0000-0000-0000-000000000003",
      to: "new@example.com",
      displayName: "New",
    });

    expect(result.status).toBe("sent");
    expect(result.providerId).toBe("email_abc123");
    expect(fetchMock.mock.calls.length).toBe(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer re_test_123456789012345678901234567890");
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body.from).toBe("Hive <hello@hive.test>");
    expect(body.to).toEqual(["new@example.com"]);
    expect(typeof body.subject).toBe("string");
    expect(body.html).toContain("https://hive.test/quickstart");
    expect(body.text).toContain("https://hive.test/quickstart");

    const update = pool.calls.find((c) => c.sql.includes("UPDATE builders"));
    expect(update).toBeDefined();
    expect(update!.params[0]).toBe("00000000-0000-0000-0000-000000000003");
  });

  it("returns error status on Resend non-2xx (no row update) and does not throw", async () => {
    process.env.RESEND_API_KEY = "re_test_123456789012345678901234567890";
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({ message: "invalid from" }), { status: 422 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const pool = makePool(false);

    const result = await sendWelcomeEmail({
      pool: pool as any,
      builderId: "00000000-0000-0000-0000-000000000004",
      to: "fail@example.com",
      displayName: "Fail",
    });

    expect(result.status).toBe("error");
    expect(fetchMock.mock.calls.length).toBe(1);
    const update = pool.calls.find((c) => c.sql.includes("UPDATE builders"));
    expect(update).toBeUndefined();
  });

  it("returns error status when fetch throws (network) and does not propagate", async () => {
    process.env.RESEND_API_KEY = "re_test_123456789012345678901234567890";
    const fetchMock = mock(async () => {
      throw new Error("ECONNRESET");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const pool = makePool(false);

    const result = await sendWelcomeEmail({
      pool: pool as any,
      builderId: "00000000-0000-0000-0000-000000000005",
      to: "net@example.com",
      displayName: "Net",
    });

    expect(result.status).toBe("error");
  });
});
