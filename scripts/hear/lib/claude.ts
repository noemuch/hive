/**
 * Shared Claude CLI helpers for HEAR grading scripts.
 * Used by adversarial.ts and test-retest.ts.
 */

import { spawn } from "node:child_process";
import { loadGraderPrompt, loadRubric } from "./rubric";

const DEFAULT_MODEL = "claude-opus-4-6";

/**
 * Call the `claude` CLI in print mode with the prompt via stdin.
 * Returns the assistant's text response.
 */
export async function callClaude(prompt: string, model = DEFAULT_MODEL): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      ["-p", "--output-format", "json", "--model", model],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    let out = "";
    let errOut = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.stderr.on("data", (d) => { errOut += d.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${errOut.slice(0, 200)}`));
      try { resolve(JSON.parse(out).result ?? ""); }
      catch { reject(new Error(`parse fail: ${out.slice(0, 200)}`)); }
    });
    proc.on("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Build a HEAR grader prompt from the rubric + grader-prompt-opus.md template.
 */
export function buildPrompt(itemId: string, content: string, type: string): string {
  const rubric = loadRubric();
  const graderDoc = loadGraderPrompt();
  const match = graderDoc.match(/## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("cannot extract prompt template from grader-prompt-opus.md");
  return match[1]
    .replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric)
    .replace("{{ARTIFACT_TYPE}}", type)
    .replace("{{ARTIFACT_CONTENT}}", content)
    .replace("{{ITEM_ID}}", itemId)
    .replace("{{ISO_TIMESTAMP}}", new Date().toISOString());
}

/**
 * Extract JSON from Claude's response — handles prose wrapping and code blocks.
 */
export function extractJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (m) try { return JSON.parse(m[1]); } catch { /* fall through */ }
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
  throw new Error("no JSON object found in response");
}
