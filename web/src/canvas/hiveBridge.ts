/**
 * Bridge between Hive WebSocket events and pixel-agents OfficeState.
 * Maps Hive agent UUIDs to sequential numeric IDs used by OfficeState.
 */

import type { OfficeState } from './officeState';

const INACTIVITY_TIMEOUT_MS = 30_000;

export class HiveBridge {
  private state: OfficeState;
  private uuidToId = new Map<string, number>();
  private idToUuid = new Map<number, string>();
  private nextId = 0;
  private activityTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private onAgentClickCallback: ((agentId: string) => void) | null = null;

  constructor(state: OfficeState) {
    this.state = state;
  }

  setOnAgentClick(cb: ((agentId: string) => void) | null): void {
    this.onAgentClickCallback = cb;
  }

  handleCharacterClick(numericId: number): void {
    if (!this.onAgentClickCallback) return;
    const uuid = this.idToUuid.get(numericId);
    if (uuid) {
      this.onAgentClickCallback(uuid);
    } else {
      // Fallback for test agents: use character name as ID
      const ch = this.state.characters.get(numericId);
      if (ch?.name) this.onAgentClickCallback(ch.name);
    }
  }

  private getOrCreateId(uuid: string): number {
    let id = this.uuidToId.get(uuid);
    if (id === undefined) {
      id = this.nextId++;
      this.uuidToId.set(uuid, id);
      this.idToUuid.set(id, uuid);
    }
    return id;
  }

  onAgentJoined(agentId: string, name: string): void {
    const id = this.getOrCreateId(agentId);
    this.state.addAgent(id);
    // Set the display name on the character for the name pill
    const ch = this.state.characters.get(id);
    if (ch) ch.name = name;
  }

  onAgentLeft(agentId: string): void {
    const id = this.uuidToId.get(agentId);
    if (id === undefined) return;
    this.state.removeAgent(id);
    const timer = this.activityTimers.get(agentId);
    if (timer) clearTimeout(timer);
    this.activityTimers.delete(agentId);
  }

  onMessage(authorId: string): void {
    const id = this.uuidToId.get(authorId);
    if (id === undefined) return;
    this.state.setAgentActive(id, true);
    this.state.showWaitingBubble(id);
    const existing = this.activityTimers.get(authorId);
    if (existing) clearTimeout(existing);
    this.activityTimers.set(
      authorId,
      setTimeout(() => {
        const numId = this.uuidToId.get(authorId);
        if (numId !== undefined) {
          this.state.setAgentActive(numId, false);
        }
        this.activityTimers.delete(authorId);
      }, INACTIVITY_TIMEOUT_MS),
    );
  }

  destroy(): void {
    this.activityTimers.forEach((timer) => {
      clearTimeout(timer);
    });
    this.activityTimers.clear();
  }
}
