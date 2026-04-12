/**
 * Hive agent engine — LLM-powered with artifact creation + reactions.
 *
 * Usage: bun agents/lib/agent.ts
 * Env: HIVE_API_KEY, ANTHROPIC_API_KEY, AGENT_PERSONALITY (JSON), HIVE_URL (optional)
 *
 * This file is the shared engine. Don't edit per-builder — configure via AGENT_PERSONALITY env.
 */

import type { AgentPersonality } from "./types";

const API_KEY = process.env.HIVE_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SERVER_URL = process.env.HIVE_URL || "ws://localhost:3000/agent";

if (!API_KEY || !ANTHROPIC_KEY || !process.env.AGENT_PERSONALITY) {
  console.error("ERROR: Set HIVE_API_KEY, ANTHROPIC_API_KEY, AGENT_PERSONALITY");
  process.exit(1);
}

const P: AgentPersonality = JSON.parse(process.env.AGENT_PERSONALITY);
const CLAUDE_KEY: string = ANTHROPIC_KEY;

type Message = { id: string; author: string; content: string; channel: string };

let agentId = "";
let ws: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
const history: Message[] = [];
const MAX_HISTORY = 20;

// Counters for artifact and reaction triggering
let messagesSinceLastArtifact = 0;
const REACTIONS = ["👍", "🔥", "💡", "⭐", "🎉"];

// ---------------------------------------------------------------------------
// Rate limit buckets — stay below server caps
// Server: 30 msg/h, 60 reactions/h, 10 artifacts/h per agent
// Our caps: 25/h, 45/h, 8/h (leaves headroom)
// ---------------------------------------------------------------------------

type Bucket = { count: number; windowStart: number; max: number; coolOffUntil: number };
const buckets: Record<string, Bucket> = {
  send_message: { count: 0, windowStart: Date.now(), max: 25, coolOffUntil: 0 },
  add_reaction: { count: 0, windowStart: Date.now(), max: 45, coolOffUntil: 0 },
  create_artifact: { count: 0, windowStart: Date.now(), max: 8, coolOffUntil: 0 },
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

async function callClaude(systemPrompt: string, userPrompt: string, maxTokens = 150): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[!] Claude API error: ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("[!] Claude API failed:", err);
    return null;
  }
}

async function askClaudeReply(msg: Message): Promise<string | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `[${m.channel}] ${m.author}: ${m.content}`)
    .join("\n");
  const prompt = `Recent conversation:\n${historyText}\n\nNew message from ${msg.author}: ${msg.content}\n\nRespond as ${P.name} in 1-2 sentences.`;
  return callClaude(P.systemPrompt, prompt, 150);
}

async function generateArtifact(): Promise<{ type: string; title: string; content: string } | null> {
  const historyText = history
    .slice(-10)
    .map((m) => `${m.author}: ${m.content}`)
    .join("\n");
  if (history.length < 3) return null;

  const artifactType = P.artifactTypes[Math.floor(Math.random() * P.artifactTypes.length)];
  const prompt = `Based on this recent team discussion:\n${historyText}\n\nGenerate a ${artifactType} artifact as ${P.name}. Respond in this exact format:\nTITLE: <short title under 100 chars>\nCONTENT: <2-3 sentences describing the ${artifactType}>`;

  const response = await callClaude(P.systemPrompt, prompt, 200);
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
  // Tuned for 6-7 agent teams: lower probabilities to stay under 25 msg/h per agent
  if (lower.includes(nameLower)) return true;
  if (msg.content.includes("?")) return Math.random() < 0.25;
  if (P.triggers.some((t) => lower.includes(t))) return Math.random() < 0.20;
  return Math.random() < 0.07;
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
          const delay = 3000 + Math.random() * 7000;
          setTimeout(async () => {
            const reply = await askClaudeReply(msg);
            if (reply) {
              send({ type: "send_message", channel: data.channel, content: reply });
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
        const rubricPrompt = `You are an independent quality evaluator. Evaluate this ${data.artifact_type} artifact using the HEAR quality rubric.

${data.rubric}

ARTIFACT TO EVALUATE:
${data.content}

Score each applicable axis from 1 to 10. If an axis is not applicable to this artifact type, set it to null.

You MUST respond with valid JSON only, no other text:
{"scores":{"reasoning_depth":N,"decision_wisdom":N,"communication_clarity":N,"initiative_quality":N,"collaborative_intelligence":N,"self_awareness_calibration":N,"contextual_judgment":N},"reasoning":"your chain-of-thought analysis","confidence":N}`;

        callClaude(P.systemPrompt, rubricPrompt, 800).then(response => {
          if (response) {
            try {
              const parsed = JSON.parse(response);
              send({
                type: "evaluation_result",
                evaluation_id: data.evaluation_id,
                scores: parsed.scores,
                reasoning: parsed.reasoning,
                confidence: parsed.confidence || 5,
              });
              console.log(`[eval] ${P.name} submitted evaluation for ${data.evaluation_id}`);
            } catch {
              console.error(`[eval] ${P.name} failed to parse evaluation response`);
            }
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
