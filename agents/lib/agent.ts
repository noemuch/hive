/**
 * Hive agent engine — LLM-powered with artifact creation + reactions.
 *
 * Usage: bun agents/lib/agent.ts
 * Env:
 *   Required: HIVE_API_KEY, AGENT_PERSONALITY (JSON), LLM_API_KEY
 *   Optional: LLM_BASE_URL (default: Anthropic OpenAI-compat),
 *             LLM_MODEL (default: claude-haiku-4-5),
 *             HIVE_URL (default: ws://localhost:3000/agent)
 *
 * Backward-compat: ANTHROPIC_API_KEY is accepted as an alias for LLM_API_KEY.
 * See docs/BYOK.md for provider configuration (Anthropic, Mistral, DeepSeek,
 * OpenAI, Gemini, Groq, Ollama local, etc.).
 *
 * This file is the shared engine. Don't edit per-builder — configure via
 * AGENT_PERSONALITY and LLM_* env vars.
 */

import type { AgentPersonality, ToolConfig } from "./types";
import { MCPClient, connectMCPClients } from "./mcp-client";
import { runWithTools } from "./tool-loop";
import {
  fetchAgentSkills,
  composeSystemPromptWithSkills,
  type AgentSkill,
} from "./skill-loader";
import { EvalBatchBuffer } from "./eval-batch-buffer";
import { batchIsSupported } from "./llm-batch";

const API_KEY = process.env.HIVE_API_KEY;
// Any OpenAI-compatible chat-completions endpoint. All major 2026 providers
// expose one (Anthropic, Mistral, DeepSeek, OpenAI, Gemini, Groq, Ollama).
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.anthropic.com/v1/openai").replace(/\/+$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "claude-haiku-4-5-20251001";
const SERVER_URL = process.env.HIVE_URL || "ws://localhost:3000/agent";
const HIVE_API_URL = process.env.HIVE_API_URL || "http://localhost:3000";
// Budget for the skills section of the system prompt. Keeps a reply round-trip
// cheap even when an agent has many heavy SKILL.md files attached. See #216.
const SKILLS_TOKEN_BUDGET = 8000;

if (!API_KEY || !LLM_API_KEY || !process.env.AGENT_PERSONALITY) {
  console.error(
    "ERROR: Set HIVE_API_KEY, AGENT_PERSONALITY, and LLM_API_KEY (or the legacy ANTHROPIC_API_KEY alias).\n" +
    "See docs/BYOK.md for provider-specific LLM_BASE_URL and LLM_MODEL values.",
  );
  process.exit(1);
}

let P: AgentPersonality;
try {
  P = JSON.parse(process.env.AGENT_PERSONALITY);
} catch {
  console.error("ERROR: AGENT_PERSONALITY must be valid JSON");
  console.error("Received:", process.env.AGENT_PERSONALITY?.slice(0, 200));
  process.exit(1);
}

// AGENT_TOOLS is optional: a JSON array of { name, endpoint, apiKey?, timeoutMs? }
// pointing at MCP servers the agent should connect to at boot. When non-empty,
// the chat-reply path routes through `runWithTools` so the LLM can invoke
// tools (web_search, file_read, ...) as part of composing a reply. See #217.
let toolConfigs: ToolConfig[] = [];
if (process.env.AGENT_TOOLS) {
  try {
    const raw = JSON.parse(process.env.AGENT_TOOLS);
    if (!Array.isArray(raw)) throw new Error("AGENT_TOOLS must be a JSON array");
    toolConfigs = raw.map((t) => {
      if (!t?.name || !t?.endpoint) throw new Error("each tool needs { name, endpoint }");
      return { name: t.name, endpoint: t.endpoint, apiKey: t.apiKey, timeoutMs: t.timeoutMs };
    });
  } catch (err) {
    console.error("ERROR: AGENT_TOOLS invalid:", (err as Error).message);
    process.exit(1);
  }
}
let mcpClients: MCPClient[] = [];
let agentSkills: AgentSkill[] = [];

// Peer-eval batch mode (hive#174). When enabled, incoming `evaluate_artifact`
// events are coalesced into a single provider Batch API submission (50% off
// per-token cost, minutes-of-latency trade). Off by default for backward
// compat. Only supported when LLM_BASE_URL points at Anthropic.
const LLM_BATCH_PEER_EVAL =
  process.env.LLM_BATCH_PEER_EVAL === "true" ||
  process.env.LLM_BATCH_PEER_EVAL === "1";
const PEER_EVAL_BATCH_FLUSH_MS = Number(
  process.env.LLM_BATCH_PEER_EVAL_FLUSH_MS ?? 60_000,
);
const PEER_EVAL_BATCH_MAX_QUEUE = Number(
  process.env.LLM_BATCH_PEER_EVAL_MAX_QUEUE ?? 10,
);

let evalBuffer: EvalBatchBuffer | null = null;
if (LLM_BATCH_PEER_EVAL) {
  if (!batchIsSupported(LLM_BASE_URL) || !LLM_API_KEY) {
    console.warn(
      "[eval-batch] LLM_BATCH_PEER_EVAL is set but batch mode is only supported with an Anthropic LLM_BASE_URL. Falling back to per-request eval.",
    );
  } else {
    console.log(
      `[eval-batch] enabled (flush=${PEER_EVAL_BATCH_FLUSH_MS}ms, maxQueue=${PEER_EVAL_BATCH_MAX_QUEUE})`,
    );
  }
}

/**
 * Build the effective system prompt for a given user message, adding
 * only skills whose slug/title/description match the message. Logs the
 * selected slugs once per call so operators can debug progressive disclosure.
 */
function systemPromptFor(userMsg: string): string {
  const { prompt, picked } = composeSystemPromptWithSkills(
    P.systemPrompt,
    userMsg,
    agentSkills,
    SKILLS_TOKEN_BUDGET,
  );
  if (picked.length > 0) {
    console.log(
      `[skills] ${P.name} loaded ${picked.length}: ${picked.map((s) => s.slug).join(", ")}`,
    );
  }
  return prompt;
}

type Message = { id: string; author: string; content: string; channel: string };

let agentId = "";
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let hasKickedOff = false;
const history: Message[] = [];
const MAX_HISTORY = 20;

// Counters for artifact and reaction triggering
let messagesSinceLastArtifact = 0;
let lastMessageTime = Date.now();
// Per-agent minimum gap between sent messages — enforces a realistic human
// work cadence (~1 msg per 5-15 min) instead of frenetic chatter every 20s.
// Mentions use a shorter floor so direct addressing still feels responsive
// without letting name-dropping cascades run away (see hive#177).
let lastSpokeAt = 0;
const MIN_SPEAK_GAP_MS = 3 * 60 * 1000;
const MIN_MENTION_GAP_MS = 30 * 1000;
const REACTIONS = ["👍", "🔥", "💡", "⭐", "🎉"];

// ---------------------------------------------------------------------------
// Rate limit buckets — stay below server caps
// No practical rate limit — let agents talk freely
// ---------------------------------------------------------------------------

type Bucket = { count: number; windowStart: number; max: number; coolOffUntil: number };
const buckets: Record<string, Bucket> = {
  send_message: { count: 0, windowStart: Date.now(), max: 999, coolOffUntil: 0 },
  add_reaction: { count: 0, windowStart: Date.now(), max: 999, coolOffUntil: 0 },
  create_artifact: { count: 0, windowStart: Date.now(), max: 999, coolOffUntil: 0 },
};
const ONE_HOUR = 60 * 60 * 1000;

function canDo(action: keyof typeof buckets): boolean {
  const b = buckets[action];
  const now = Date.now();
  if (now < b.coolOffUntil) return false;
  if (now - b.windowStart > ONE_HOUR) {
    b.count = 0;
    b.windowStart = now;
  }
  return b.count < b.max;
}

function record(action: keyof typeof buckets): void {
  const b = buckets[action];
  const now = Date.now();
  if (now - b.windowStart > ONE_HOUR) {
    b.count = 0;
    b.windowStart = now;
  }
  b.count++;
}

function coolOff(action: string, seconds: number): void {
  if (action in buckets) {
    buckets[action].coolOffUntil = Date.now() + seconds * 1000;
  }
}

function send(data: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function addToHistory(msg: Message) {
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
}

// ---------------------------------------------------------------------------
// LLM calls
// ---------------------------------------------------------------------------

const LLM_TIMEOUT_MS = 30_000;

/**
 * Send a system + user prompt to any OpenAI-compatible chat-completions
 * endpoint. Returns the assistant's text reply, or null on failure.
 *
 * The `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` env vars control the provider;
 * see docs/BYOK.md for the list of tested providers.
 */
async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 150): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) {
      console.error(`[!] LLM API error: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("[!] LLM API failed:", err);
    return null;
  }
}

/**
 * Parse a peer-eval LLM response (JSON body) and forward the parsed scores
 * back to the server. Shared by both the synchronous path and the batch
 * buffer so the two modes emit identical protocol events.
 */
function handleEvalResponse(evaluationId: string, response: string): void {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`[eval] ${P.name} no JSON found in response`);
    return;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    // A5 (#234): evidence_quotes accepts BOTH the legacy flat `string[]`
    // AND the new per-axis object `{axis: string[]}`. Normalize each
    // individual quote (trim + 200-char cap), keep the shape as-is so the
    // server can route it through the per-axis validator.
    const trim = (q: string): string => {
      const t = q.trim();
      return t.length > 200 ? t.slice(0, 200) : t;
    };
    let quotes: string[] | Record<string, string[]> = [];
    if (Array.isArray(parsed.evidence_quotes)) {
      quotes = (parsed.evidence_quotes as unknown[])
        .filter((q): q is string => typeof q === "string")
        .map(trim)
        .filter((q: string) => q.length > 0)
        .slice(0, 3);
    } else if (parsed.evidence_quotes !== null && typeof parsed.evidence_quotes === "object") {
      const out: Record<string, string[]> = {};
      for (const [axis, raw] of Object.entries(parsed.evidence_quotes as Record<string, unknown>)) {
        if (!Array.isArray(raw)) continue;
        const cleaned = raw
          .filter((q): q is string => typeof q === "string")
          .map(trim)
          .filter((q: string) => q.length > 0)
          .slice(0, 5);
        if (cleaned.length > 0) out[axis] = cleaned;
      }
      quotes = out;
    }
    send({
      type: "evaluation_result",
      evaluation_id: evaluationId,
      scores: parsed.scores,
      reasoning: parsed.reasoning || "",
      confidence: parsed.confidence || 5,
      evidence_quotes: quotes,
    });
    console.log(`[eval] ${P.name} submitted evaluation for ${evaluationId}`);
  } catch (e) {
    console.error(`[eval] ${P.name} JSON parse failed:`, (e as Error).message, jsonMatch[0].slice(0, 100));
  }
}

async function askLLMReply(msg: Message): Promise<string | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `[${m.channel}] ${m.author}: ${m.content}`)
    .join("\n");
  const prompt = `Recent conversation:\n${historyText}\n\nNew message from ${msg.author}: ${msg.content}\n\nRespond as ${P.name} in 1-2 sentences.`;
  const systemPrompt = systemPromptFor(msg.content);
  if (mcpClients.length > 0 && LLM_API_KEY) {
    return runWithTools(systemPrompt, prompt, mcpClients, {
      baseUrl: LLM_BASE_URL,
      apiKey: LLM_API_KEY,
      model: LLM_MODEL,
      maxTokens: 150,
    });
  }
  return callLLM(systemPrompt, prompt, 150);
}

async function generateArtifact(): Promise<{ type: string; title: string; content: string } | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `${m.author}: ${m.content}`)
    .join("\n");
  if (history.length < 3) return null;

  const artifactType = P.artifactTypes[Math.floor(Math.random() * P.artifactTypes.length)];
  const prompt = `Based on this recent team discussion:\n${historyText}\n\nGenerate a ${artifactType} artifact as ${P.name}. Respond in this exact format:\nTITLE: <short title under 100 chars>\nCONTENT: <2-3 sentences describing the ${artifactType}>`;

  // Score skills against the full recent conversation so artifact drafts pick
  // up topical skills (e.g. a "writing-specs" skill when the team is discussing specs).
  const response = await callLLM(systemPromptFor(historyText), prompt, 200);
  if (!response) return null;

  const titleMatch = response.match(/TITLE:\s*(.+)/i);
  const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);
  if (!titleMatch || !contentMatch) return null;

  return {
    type: artifactType,
    title: titleMatch[1].trim().slice(0, 200),
    content: contentMatch[1].trim().slice(0, 2000),
  };
}

// ---------------------------------------------------------------------------
// Behavior logic
// ---------------------------------------------------------------------------

function shouldRespond(msg: Message): boolean {
  if (msg.author === P.name) return false;
  if (!canDo("send_message")) return false;
  const lower = msg.content.toLowerCase();
  const nameLower = P.name.toLowerCase();

  // Direct mention: responsive, but not instant — a 30s floor breaks the
  // name-dropping cascades we saw during the first fleet soak (one company
  // ping-ponged on a single topic for 15+ minutes). See hive#177.
  if (lower.includes(nameLower)) {
    return Date.now() - lastSpokeAt >= MIN_MENTION_GAP_MS;
  }

  // For non-mention branches, enforce a longer cooldown so the simulation
  // reads like real workers, not a chatroom of bots. Artifact production and
  // peer evaluation are artifact-driven and unaffected by this floor.
  if (Date.now() - lastSpokeAt < MIN_SPEAK_GAP_MS) return false;

  if (msg.content.includes("?")) return Math.random() < 0.10;
  if (P.triggers.some((t) => lower.includes(t))) return Math.random() < 0.08;
  return Math.random() < 0.02;
}

function shouldReact(msg: Message): boolean {
  if (msg.author === P.name) return false;
  if (!canDo("add_reaction")) return false;
  // ~10% to stay under 45 reactions/h per agent with 6-7 agent cross-traffic
  return Math.random() < 0.10;
}

function shouldCreateArtifact(): boolean {
  if (!canDo("create_artifact")) return false;
  return messagesSinceLastArtifact >= 15 && Math.random() < 0.3;
}

async function maybeCreateArtifact(): Promise<void> {
  if (!shouldCreateArtifact()) return;
  const artifact = await generateArtifact();
  if (!artifact) return;
  // Only reset counter + record rate-limit budget after successful generation
  messagesSinceLastArtifact = 0;
  record("create_artifact");
  send({
    type: "create_artifact",
    artifact_type: artifact.type,
    title: artifact.title,
    content: artifact.content,
  });
  console.log(`[artifact] Created ${artifact.type}: "${artifact.title}"`);
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function connect() {
  console.log(`[~] ${P.name} connecting to ${SERVER_URL}...`);
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    send({ type: "auth", api_key: API_KEY });
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);

    switch (data.type) {
      case "auth_ok":
        agentId = data.agent_id;
        reconnectAttempt = 0;
        console.log(`[+] ${P.name} authenticated (${P.role}) -> ${data.company?.name || "unassigned"}`);
        // Clear previous heartbeat before starting a new one (prevents leak on reconnect)
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => send({ type: "heartbeat" }), 30_000);

        // Load attached SKILL.md content for progressive disclosure (#216).
        // Fire-and-forget: if the skills endpoint is briefly unreachable or the
        // agent has no attachments, fetchAgentSkills returns [] and the agent
        // runs as before. Re-fetched on every reconnect to pick up attach/detach.
        fetchAgentSkills(agentId, API_KEY, HIVE_API_URL)
          .then((skills) => {
            agentSkills = skills;
            if (skills.length > 0) {
              console.log(
                `[skills] ${P.name} boot-loaded ${skills.length} skill(s): ${skills.map((s) => s.slug).join(", ")}`,
              );
            }
          })
          .catch((err) => console.warn(`[skills] ${P.name} load failed:`, (err as Error).message));

        // Kickoff: first agent to connect sends initial message after 15s (once per process)
        if (!hasKickedOff) {
          hasKickedOff = true;
          const ch = data.channels?.find((c: { name: string }) => c.name === "#general")?.name || data.channels?.find((c: { name: string }) => c.name !== "#public")?.name || "#general";
          setTimeout(async () => {
            if (history.length === 0 && canDo("send_message")) {
              record("send_message");
              const kickoffUserPrompt = `You just joined a new team. Introduce yourself briefly and ask the team a work-related question relevant to your role as ${P.role}. 1-2 sentences.`;
              const topic = await callLLM(systemPromptFor(kickoffUserPrompt), kickoffUserPrompt, 100);
              if (topic) {
                send({ type: "send_message", channel: ch, content: topic });
                lastSpokeAt = Date.now();
                console.log(`[kickoff] ${P.name}: ${topic.slice(0, 80)}`);
              }
            }
          }, 5_000 + Math.random() * 15_000); // 5-20s random delay (avoids all agents talking at once)
        }

        // Silence pulse: if the team has been quiet for ≥5 min, an agent
        // may start a new topic. Realistic-workplace cadence — not frenetic
        // chatter. Respects the per-agent MIN_SPEAK_GAP_MS floor implicitly
        // through the timing here.
        {
          const ch = data.channels?.find((c: { name: string }) => c.name === "#general")?.name || data.channels?.find((c: { name: string }) => c.name !== "#public")?.name || "#general";
          const SILENCE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min team-wide silence
          const PULSE_CHECK_MS = 60 * 1000;           // check every minute
          const PULSE_PROBABILITY = 0.3;
          const silenceInterval = setInterval(async () => {
            try {
              const silenceDuration = Date.now() - lastMessageTime;
              if (
                silenceDuration > SILENCE_THRESHOLD_MS &&
                Date.now() - lastSpokeAt > MIN_SPEAK_GAP_MS &&
                canDo("send_message") &&
                Math.random() < PULSE_PROBABILITY
              ) {
                record("send_message");
                const pulseUserPrompt = `The team has been quiet for a while. As ${P.name} (${P.role}), bring up a new work topic relevant to your expertise. 1-2 sentences, conversational.`;
                const topic = await callLLM(systemPromptFor(pulseUserPrompt), pulseUserPrompt, 100);
                if (topic) {
                  send({ type: "send_message", channel: ch, content: topic });
                  lastMessageTime = Date.now();
                  lastSpokeAt = Date.now();
                  console.log(`[pulse] ${P.name}: ${topic.slice(0, 80)}`);
                }
              }
            } catch (err) {
              console.error(`[pulse] ${P.name} error:`, (err as Error).message);
            }
          }, PULSE_CHECK_MS);
          // Clean up on close
          ws.addEventListener("close", () => clearInterval(silenceInterval));
        }
        break;

      case "auth_error":
        console.error(`[!] ${P.name} auth failed: ${data.reason}`);
        process.exit(1); // no break: process exits

      case "message_posted": {
        const msg: Message = {
          id: data.message_id,
          author: data.author,
          content: data.content,
          channel: data.channel,
        };

        // Skip own messages (still add to history)
        if (data.author_id === agentId) {
          addToHistory(msg);
          break;
        }

        addToHistory(msg);
        lastMessageTime = Date.now();
        messagesSinceLastArtifact++;

        // Maybe react (fast, no LLM)
        if (shouldReact(msg)) {
          record("add_reaction");
          const emoji = REACTIONS[Math.floor(Math.random() * REACTIONS.length)];
          setTimeout(() => {
            send({ type: "add_reaction", target_message_id: msg.id, emoji });
          }, 1000 + Math.random() * 3000);
        }

        // Maybe respond (LLM, slower)
        if (shouldRespond(msg)) {
          record("send_message");
          const delay = 3000 + Math.random() * 5000;
          setTimeout(async () => {
            const reply = await askLLMReply(msg);
            if (reply) {
              send({ type: "send_message", channel: data.channel, content: reply });
              lastSpokeAt = Date.now();
              addToHistory({ id: "", author: P.name, content: reply, channel: data.channel });
              console.log(`[→ ${data.channel}] ${reply.slice(0, 100)}`);
            }
          }, delay);
        }

        // Maybe create an artifact (fire-and-forget with error trap)
        maybeCreateArtifact().catch((err) => console.error(`[!] artifact error:`, err));
        break;
      }

      case "artifact_created":
        console.log(`[art] ${data.author_name} created ${data.artifact_type}: "${data.title}"`);
        break;

      case "reaction_added":
        if (data.author !== P.name) {
          console.log(`[react] ${data.author} ${data.emoji}`);
        }
        break;

      case "evaluate_artifact": {
        console.log(`[eval] ${P.name} received evaluation request ${data.evaluation_id}`);
        // The full eval prompt (rubric + scoring instructions + RANDOMIZED
        // example tuple + anonymized artifact content) is now assembled by
        // the server in peer-evaluation.ts:buildEvalPrompt — see hive-fleet#178
        // v2 for why. The agent's job here is just to forward it to the LLM.
        const evalSystemPrompt = "You are an impartial quality evaluator. You evaluate artifacts objectively using a rubric. Always respond with valid JSON only, no markdown, no explanation outside the JSON.";
        const evalPrompt = data.eval_prompt as string;
        const evaluationId = data.evaluation_id as string;

        if (LLM_BATCH_PEER_EVAL && batchIsSupported(LLM_BASE_URL) && LLM_API_KEY) {
          // Lazy-init the buffer on first eval so agents that never receive
          // evaluate_artifact events don't hold timers.
          if (!evalBuffer) {
            evalBuffer = new EvalBatchBuffer({
              flushAfterMs: PEER_EVAL_BATCH_FLUSH_MS,
              maxQueueSize: PEER_EVAL_BATCH_MAX_QUEUE,
              model: LLM_MODEL,
              batchOptions: { baseUrl: LLM_BASE_URL, apiKey: LLM_API_KEY },
              perRequestFallback: callLLM,
              onResult: (evalId, text) => handleEvalResponse(evalId, text),
            });
          }
          evalBuffer.enqueue({
            evaluationId,
            systemPrompt: evalSystemPrompt,
            userPrompt: evalPrompt,
            maxTokens: 1000,
          });
        } else {
          callLLM(evalSystemPrompt, evalPrompt, 1000).then(response => {
            if (!response) return;
            handleEvalResponse(evaluationId, response);
          }).catch(err => {
            console.error(`[eval] ${P.name} evaluation error:`, err);
          });
        }
        break;
      }

      case "rate_limited":
        console.warn(`[!] Rate limited on ${data.action}, cooling off for ${data.retry_after}s`);
        coolOff(data.action, data.retry_after);
        break;

      case "error":
        console.error(`[!] Server error: ${data.message}`);
        break;
    }
  };

  ws.onclose = () => {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    // Exponential backoff with jitter: 5s, 10s, 20s, 40s, capped at 60s
    const delay = Math.min(5000 * Math.pow(2, reconnectAttempt), 60_000) + Math.random() * 1000;
    reconnectAttempt++;
    console.log(`[~] ${P.name} disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(connect, delay);
  };

  ws.onerror = (err) => {
    console.error(`[!] ${P.name} WebSocket error:`, err);
    // Force close to trigger reconnect via onclose handler
    try { ws.close(); } catch { /* already closing */ }
  };
}

async function shutdown() {
  console.log(`\n[~] ${P.name} shutting down...`);
  // Drain any buffered peer-eval prompts before we exit so the server
  // doesn't have to wait for its own retry timeout to reissue them.
  if (evalBuffer) {
    try {
      await Promise.race([
        evalBuffer.flushNow(),
        new Promise((r) => setTimeout(r, 5_000)),
      ]);
    } catch (err) {
      console.error(`[eval-batch] flushNow on shutdown failed: ${(err as Error).message}`);
    }
  }
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  if (toolConfigs.length > 0) {
    console.log(`[~] ${P.name} connecting to ${toolConfigs.length} MCP tool server(s)...`);
    mcpClients = await connectMCPClients(toolConfigs);
    if (mcpClients.length === 0) {
      // Operator explicitly asked for tools; all servers failed. Log loud so
      // this isn't mistaken for a silent fallback to plain-chat mode.
      console.warn(`[!] ${P.name} requested ${toolConfigs.length} tool server(s) but none connected — continuing without tools.`);
    } else {
      const toolNames = (await Promise.all(mcpClients.map((c) => c.listTools())))
        .flat()
        .map((t) => t.name);
      console.log(`[+] ${P.name} tools ready: ${toolNames.join(", ") || "(none)"}`);
    }
  }
  connect();
}

main().catch((err) => {
  console.error(`[!] ${P.name} fatal boot error:`, err);
  process.exit(1);
});
