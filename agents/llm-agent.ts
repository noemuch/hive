/**
 * LLM-powered agent for Order66. Uses Claude Haiku for natural conversation.
 * Usage: ANTHROPIC_API_KEY=sk-... ORDER66_API_KEY=xxx AGENT_ROLE=developer bun agents/llm-agent.ts
 * Env: ORDER66_API_KEY, ANTHROPIC_API_KEY (required) | AGENT_ROLE, AGENT_NAME, AGENT_PERSONALITY, RESPONSE_RATE (optional)
 */

const API_KEY = process.env.ORDER66_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SERVER_URL = process.env.ORDER66_URL || "ws://localhost:3000/agent";
const ROLE = (process.env.AGENT_ROLE || "developer") as keyof typeof PERSONALITIES;
const RESPONSE_RATE = parseFloat(process.env.RESPONSE_RATE || "0.5");

if (!API_KEY || !ANTHROPIC_KEY) {
  console.error("ERROR: Set ORDER66_API_KEY and ANTHROPIC_API_KEY environment variables");
  process.exit(1);
}

const PERSONALITIES = {
  pm: "You are a product manager. You structure discussions, create project plans, ask about priorities and deadlines, summarize decisions.",
  designer: "You are a product designer. You propose UI/UX solutions, think about user experience, suggest visual approaches, reference design systems.",
  developer: "You are a software developer. You discuss technical feasibility, ask about edge cases, propose implementations, think about architecture.",
  qa: "You are a QA engineer. You challenge assumptions, ask about acceptance criteria, think about edge cases, propose testing strategies.",
} as const;

type Message = { author: string; content: string; channel: string };

let agentName = "agent";
let agentId = "";
let channels: { id: string; name: string }[] = [];
let ws: WebSocket | null = null;
const history: Message[] = [];
const MAX_HISTORY = 20;

const personality = process.env.AGENT_PERSONALITY || PERSONALITIES[ROLE] || PERSONALITIES.developer;

function buildSystemPrompt(): string {
  return `${personality}\nYou are "${agentName}" (role: ${ROLE}) in a team chat. Keep responses under 2 sentences. Be conversational, not formal. Don't use emojis excessively. Respond naturally as a teammate would in Slack.`;
}

async function askClaude(newMessage: Message): Promise<string | null> {
  const messages = [...history, newMessage].map((m) => ({
    role: m.author === agentName ? ("assistant" as const) : ("user" as const),
    content: m.author === agentName ? m.content : `[${m.channel}] ${m.author}: ${m.content}`,
  }));
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
        system: buildSystemPrompt(),
        messages,
      }),
    });

    if (!res.ok) {
      console.error(`Claude API error: ${res.status} ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error("Claude API call failed:", err);
    return null;
  }
}

function shouldRespond(msg: Message): boolean {
  if (msg.author === agentName) return false;
  const lower = msg.content.toLowerCase();
  const nameLower = agentName.toLowerCase();
  if (lower.includes(nameLower) || lower.includes(`@${nameLower}`)) return true;
  if (msg.content.includes("?")) return Math.random() < RESPONSE_RATE + 0.2;

  const kw: Record<string, string[]> = {
    pm: ["timeline", "priority", "deadline", "roadmap", "scope", "plan"],
    designer: ["design", "ui", "ux", "layout", "mockup", "wireframe", "figma"],
    developer: ["code", "api", "bug", "deploy", "build", "database", "architecture"],
    qa: ["test", "bug", "regression", "coverage", "criteria", "edge case"],
  };
  const keywords = kw[ROLE] || [];
  if (keywords.some((k) => lower.includes(k))) return Math.random() < RESPONSE_RATE + 0.15;
  return Math.random() < RESPONSE_RATE;
}

function addToHistory(msg: Message) {
  history.push(msg);
  if (history.length > MAX_HISTORY) history.shift();
}

function send(data: Record<string, unknown>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function connect() {
  console.log(`[~] Connecting to ${SERVER_URL}...`);
  ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    console.log("[~] Connected. Authenticating...");
    send({ type: "auth", api_key: API_KEY });
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);

    switch (data.type) {
      case "auth_ok":
        agentId = data.agent_id;
        agentName = process.env.AGENT_NAME || data.agent_name;
        channels = data.channels || [];
        console.log(`[+] Authenticated as ${agentName} (${ROLE})`);
        if (data.company) {
          console.log(`[+] Company: ${data.company.name}`);
          console.log(`[+] Channels: ${channels.map((c) => c.name).join(", ")}`);
          console.log(`[+] Teammates: ${data.teammates?.map((t: { name: string }) => t.name).join(", ") || "none"}`);
        }
        // Heartbeat
        setInterval(() => send({ type: "heartbeat" }), 60_000);
        break;

      case "auth_error":
        console.error(`[!] Auth failed: ${data.reason}`);
        process.exit(1);
        break;

      case "message_posted": {
        const msg: Message = { author: data.author, content: data.content, channel: data.channel };
        console.log(`[${data.channel}] ${data.author}: ${data.content.slice(0, 120)}`);

        // Skip own messages
        if (data.author_id === agentId) {
          addToHistory(msg);
          break;
        }

        addToHistory(msg);

        if (shouldRespond(msg)) {
          const delay = 2000 + Math.random() * 6000; // 2-8 seconds
          setTimeout(async () => {
            const reply = await askClaude(msg);
            if (reply) {
              send({ type: "send_message", channel: data.channel, content: reply });
              console.log(`[\u2192 ${data.channel}] ${reply.slice(0, 120)}`);
              addToHistory({ author: agentName, content: reply, channel: data.channel });
            }
          }, delay);
        }
        break;
      }

      case "agent_joined":
        console.log(`[+] ${data.name} joined the company`);
        break;

      case "agent_left":
        console.log(`[-] ${data.agent_id} left (${data.reason})`);
        break;

      case "rate_limited":
        console.warn(`[!] Rate limited on ${data.action}. Retry in ${data.retry_after}s`);
        break;

      case "error":
        console.error(`[!] Server error: ${data.message}`);
        break;
    }
  };

  ws.onclose = () => {
    console.log("[~] Disconnected. Reconnecting in 5s...");
    setTimeout(connect, 5000);
  };

  ws.onerror = (err) => {
    console.error("[!] WebSocket error:", err);
  };
}

// Graceful shutdown
function shutdown() {
  console.log("\n[~] Shutting down...");
  if (ws?.readyState === WebSocket.OPEN) ws.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

connect();
