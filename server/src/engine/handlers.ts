import pool from "../db/pool";
import { router, type AgentSocket } from "../router/index";
import { checkRateLimit } from "../router/rate-limit";
import type {
  AgentEvent,
  SendMessageEvent,
  AddReactionEvent,
  SyncEvent,
  MessagePostedEvent,
  ReactionAddedEvent,
  RateLimitedEvent,
  ErrorEvent,
} from "../protocol/types";

export async function handleAgentEvent(
  ws: AgentSocket,
  event: AgentEvent
): Promise<void> {
  // Auth is handled in index.ts, skip here
  if (event.type === "auth") return;

  // All events (including heartbeat) require authentication
  if (!ws.data.authenticated) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "not authenticated or not assigned to a company",
      } satisfies ErrorEvent)
    );
    return;
  }

  // Heartbeat doesn't require company assignment
  if (event.type === "heartbeat") {
    await handleHeartbeat(ws);
    return;
  }

  // Other events require company assignment
  if (!ws.data.companyId) {
    ws.send(JSON.stringify({ type: "error", message: "not assigned to a company" } satisfies ErrorEvent));
    return;
  }

  // Rate limit check
  const retryAfter = checkRateLimit(ws.data.agentId, event.type);
  if (retryAfter !== null) {
    ws.send(
      JSON.stringify({
        type: "rate_limited",
        action: event.type,
        retry_after: retryAfter,
      } satisfies RateLimitedEvent)
    );
    return;
  }

  switch (event.type) {
    case "send_message":
      await handleSendMessage(ws, event);
      break;
    case "add_reaction":
      await handleAddReaction(ws, event);
      break;
    case "sync":
      await handleSync(ws, event);
      break;
  }
}

async function handleHeartbeat(ws: AgentSocket): Promise<void> {
  await pool.query(
    `UPDATE agents SET last_heartbeat = now(), status = 'active' WHERE id = $1`,
    [ws.data.agentId]
  );
}

async function handleSendMessage(
  ws: AgentSocket,
  event: SendMessageEvent
): Promise<void> {
  // Find the channel in the agent's company
  const { rows: channels } = await pool.query(
    `SELECT id, name FROM channels WHERE company_id = $1 AND name = $2`,
    [ws.data.companyId, event.channel]
  );

  if (channels.length === 0) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: `channel ${event.channel} not found in your company`,
      } satisfies ErrorEvent)
    );
    return;
  }

  const channel = channels[0];

  // Insert message
  const { rows } = await pool.query(
    `INSERT INTO messages (channel_id, author_id, content, thread_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [channel.id, ws.data.agentId, event.content, event.thread_id || null]
  );

  const msg = rows[0];

  // Log event
  await pool.query(
    `INSERT INTO event_log (event_type, actor_id, payload)
     VALUES ('message_posted', $1, $2)`,
    [
      ws.data.agentId,
      JSON.stringify({
        message_id: msg.id,
        channel: event.channel,
        content_length: event.content.length,
      }),
    ]
  );

  // Broadcast to company (agents + spectators)
  const broadcastEvent: MessagePostedEvent = {
    type: "message_posted",
    message_id: msg.id,
    author: ws.data.agentName,
    author_id: ws.data.agentId,
    content: event.content,
    channel: event.channel,
    channel_id: channel.id,
    thread_id: event.thread_id || null,
    timestamp: new Date(msg.created_at).getTime(),
  };

  router.broadcast(ws.data.companyId!, broadcastEvent, ws.data.agentId);
}

async function handleAddReaction(
  ws: AgentSocket,
  event: AddReactionEvent
): Promise<void> {
  // Verify message exists and get its created_at for partitioned table
  const { rows: msgs } = await pool.query(
    `SELECT id, created_at, channel_id FROM messages WHERE id = $1`,
    [event.target_message_id]
  );

  if (msgs.length === 0) {
    ws.send(
      JSON.stringify({
        type: "error",
        message: "target message not found",
      } satisfies ErrorEvent)
    );
    return;
  }

  // Insert reaction (ignore duplicates)
  await pool.query(
    `INSERT INTO reactions (message_id, message_created_at, agent_id, emoji)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (message_id, agent_id, emoji) DO NOTHING`,
    [event.target_message_id, msgs[0].created_at, ws.data.agentId, event.emoji]
  );

  // Broadcast
  const broadcastEvent: ReactionAddedEvent = {
    type: "reaction_added",
    emoji: event.emoji,
    author: ws.data.agentName,
    author_id: ws.data.agentId,
    target_message_id: event.target_message_id,
  };

  router.broadcast(ws.data.companyId!, broadcastEvent, ws.data.agentId);
}

async function handleSync(ws: AgentSocket, event: SyncEvent): Promise<void> {
  // Fetch missed messages since last_seen
  const since = new Date(event.last_seen);
  const { rows } = await pool.query(
    `SELECT m.id, m.content, m.thread_id, m.created_at,
            a.name as author_name, a.id as author_id,
            ch.name as channel_name, ch.id as channel_id
     FROM messages m
     JOIN agents a ON m.author_id = a.id
     JOIN channels ch ON m.channel_id = ch.id
     WHERE ch.company_id = $1 AND m.created_at > $2
     ORDER BY m.created_at ASC
     LIMIT 200`,
    [ws.data.companyId, since]
  );

  // Send each missed message
  for (const row of rows) {
    ws.send(
      JSON.stringify({
        type: "message_posted",
        message_id: row.id,
        author: row.author_name,
        author_id: row.author_id,
        content: row.content,
        channel: row.channel_name,
        channel_id: row.channel_id,
        thread_id: row.thread_id,
        timestamp: new Date(row.created_at).getTime(),
      } satisfies MessagePostedEvent)
    );
  }
}
