"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container } from "pixi.js";
import { createOffice, TILE, OFFICE_W, OFFICE_H, SCALE } from "@/canvas/office";
import { addAgentSprite, showSpeechBubble, removeAgentSprite, loadCharacterTextures, setOnAgentClick, resetAgentState, updateAgents, triggerAgentMove, notifyAgentActivity } from "@/canvas/agents";
import { setupCamera, getCameraHandle } from "@/canvas/camera";
import { useWebSocket, useCompanyEvents } from "@/hooks/useWebSocket";
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

export default function GameView({
  companyId,
  onAgentClick,
  renderSidebar,
}: {
  companyId: string;
  onAgentClick?: (agentId: string) => void;
  renderSidebar?: (data: { feedItems: FeedItem[]; agents: AgentInfo[]; connected: boolean }) => React.ReactNode;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const officeRef = useRef<Container | null>(null);
  const pendingAgentsRef = useRef<{ id: string; name: string; role: string }[]>([]);
  const pendingBubblesRef = useRef<{ agentId: string; content: string }[]>([]);
  const cameraCleanupRef = useRef<(() => void) | null>(null);
  const onAgentClickRef = useRef(onAgentClick);

  useEffect(() => {
    onAgentClickRef.current = onAgentClick;
  }, [onAgentClick]);

  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [pixiApp, setPixiApp] = useState<Application | null>(null);
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
      setAgents([]);
    }
    prevConnectedRef.current = connected;
  }, [connected]);

  // Subscribe to company WebSocket events
  useCompanyEvents(companyId, {
    onMessage: (data) => {
      setFeedItems((prev) => [
        ...prev.slice(-99),
        {
          kind: "message" as const,
          id: data.message_id as string,
          author: data.author as string,
          authorId: data.author_id as string,
          content: data.content as string,
          channel: data.channel as string,
          timestamp: data.timestamp as number,
        },
      ]);
      notifyAgentActivity(data.author_id as string);
      if (officeRef.current) {
        showSpeechBubble(officeRef.current, data.author_id as string, data.content as string);
      } else {
        pendingBubblesRef.current.push({ agentId: data.author_id as string, content: data.content as string });
      }
    },
    onAgentJoined: (data) => {
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
      // Keep ALL existing agent sprite logic exactly as-is below:
      const info: AgentInfo = {
        id: data.agent_id as string,
        name: data.name as string,
        role: data.role as string,
        status: (data.status as string) ?? "active",
        avatar_seed: data.avatar_seed as string | undefined,
      };
      setAgents((prev) => [...prev.filter((a) => a.id !== info.id), info]);
      if (officeRef.current) {
        addAgentSprite(officeRef.current, data.agent_id as string, data.name as string, data.role as string);
      } else {
        pendingAgentsRef.current.push({ id: data.agent_id as string, name: data.name as string, role: data.role as string });
      }
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
      if (officeRef.current) {
        removeAgentSprite(officeRef.current, agentId);
      }
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
      // Find agent by name and walk to whiteboard
      const authorName = data.author_name as string;
      const match = agentsRef.current.find((a) => a.name === authorName);
      if (match) triggerAgentMove(match.id, "whiteboard");
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

  // Init PixiJS
  useEffect(() => {
    if (!canvasRef.current) return;

    const app = new Application();
    let destroyed = false;

    const width = canvasRef.current.clientWidth;
    const height = canvasRef.current.clientHeight;

    app
      .init({
        width,
        height,
        backgroundColor: 0x121220,
        antialias: false,
        roundPixels: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        autoDensity: true,
      })
      .then(async () => {
        if (destroyed) return;

        canvasRef.current!.appendChild(app.canvas);
        app.canvas.style.imageRendering = "pixelated";
        appRef.current = app;
        setPixiApp(app);

        // Scene graph: stage → worldContainer (camera target) + hudContainer (screen-space)
        const worldContainer = new Container();
        const hudContainer = new Container();
        app.stage.addChild(worldContainer);
        app.stage.addChild(hudContainer);

        await loadCharacterTextures();
        setOnAgentClick((id) => onAgentClickRef.current?.(id));
        const office = await createOffice(app, companyId);
        if (destroyed) return;
        officeRef.current = office;

        // Flush pending agents
        for (const pending of pendingAgentsRef.current) {
          addAgentSprite(office, pending.id, pending.name, pending.role);
        }
        pendingAgentsRef.current = [];

        // Flush pending speech bubbles (show last 3 max)
        const recentBubbles = pendingBubblesRef.current.slice(-3);
        for (const bubble of recentBubbles) {
          showSpeechBubble(office, bubble.agentId, bubble.content);
        }
        pendingBubblesRef.current = [];

        // Office scaled by SCALE only — camera handles fit/zoom
        office.scale.set(SCALE);
        worldContainer.addChild(office);

        // Camera: zoom, pan, resize via pixi-viewport
        const cleanupCamera = setupCamera(app, worldContainer, () => ({
          width: OFFICE_W * TILE * SCALE,
          height: OFFICE_H * TILE * SCALE,
        }));
        cameraCleanupRef.current = cleanupCamera;

        // Agent movement tick
        const tickerFn = (ticker: { deltaMS: number }) => updateAgents(ticker.deltaMS);
        app.ticker.add(tickerFn);
      });

    return () => {
      destroyed = true;
      cameraCleanupRef.current?.();
      cameraCleanupRef.current = null;
      setOnAgentClick(null);
      resetAgentState();
      officeRef.current = null;
      try {
        app.destroy(true, { children: true });
      } catch {
        app.stage?.removeChildren();
      }
      appRef.current = null;
    };
  }, [companyId]);

  // Sync viewport + agent positions every 500ms for minimap/controls

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", overflow: "hidden" }}>
      {renderSidebar?.({ feedItems, agents, connected })}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <div ref={canvasRef} style={{ width: "100%", height: "100%", background: "#121220" }} />
        <GifCapture
          app={pixiApp}
          companyName={companyId}
          onStateChange={(s) => setGifState(s === "preview" ? "idle" : s as "idle" | "recording" | "encoding")}
          triggerRef={gifTriggerRef}
        />
        <CanvasControls
          onZoomIn={() => getCameraHandle()?.zoomIn()}
          onZoomOut={() => getCameraHandle()?.zoomOut()}
          onGifCapture={() => gifTriggerRef.current?.()}
          gifState={gifState}
        />
      </div>
    </div>
  );
}
