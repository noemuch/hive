/**
 * Simple test agent for Hive.
 *
 * Usage:
 *   HIVE_API_KEY=your_key bun agents/simple-agent.ts
 *
 * This agent connects, listens for messages, and replies with simple responses.
 * No LLM required — it's a basic echo/response agent for testing the protocol.
 */

const API_KEY = process.env.HIVE_API_KEY;
const SERVER_URL = process.env.HIVE_URL || "ws://localhost:3000/agent";

if (!API_KEY) {
  console.error("ERROR: Set HIVE_API_KEY environment variable");
  process.exit(1);
}

const RESPONSES = [
  "Interesting point. Let me think about that.",
  "I agree, we should move forward with this approach.",
  "Could you elaborate on that? I want to make sure I understand correctly.",
  "Good idea. I'll create a ticket for this.",
  "Let me check the existing specs before we proceed.",
  "That aligns with what we discussed earlier.",
  "I have a concern about the timeline. Can we discuss?",
  "Noted. I'll update the artifact accordingly.",
  "Makes sense. What's the priority on this?",
  "I'll take the lead on this one.",
];

let agentName = "unknown";
let channels: { id: string; name: string }[] = [];

function connect() {
  console.log(`Connecting to ${SERVER_URL}...`);
  const ws = new WebSocket(SERVER_URL);

  ws.onopen = () => {
    console.log("Connected. Authenticating...");
    ws.send(JSON.stringify({ type: "auth", api_key: API_KEY }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data as string);

    switch (data.type) {
      case "auth_ok":
        agentName = data.agent_name;
        channels = data.channels || [];
        console.log(`Authenticated as ${agentName}`);
        // `bureau` is the canonical auth_ok field post-migration 038.
        // Accept `company` as a legacy alias during rollout.
        const bureauInfo = data.bureau ?? data.company;
        if (bureauInfo) {
          console.log(`Bureau: ${bureauInfo.name}`);
          console.log(`Channels: ${channels.map((c) => c.name).join(", ")}`);
          console.log(
            `Teammates: ${data.teammates?.map((t: { name: string }) => t.name).join(", ") || "none"}`
          );
        } else {
          console.log("No bureau assigned yet.");
        }

        // Start heartbeat
        setInterval(() => {
          ws.send(JSON.stringify({ type: "heartbeat" }));
        }, 60_000);

        // Send an initial greeting after 2 seconds
        setTimeout(() => {
          if (channels.length > 0) {
            const generalChannel =
              channels.find((c) => c.name === "#general") || channels[0];
            ws.send(
              JSON.stringify({
                type: "send_message",
                channel: generalChannel.name,
                content: `Hey team! ${agentName} here, ready to work.`,
              })
            );
          }
        }, 2000);
        break;

      case "auth_error":
        console.error(`Auth failed: ${data.reason}`);
        process.exit(1);
        break;

      case "message_posted":
        console.log(
          `[${data.channel}] ${data.author}: ${data.content.slice(0, 100)}`
        );

        // Reply to messages ~30% of the time with a random delay
        if (Math.random() < 0.3) {
          const delay = 3000 + Math.random() * 7000; // 3-10 seconds
          setTimeout(() => {
            const response =
              RESPONSES[Math.floor(Math.random() * RESPONSES.length)];
            ws.send(
              JSON.stringify({
                type: "send_message",
                channel: data.channel,
                content: response,
              })
            );
          }, delay);
        }
        break;

      case "agent_joined":
        console.log(`→ ${data.name} joined the bureau`);
        break;

      case "agent_left":
        console.log(`← ${data.agent_id} left (${data.reason})`);
        break;

      case "rate_limited":
        console.warn(`Rate limited on ${data.action}. Retry in ${data.retry_after}s`);
        break;

      case "error":
        console.error(`Server error: ${data.message}`);
        break;

      default:
        console.log(`Received: ${data.type}`, data);
    }
  };

  ws.onclose = () => {
    console.log("Disconnected. Reconnecting in 5s...");
    setTimeout(connect, 5000);
  };

  ws.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}

connect();
