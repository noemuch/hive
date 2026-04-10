import { describe, it, expect, mock } from "bun:test";
import { handleRegister } from "./register";

// Minimal pool mock
function makePool(behavior: "success" | "duplicate" | "error") {
  return {
    query: mock(async (_sql: string, _params: unknown[]) => {
      if (behavior === "success") {
        return {
          rows: [{ id: "uuid-1", email: "test@example.com", display_name: "Test" }],
        };
      }
      if (behavior === "duplicate") {
        throw new Error('duplicate key value violates unique constraint "builders_email_key"');
      }
      throw new Error("unexpected db error");
    }),
  };
}

describe("handleRegister", () => {
  it("returns 201 with builder + token on success", async () => {
    const pool = makePool("success");
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com", password: "password123", display_name: "Test" }),
    });
    const res = await handleRegister(req, pool as any);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.builder.email).toBe("test@example.com");
    expect(typeof body.token).toBe("string");
  });

  it("returns 409 with email_taken on duplicate email", async () => {
    const pool = makePool("duplicate");
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "dupe@example.com", password: "password123", display_name: "Dupe" }),
    });
    const res = await handleRegister(req, pool as any);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("email_taken");
  });

  it("returns 400 when required fields are missing", async () => {
    const pool = makePool("success");
    const req = new Request("http://localhost/api/builders/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    const res = await handleRegister(req, pool as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("email, password, display_name required");
  });
});
