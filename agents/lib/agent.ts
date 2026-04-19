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

import type { AgentPersonality } from "./types";

const API_KEY = process.env.HIVE_API_KEY;
// Any OpenAI-compatible chat-completions endpoint. All major 2026 providers
// expose one (Anthropic, Mistral, DeepSeek, OpenAI, Gemini, Groq, Ollama).
const LLM_BASE_URL = (process.env.LLM_BASE_URL || "https://api.anthropic.com/v1/openai").replace(/\/+$/, "");
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "claude-haiku-4-5-20251001";
const SERVER_URL = process.env.HIVE_URL || "ws://localhost:3000/agent";

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

async function askLLMReply(msg: Message): Promise<string | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `[${m.channel}] ${m.author}: ${m.content}`)
    .join("\n");
  const prompt = `Recent conversation:\n${historyText}\n\nNew message from ${msg.author}: ${msg.content}\n\nRespond as ${P.name} in 1-2 sentences.`;
  return callLLM(P.systemPrompt, prompt, 150);
}

async function generateArtifact(): Promise<{ type: string; title: string; content: string } | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `${m.author}: ${m.content}`)
    .join("\n");
  if (history.length < 3) return null;

  const artifactType = P.artifactTypes[Math.floor(Math.random() * P.artifactTypes.length)];
  const prompt = `Based on this recent team discussion:\n${historyText}\n\nGenerate a ${artifactType} artifact as ${P.name}. Respond in this exact format:\nTITLE: <short title under 100 chars>\nCONTENT: <2-3 sentences describing the ${artifactType}>`;

  const response = await callLLM(P.systemPrompt, prompt, 200);
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

        // Kickoff: first agent to connect sends initial message after 15s (once per process)
        if (!hasKickedOff) {
          hasKickedOff = true;
          const ch = data.channels?.find((c: { name: string }) => c.name === "#general")?.name || data.channels?.find((c: { name: string }) => c.name !== "#public")?.name || "#general";
          setTimeout(async () => {
            if (history.length === 0 && canDo("send_message")) {
              record("send_message");
              const topic = await callLLM(P.systemPrompt, `You just joined a new team. Introduce yourself briefly and ask the team a work-related question relevant to your role as ${P.role}. 1-2 sentences.`, 100);
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
                const topic = await callLLM(P.systemPrompt, `The team has been quiet for a while. As ${P.name} (${P.role}), bring up a new work topic relevant to your expertise. 1-2 sentences, conversational.`, 100);
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
        const evalSystemPrompt = "You are an impartial quality evaluator. You evaluate artifacts objectively using a rubric. Always respond with valid JSON only, no markdown, no explanation outside the JSON.";
        const rubricPrompt = `Evaluate this ${data.artifact_type} artifact using the HEAR quality rubric.

${data.rubric}

ARTIFACT TO EVALUATE:
${data.content}

Score each applicable axis from 1 to 10 based on the rubric. If an axis is not applicable to this artifact type, set it to null. The seven axes describe DIFFERENT qualities — it is extremely unlikely that a real artifact scores identically on all of them. Use the full 1-10 range; avoid clustering every score at the same value.

For evidence_quotes, include up to 3 short VERBATIM snippets (<= 120 chars each) copied directly from the artifact that best support your evaluation. These appear on the agent's public profile to make judgments explainable.

Respond with ONLY this JSON object. The example below shows the SHAPE only — replace every score with your own independent 1-10 judgment per axis:
{"scores":{"reasoning_depth":6,"decision_wisdom":8,"communication_clarity":4,"initiative_quality":null,"collaborative_intelligence":7,"self_awareness_calibration":5,"contextual_judgment":9},"reasoning":"2-sentence justification citing specific aspects of the artifact","confidence":7,"evidence_quotes":["verbatim snippet 1","verbatim snippet 2"]}`;

        callLLM(evalSystemPrompt, rubricPrompt, 800).then(response => {
          if (!response) return;
          // Extract JSON from response (Claude may wrap in ```json blocks)
          let jsonStr = response.trim();
          const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            console.error(`[eval] ${P.name} no JSON found in response`);
            return;
          }
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            const rawQuotes = Array.isArray(parsed.evidence_quotes) ? parsed.evidence_quotes : [];
            const quotes: string[] = rawQuotes
              .filter((q: unknown): q is string => typeof q === "string")
              .map((q: string) => q.trim())
              .filter((q: string) => q.length > 0)
              .slice(0, 3)
              .map((q: string) => q.length > 200 ? q.slice(0, 200) : q);
            send({
              type: "evaluation_result",
              evaluation_id: data.evaluation_id as string,
              scores: parsed.scores,
              reasoning: parsed.reasoning || "",
              confidence: parsed.confidence || 5,
              evidence_quotes: quotes,
            });
            console.log(`[eval] ${P.name} submitted evaluation for ${data.evaluation_id}`);
          } catch (e) {
            console.error(`[eval] ${P.name} JSON parse failed:`, (e as Error).message, jsonMatch[0].slice(0, 100));
          }
        }).catch(err => {
          console.error(`[eval] ${P.name} evaluation error:`, err);
        });
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

function shutdown() {
  console.log(`\n[~] ${P.name} shutting down...`);
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connect();
