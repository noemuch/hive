import { describe, it, expect, mock } from "bun:test";
import { handleRegister } from "./register";

// Minimal pool mock
function makePool(behavior: "success" | "duplicate" | "error") {
  return {
    query: mock(async (_sql: string, params: unknown[]) => {
      if (behavior === "success") {
        return {
          rows: [{ id: "uuid-1", email: params[0], display_name: params[2] }],
        };
      }
      if (behavior === "duplicate") {
        throw new Error('duplicate key value violates unique constraint "builders_email_key"');
      }
      throw new Error("unexpected db error");
    }),
  };
}

let ipCounter = 0;
function nextIp() {
  ipCounter++;
  return `10.0.0.${ipCounter}`;
}

describe("handleRegister", () => {
  it("returns 201 with builder + token on success", async () => {
    const pool = makePool("success");
    const sendWelcome = mock(async () => ({ status: "sent" as const, providerId: "email_1" }));
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123", display_name: "Test" }),
    });
    const res = await handleRegister(req, pool as any, nextIp(), sendWelcome);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.builder.email).toBe("test@example.com");
    expect(typeof body.token).toBe("string");
  });

  it("returns 409 with email_taken on duplicate email", async () => {
    const pool = makePool("duplicate");
    const sendWelcome = mock(async () => ({ status: "sent" as const, providerId: "email_1" }));
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dupe@example.com", password: "password123", display_name: "Dupe" }),
    });
    const res = await handleRegister(req, pool as any, nextIp(), sendWelcome);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("email_taken");
  });

  it("returns 400 when required fields are missing", async () => {
    const pool = makePool("success");
    const sendWelcome = mock(async () => ({ status: "sent" as const, providerId: "email_1" }));
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const res = await handleRegister(req, pool as any, nextIp(), sendWelcome);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("email, password, display_name required");
  });

  it("triggers welcome email on successful registration", async () => {
    const pool = makePool("success");
    const sendWelcome = mock(async () => ({ status: "sent" as const, providerId: "email_ok" }));
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "new@example.com", password: "password123", display_name: "Noé" }),
    });
    const res = await handleRegister(req, pool as any, nextIp(), sendWelcome);
    expect(res.status).toBe(201);

    // Fire-and-forget: wait a tick for microtask queue
    await new Promise((r) => setTimeout(r, 10));

    expect(sendWelcome).toHaveBeenCalledTimes(1);
    const call = sendWelcome.mock.calls[0]![0] as {
      to: string;
      displayName: string;
      builderId: string;
    };
    expect(call.to).toBe("new@example.com");
    expect(call.displayName).toBe("Noé");
    expect(call.builderId).toBe("uuid-1");
  });

  it("does not trigger welcome email on duplicate registration", async () => {
    const pool = makePool("duplicate");
    const sendWelcome = mock(async () => ({ status: "sent" as const, providerId: "email_1" }));
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dupe@example.com", password: "password123", display_name: "Dupe" }),
    });
    await handleRegister(req, pool as any, nextIp(), sendWelcome);
    await new Promise((r) => setTimeout(r, 10));
    expect(sendWelcome).toHaveBeenCalledTimes(0);
  });

  it("returns 201 even if welcome email sender throws (fire-and-forget)", async () => {
    const pool = makePool("success");
    const sendWelcome = mock(async () => {
      throw new Error("resend down");
    });
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "flaky@example.com", password: "password123", display_name: "Flaky" }),
    });
    const res = await handleRegister(req, pool as any, nextIp(), sendWelcome);
    expect(res.status).toBe(201);
  });
});
