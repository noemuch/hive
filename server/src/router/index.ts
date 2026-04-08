import type { ServerWebSocket } from "bun";
import type { ServerEvent } from "../protocol/types";

export type AgentSocket = ServerWebSocket<{
  type: "agent";
  agentId: string;
  agentName: string;
  companyId: string | null;
  authenticated: boolean;
}>;

export type SpectatorSocket = ServerWebSocket<{
  type: "spectator";
  watchingCompanyId: string | null;
  watchingAll: boolean;
}>;

class Router {
  // company_id → Set of agent WebSocket connections
  private agentConns = new Map<string, Set<AgentSocket>>();
  // company_id → Set of spectator WebSocket connections
  private spectatorConns = new Map<string, Set<SpectatorSocket>>();
  // agent_id → WebSocket (for direct messaging)
  private agentById = new Map<string, AgentSocket>();
  private allWatcherConns = new Set<SpectatorSocket>();

  addAgent(companyId: string, ws: AgentSocket): void {
    if (!this.agentConns.has(companyId)) {
      this.agentConns.set(companyId, new Set());
    }
    this.agentConns.get(companyId)!.add(ws);
    this.agentById.set(ws.data.agentId, ws);
  }

  removeAgent(ws: AgentSocket): void {
    const companyId = ws.data.companyId;
    if (companyId) {
      this.agentConns.get(companyId)?.delete(ws);
      if (this.agentConns.get(companyId)?.size === 0) {
        this.agentConns.delete(companyId);
      }
    }
    this.agentById.delete(ws.data.agentId);
  }

  addSpectator(companyId: string, ws: SpectatorSocket): void {
    if (!this.spectatorConns.has(companyId)) {
      this.spectatorConns.set(companyId, new Set());
    }
    this.spectatorConns.get(companyId)!.add(ws);
  }

  removeSpectator(ws: SpectatorSocket): void {
    const companyId = ws.data.watchingCompanyId;
    if (companyId) {
      this.spectatorConns.get(companyId)?.delete(ws);
      if (this.spectatorConns.get(companyId)?.size === 0) {
        this.spectatorConns.delete(companyId);
      }
    }
    this.allWatcherConns.delete(ws);
  }

  /** Broadcast event to all agents in a company EXCEPT the sender */
  broadcastToCompany(
    companyId: string,
    event: ServerEvent,
    excludeAgentId?: string
  ): void {
    const agents = this.agentConns.get(companyId);
    if (!agents) return;

    const payload = JSON.stringify(event);
    for (const ws of agents) {
      if (ws.data.agentId !== excludeAgentId) {
        ws.send(payload);
      }
    }
  }

  /** Broadcast event to all spectators watching a company */
  broadcastToSpectators(companyId: string, event: ServerEvent): void {
    const spectators = this.spectatorConns.get(companyId);
    if (!spectators) return;

    const payload = JSON.stringify(event);
    for (const ws of spectators) {
      ws.send(payload);
    }
  }

  /** Broadcast to both agents (except sender) and spectators */
  broadcast(
    companyId: string,
    event: ServerEvent,
    excludeAgentId?: string
  ): void {
    this.broadcastToCompany(companyId, event, excludeAgentId);
    this.broadcastToSpectators(companyId, event);
  }

  /** Send event to a specific agent */
  sendToAgent(agentId: string, event: ServerEvent): void {
    const ws = this.agentById.get(agentId);
    if (ws) {
      ws.send(JSON.stringify(event));
    }
  }

  /** Get list of connected agents in a company */
  getCompanyAgents(companyId: string): AgentSocket[] {
    return Array.from(this.agentConns.get(companyId) || []);
  }

  /** Broadcast to ALL agents across all companies (for #public) */
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

  /** Broadcast to ALL spectators across all companies */
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

  removeAllWatcher(ws: SpectatorSocket): void {
    this.allWatcherConns.delete(ws);
  }

  broadcastToAllWatchers(event: ServerEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.allWatcherConns) {
      ws.send(payload);
    }
  }

  /** Stats */
  stats(): { agents: number; spectators: number; companies: number } {
    let agents = 0;
    let spectators = 0;
    for (const set of this.agentConns.values()) agents += set.size;
    for (const set of this.spectatorConns.values()) spectators += set.size;
    return {
      agents,
      spectators,
      companies: this.agentConns.size,
    };
  }
}

export const router = new Router();
