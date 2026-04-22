"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { OfficeState } from "@/canvas/officeState";
import { renderFrame } from "@/canvas/renderer";
import { startGameLoop } from "@/canvas/gameLoop";
import { loadAllAssets, loadDefaultLayout } from "@/canvas/assetLoader";
import { HiveBridge } from "@/canvas/hiveBridge";
import { TILE_SIZE } from "@/canvas/types";
import { useWebSocket, useBureauEvents } from "@/hooks/useWebSocket";
import GifCapture from "./GifCapture";
import { CanvasControls } from "./CanvasControls";

type FeedItem =
  | { kind: "message"; id: string; author: string; authorId: string; content: string; channel: string; timestamp: number }
  | { kind: "artifact_created"; id: string; authorName: string; artifactType: string; title: string; timestamp: number }
  | { kind: "artifact_updated"; id: string; authorName: string; title: string; oldStatus: string; newStatus: string; timestamp: number }
  | { kind: "artifact_reviewed"; id: string; reviewerName: string; title: string; verdict: string; timestamp: number }
  | { kind: "agent_joined"; id: string; name: string; role: string; avatar_seed?: string; timestamp: number }
  | { kind: "agent_left"; id: string; name: string; timestamp: number };

export type { FeedItem };

type AgentInfo = { id: string; name: string; role: string; status: string; avatar_seed?: string };

export type { AgentInfo };

const DEFAULT_ZOOM = 3;
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const BG_COLOR = "#121220";

export default function GameView({
  bureauId,
  onAgentClick,
  renderSidebar,
}: {
  bureauId: string;
  onAgentClick?: (agentId: string) => void;
  renderSidebar?: (data: { feedItems: FeedItem[]; agents: AgentInfo[]; connected: boolean }) => React.ReactNode;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<OfficeState | null>(null);
  const bridgeRef = useRef<HiveBridge | null>(null);
  const onAgentClickRef = useRef(onAgentClick);
  const zoomRef = useRef(DEFAULT_ZOOM);
  const panRef = useRef({ x: 0, y: 0 });
  const readyRef = useRef(false);

  useEffect(() => {
    onAgentClickRef.current = onAgentClick;
  }, [onAgentClick]);

  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [, setZoom] = useState(DEFAULT_ZOOM);
  const [gifState, setGifState] = useState<"idle" | "recording" | "encoding">("idle");
  const gifTriggerRef = useRef<(() => void) | null>(null);
  const { connected } = useWebSocket();

  // Ref to latest agents for event handlers — avoids nested setState anti-pattern
  const agentsRef = useRef<AgentInfo[]>([]);
  useEffect(() => { agentsRef.current = agents; }, [agents]);

  // Reset agents on reconnect so stale "active" entries don't linger
  const prevConnectedRef = useRef(connected);
  useEffect(() => {
    if (!prevConnectedRef.current && connected) {
      setAgents([]); // eslint-disable-line react-hooks/set-state-in-effect -- intentional: sync with WebSocket reconnection
    }
    prevConnectedRef.current = connected;
  }, [connected]);

  // Subscribe to bureau WebSocket events
  useBureauEvents(bureauId, {
    onPresenceSnapshot: (data) => {
      // Hydrate roster + message history silently: no "X joined" feed
      // entries for agents that were already present when we connected.
      // See issue #169.
      const roster = (data.agents as Array<{
        agent_id: string;
        name: string;
        role: string;
        status: string;
        avatar_seed?: string;
      }>) ?? [];
      const historyMessages = (data.messages as Array<{
        message_id: string;
        author: string;
        author_id: string;
        content: string;
        channel: string;
        timestamp: number;
      }>) ?? [];

      setAgents(
        roster.map((a) => ({
          id: a.agent_id,
          name: a.name,
          role: a.role,
          status: a.status,
          avatar_seed: a.avatar_seed,
        })),
      );

      setFeedItems((prev) => {
        const existingIds = new Set(
          prev.filter((f) => f.kind === "message").map((f) => f.id),
        );
        const historical = historyMessages
          .filter((m) => !existingIds.has(m.message_id))
          .map((m) => ({
            kind: "message" as const,
            id: m.message_id,
            author: m.author,
            authorId: m.author_id,
            content: m.content,
            channel: m.channel,
            timestamp: m.timestamp,
          }));
        return [...historical, ...prev].slice(-100);
      });

      // Hydrate canvas state with each agent
      for (const a of roster) {
        bridgeRef.current?.onAgentJoined(a.agent_id, a.name);
      }
    },
    onMessage: (data) => {
      const msgId = data.message_id as string;
      setFeedItems((prev) => {
        if (prev.some((f) => f.kind === "message" && f.id === msgId)) return prev;
        return [
          ...prev.slice(-99),
          {
            kind: "message" as const,
            id: msgId,
            author: data.author as string,
            authorId: data.author_id as string,
            content: data.content as string,
            channel: data.channel as string,
            timestamp: data.timestamp as number,
          },
        ];
      });
      bridgeRef.current?.onMessage(data.author_id as string);
    },
    onAgentJoined: (data) => {
      const agentId = data.agent_id as string;
      const info: AgentInfo = {
        id: agentId,
        name: data.name as string,
        role: data.role as string,
        status: (data.status as string) ?? "active",
        avatar_seed: data.avatar_seed as string | undefined,
      };
      // Only add to feed if agent is not already in the list (prevents duplicate "joined" on reconnect)
      if (!agentsRef.current.some((a) => a.id === agentId)) {
        setFeedItems((prev) => [
          ...prev.slice(-99),
          {
            kind: "agent_joined" as const,
            id: crypto.randomUUID(),
            name: data.name as string,
            role: data.role as string,
            avatar_seed: data.avatar_seed as string | undefined,
            timestamp: Date.now(),
          },
        ]);
      }
      setAgents((prev) => [...prev.filter((a) => a.id !== info.id), info]);
      bridgeRef.current?.onAgentJoined(data.agent_id as string, data.name as string);
    },
    onAgentLeft: (data) => {
      const agentId = data.agent_id as string;
      const leavingName = agentsRef.current.find((a) => a.id === agentId)?.name ?? agentId;
      setAgents((prev) => prev.filter((a) => a.id !== agentId));
      setFeedItems((fi) => [
        ...fi.slice(-99),
        {
          kind: "agent_left" as const,
          id: crypto.randomUUID(),
          name: leavingName,
          timestamp: Date.now(),
        },
      ]);
      bridgeRef.current?.onAgentLeft(agentId);
    },
    onArtifactCreated: (data) => {
      setFeedItems((prev) => [
        ...prev.slice(-99),
        {
          kind: "artifact_created" as const,
          id: data.artifact_id as string,
          authorName: data.author_name as string,
          artifactType: data.artifact_type as string,
          title: data.title as string,
          timestamp: Date.now(),
        },
      ]);
    },
    onArtifactUpdated: (data) => {
      setFeedItems((prev) => [
        ...prev.slice(-99),
        {
          kind: "artifact_updated" as const,
          id: data.artifact_id as string,
          authorName: data.author_name as string,
          title: data.title as string,
          oldStatus: data.old_status as string,
          newStatus: data.new_status as string,
          timestamp: Date.now(),
        },
      ]);
    },
    onArtifactReviewed: (data) => {
      setFeedItems((prev) => [
        ...prev.slice(-99),
        {
          kind: "artifact_reviewed" as const,
          id: data.artifact_id as string,
          reviewerName: data.reviewer_name as string,
          title: data.title as string,
          verdict: data.verdict as string,
          timestamp: Date.now(),
        },
      ]);
    },
  });

  // Init Canvas 2D
  useEffect(() => {
    const cvs = canvasRef.current;
    const ctr = containerRef.current;
    if (!cvs || !ctr) return;

    let destroyed = false;
    let stopLoop: (() => void) | null = null;

    (async () => {
      // Load all pixel-agents assets
      await loadAllAssets();
      if (destroyed) return;

      // Load office layout
      const layout = await loadDefaultLayout();
      if (destroyed) return;

      const state = new OfficeState(layout ?? undefined);
      stateRef.current = state;

      const bridge = new HiveBridge(state);
      bridge.setOnAgentClick((id) => onAgentClickRef.current?.(id));
      bridgeRef.current = bridge;

      // Replay agents that joined before assets loaded
      for (const agent of agentsRef.current) {
        bridge.onAgentJoined(agent.id, agent.name);
      }

      // Size canvas to container
      const dpr = Math.min(window.devicePixelRatio, 2);
      cvs.width = ctr.clientWidth * dpr;
      cvs.height = ctr.clientHeight * dpr;
      cvs.style.width = `${ctr.clientWidth}px`;
      cvs.style.height = `${ctr.clientHeight}px`;

      readyRef.current = true;

      // Start game loop
      stopLoop = startGameLoop(cvs, {
        update: (dt) => {
          state.update(dt);
        },
        render: (ctx) => {
          ctx.imageSmoothingEnabled = false;
          // Fill background
          ctx.fillStyle = BG_COLOR;
          ctx.fillRect(0, 0, cvs.width, cvs.height);

          renderFrame(
            ctx,
            cvs.width,
            cvs.height,
            state.tileMap,
            state.furniture,
            state.getCharacters(),
            zoomRef.current * dpr,
            panRef.current.x * dpr,
            panRef.current.y * dpr,
            undefined, // selection
            undefined, // editor
            state.layout.tileColors,
            state.layout.cols,
            state.layout.rows,
          );
        },
      });
    })();

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      const c = canvasRef.current;
      const ct = containerRef.current;
      if (!c || !ct) return;
      const dpr = Math.min(window.devicePixelRatio, 2);
      c.width = ct.clientWidth * dpr;
      c.height = ct.clientHeight * dpr;
      c.style.width = `${ct.clientWidth}px`;
      c.style.height = `${ct.clientHeight}px`;
    });
    resizeObserver.observe(ctr);

    return () => {
      destroyed = true;
      readyRef.current = false;
      resizeObserver.disconnect();
      stopLoop?.();
      bridgeRef.current?.destroy();
      bridgeRef.current = null;
      stateRef.current = null;
    };
  }, [bureauId]);

  // Mouse drag for panning
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      panRef.current.x += dx;
      panRef.current.y += dy;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      canvas.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  // Click to select agent
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let pointerDownPos: { x: number; y: number } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!pointerDownPos) return;
      // Only treat as click if the pointer didn't move much (< 5px)
      const dx = Math.abs(e.clientX - pointerDownPos.x);
      const dy = Math.abs(e.clientY - pointerDownPos.y);
      pointerDownPos = null;
      if (dx > 5 || dy > 5) return;

      const state = stateRef.current;
      const bridge = bridgeRef.current;
      if (!state || !bridge || !readyRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      const zoom = zoomRef.current * dpr;

      // Screen position relative to canvas (in device pixels)
      const screenX = (e.clientX - rect.left) * dpr;
      const screenY = (e.clientY - rect.top) * dpr;

      // Compute map offset (same logic as renderFrame)
      const cols = state.tileMap.length > 0 ? state.tileMap[0].length : 0;
      const rows = state.tileMap.length;
      const mapW = cols * TILE_SIZE * zoom;
      const mapH = rows * TILE_SIZE * zoom;
      const offsetX = Math.floor((canvas.width - mapW) / 2) + Math.round(panRef.current.x * dpr);
      const offsetY = Math.floor((canvas.height - mapH) / 2) + Math.round(panRef.current.y * dpr);

      // Convert screen coords to world coords
      const worldX = (screenX - offsetX) / zoom;
      const worldY = (screenY - offsetY) / zoom;

      const hitId = state.getCharacterAt(worldX, worldY);
      if (hitId !== null) {
        bridge.handleCharacterClick(hitId);
      }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);

    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    };
  }, []);

  // Zoom controls
  const handleZoomIn = useCallback(() => {
    zoomRef.current = Math.min(zoomRef.current + 1, MAX_ZOOM);
    setZoom(zoomRef.current);
  }, []);

  const handleZoomOut = useCallback(() => {
    zoomRef.current = Math.max(zoomRef.current - 1, MIN_ZOOM);
    setZoom(zoomRef.current);
  }, []);

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden" }}>
      {renderSidebar?.({ feedItems, agents, connected })}
      <div ref={containerRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            background: BG_COLOR,
            imageRendering: "pixelated",
            display: "block",
          }}
        />
        <GifCapture
          app={null}
          bureauName={bureauId}
          onStateChange={(s) => setGifState(s === "preview" ? "idle" : s as "idle" | "recording" | "encoding")}
          triggerRef={gifTriggerRef}
        />
        <CanvasControls
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onGifCapture={() => gifTriggerRef.current?.()}
          gifState={gifState}
        />
      </div>
    </div>
  );
}
