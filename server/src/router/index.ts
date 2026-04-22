import type { ServerWebSocket } from "bun";
import type { ServerEvent } from "../protocol/types";

export type AgentSocket = ServerWebSocket<{
  type: "agent";
  agentId: string;
  agentName: string;
  bureauId: string | null;
  authenticated: boolean;
}>;

export type SpectatorSocket = ServerWebSocket<{
  type: "spectator";
  watchingBureauId: string | null;
  watchingAll: boolean;
  ip: string;
}>;

class Router {
  // bureau_id → Set of agent WebSocket connections
  private agentConns = new Map<string, Set<AgentSocket>>();
  // bureau_id → Set of spectator WebSocket connections
  private spectatorConns = new Map<string, Set<SpectatorSocket>>();
  // agent_id → WebSocket (for direct messaging)
  private agentById = new Map<string, AgentSocket>();
  private allWatcherConns = new Set<SpectatorSocket>();

  addAgent(bureauId: string, ws: AgentSocket): void {
    if (!this.agentConns.has(bureauId)) {
      this.agentConns.set(bureauId, new Set());
    }
    this.agentConns.get(bureauId)!.add(ws);
    this.agentById.set(ws.data.agentId, ws);
  }

  removeAgent(ws: AgentSocket): void {
    const bureauId = ws.data.bureauId;
    if (bureauId) {
      this.agentConns.get(bureauId)?.delete(ws);
      if (this.agentConns.get(bureauId)?.size === 0) {
        this.agentConns.delete(bureauId);
      }
    }
    this.agentById.delete(ws.data.agentId);
  }

  addSpectator(bureauId: string, ws: SpectatorSocket): void {
    if (!this.spectatorConns.has(bureauId)) {
      this.spectatorConns.set(bureauId, new Set());
    }
    this.spectatorConns.get(bureauId)!.add(ws);
  }

  removeSpectator(ws: SpectatorSocket): void {
    const bureauId = ws.data.watchingBureauId;
    if (bureauId) {
      this.spectatorConns.get(bureauId)?.delete(ws);
      if (this.spectatorConns.get(bureauId)?.size === 0) {
        this.spectatorConns.delete(bureauId);
      }
    }
    this.allWatcherConns.delete(ws);
  }

  /** Broadcast event to all agents in a bureau EXCEPT the sender */
  broadcastToBureau(
    bureauId: string,
    event: ServerEvent,
    excludeAgentId?: string
  ): void {
    const agents = this.agentConns.get(bureauId);
    if (!agents) return;

    const payload = JSON.stringify(event);
    for (const ws of agents) {
      if (ws.data.agentId !== excludeAgentId) {
        ws.send(payload);
      }
    }
  }

  /** Broadcast event to all spectators watching a bureau */
  broadcastToSpectators(bureauId: string, event: ServerEvent): void {
    const spectators = this.spectatorConns.get(bureauId);
    if (!spectators) return;

    const payload = JSON.stringify(event);
    for (const ws of spectators) {
      ws.send(payload);
    }
  }

  /** Broadcast to both agents (except sender) and spectators */
  broadcast(
    bureauId: string,
    event: ServerEvent,
    excludeAgentId?: string
  ): void {
    this.broadcastToBureau(bureauId, event, excludeAgentId);
    this.broadcastToSpectators(bureauId, event);
  }

  /** Send event to a specific agent */
  sendToAgent(agentId: string, event: ServerEvent): void {
    const ws = this.agentById.get(agentId);
    if (ws) {
      ws.send(JSON.stringify(event));
    }
  }

  /** Get the WebSocket for a specific agent (if connected) */
  getAgentSocket(agentId: string): AgentSocket | undefined {
    return this.agentById.get(agentId);
  }

  /** Get list of connected agents in a bureau */
  getBureauAgents(bureauId: string): AgentSocket[] {
    return Array.from(this.agentConns.get(bureauId) || []);
  }

  /** Broadcast to ALL agents across all bureaux (for #public) */
  broadcastToAll(event: ServerEvent, excludeAgentId?: string): void {
    const payload = JSON.stringify(event);
    for (const agents of this.agentConns.values()) {
      for (const ws of agents) {
        if (ws.data.agentId !== excludeAgentId) {
          ws.send(payload);
        }
      }
    }
    this.broadcastToAllSpectators(event);
  }

  /** Broadcast to ALL spectators across all bureaux */
  broadcastToAllSpectators(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const spectators of this.spectatorConns.values()) {
      for (const ws of spectators) {
        ws.send(payload);
      }
    }
  }

  addAllWatcher(ws: SpectatorSocket): void {
    this.allWatcherConns.add(ws);
  }

  broadcastToAllWatchers(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.allWatcherConns) {
      ws.send(payload);
    }
  }

  /** Stats */
  stats(): { agents: number; spectators: number; bureaux: number } {
    let agents = 0;
    let spectators = 0;
    for (const set of this.agentConns.values()) agents += set.size;
    for (const set of this.spectatorConns.values()) spectators += set.size;
    return {
      agents,
      spectators,
      bureaux: this.agentConns.size,
    };
  }
}

export const router = new Router();
