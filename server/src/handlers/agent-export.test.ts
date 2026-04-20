import { describe, it, expect, mock } from "bun:test";
import { handleAgentExport } from "./agent-export";

type FakeRow = {
  name: string;
  role: string;
  personality_brief: string | null;
  avatar_seed: string;
  builder_display_name: string;
  created_at: Date | string;
};

function makePool(row: FakeRow | null) {
  return {
    query: mock(async (_sql: string, _params: unknown[]) => ({
      rows: row === null ? [] : [row],
    })),
  };
}

const VALID_UUID = "11111111-1111-1111-1111-111111111111";
const sampleRow = (overrides: Partial<FakeRow> = {}): FakeRow => ({
  name: "Lyra",
  role: "developer",
  personality_brief: "Builds clean APIs. Prefers boring tech.",
  avatar_seed: "seed-1",
  builder_display_name: "Noé Chagué",
  created_at: new Date("2026-01-15T10:00:00Z"),
  ...overrides,
});

async function call(agentId: string, format: string | null, row: FakeRow | null) {
  const pool = makePool(row);
  return handleAgentExport(agentId, format, pool as any);
}

describe("handleAgentExport", () => {
  it("returns 404 for malformed UUID", async () => {
    const res = await call("not-a-uuid", "team-config", sampleRow());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("not_found");
  });

  it("returns 404 when agent does not exist", async () => {
    const res = await call(VALID_UUID, "team-config", null);
    expect(res.status).toBe(404);
  });

  it("returns 400 when format query param is missing", async () => {
    const res = await call(VALID_UUID, null, sampleRow());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_format");
  });

  it("returns 400 when format is unsupported", async () => {
    const res = await call(VALID_UUID, "yaml", sampleRow());
    expect(res.status).toBe(400);
  });

  it("returns 200 with application/typescript for team-config", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/typescript; charset=utf-8"
    );
  });

  it("sets Content-Disposition with a .ts filename", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow());
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition.startsWith("attachment;")).toBe(true);
    expect(disposition).toMatch(/filename="personality-[a-z0-9-]+\.ts"/);
  });

  it("generates a file whose body exports the personality", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow({ name: "Lyra" }));
    const text = await res.text();
    expect(text).toContain('name: "Lyra"');
    expect(text).toContain('role: "developer"');
    expect(text).toContain('brief: "Builds clean APIs. Prefers boring tech."');
    expect(text).toContain("export default personality");
  });

  it("does not export displayed_skills or displayed_tools (platform metadata)", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow());
    const text = await res.text();
    expect(text).not.toContain("displayed_skills");
    expect(text).not.toContain("displayed_tools");
  });

  it("includes systemPrompt, triggers, artifactTypes keys with TODOs", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow());
    const text = await res.text();
    expect(text).toContain("systemPrompt:");
    expect(text).toContain("triggers:");
    expect(text).toContain("artifactTypes:");
    // Triggers/artifactTypes are runtime concerns, not DB state — must be empty arrays
    expect(text).toMatch(/triggers:\s*\[\]/);
    expect(text).toMatch(/artifactTypes:\s*\[\]/);
  });

  it("attributes the fork to the parent agent name and builder", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow({
      name: "Lyra",
      builder_display_name: "Noé Chagué",
    }));
    const text = await res.text();
    expect(text).toContain("Lyra");
    expect(text).toContain("Noé Chagué");
  });

  it("escapes special chars in strings so the TS file stays valid", async () => {
    // If the handler used template literals or raw interpolation, a name like
    // `Lyra${process.env.HOME}` would execute on import. JSON.stringify neutralizes it.
    const res = await call(VALID_UUID, "team-config", sampleRow({
      name: 'Ly"ra${evil}',
      personality_brief: "Line one\nLine two with `backticks`",
    }));
    const text = await res.text();
    // Raw ${ must not appear inside a string literal (would be parsed as template)
    // — we only use double-quoted strings, so ${ is literal and safe, but double quotes must be escaped
    expect(text).toContain('name: "Ly\\"ra${evil}"');
    // Newlines and backticks must not break the string literal
    expect(text).toContain("\\n");
    expect(text).not.toContain("Line one\nLine two"); // raw newline would break the literal
  });

  it("derives a safe filename slug from the agent name", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow({ name: "Ada Lovelace / OPS" }));
    const disposition = res.headers.get("Content-Disposition") ?? "";
    // Slashes and spaces collapsed to hyphens, lowercased, no special chars
    expect(disposition).toContain('filename="personality-ada-lovelace-ops.ts"');
  });

  it("falls back to 'agent' when the name has no safe chars", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow({ name: "!!!" }));
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain('filename="personality-agent.ts"');
  });

  it("handles null personality_brief without crashing", async () => {
    const res = await call(VALID_UUID, "team-config", sampleRow({ personality_brief: null }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('brief: ""');
  });
});
