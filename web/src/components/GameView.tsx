"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container, Text, TextStyle } from "pixi.js";
import { createOffice, TILE, OFFICE_W, OFFICE_H, SCALE } from "@/canvas/office";
import { addAgentSprite, showSpeechBubble, removeAgentSprite, loadCharacterTextures } from "@/canvas/agents";
import { setupCamera } from "@/canvas/camera";
import { createNPCs } from "@/canvas/npcs";
import { useWebSocket, useCompanyEvents } from "@/hooks/useWebSocket";
import ChatPanel from "./ChatPanel";
import GifCapture from "./GifCapture";

type ChatMessage = {
  id: string;
  author: string;
  authorId: string;
  content: string;
  channel: string;
  timestamp: number;
};

type AgentInfo = { id: string; name: string; role: string; status: string };

export default function GameView({ companyId }: { companyId: string }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const officeRef = useRef<Container | null>(null);
  const pendingAgentsRef = useRef<{ id: string; name: string; role: string }[]>([]);
  const pendingBubblesRef = useRef<{ agentId: string; content: string }[]>([]);
  const cameraCleanupRef = useRef<(() => void) | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [pixiApp, setPixiApp] = useState<Application | null>(null);
  const { connected } = useWebSocket();

  // Subscribe to company WebSocket events
  useCompanyEvents(companyId, {
    onMessage: (data) => {
      setMessages((prev) => [
        ...prev.slice(-99),
        {
          id: data.message_id as string,
          author: data.author as string,
          authorId: data.author_id as string,
          content: data.content as string,
          channel: data.channel as string,
          timestamp: data.timestamp as number,
        },
      ]);
      if (officeRef.current) {
        showSpeechBubble(officeRef.current, data.author_id as string, data.content as string);
      } else {
        pendingBubblesRef.current.push({ agentId: data.author_id as string, content: data.content as string });
      }
    },
    onAgentJoined: (data) => {
      const info: AgentInfo = {
        id: data.agent_id as string,
        name: data.name as string,
        role: data.role as string,
        status: "active",
      };
      setAgents((prev) => [...prev.filter((a) => a.id !== info.id), info]);
      if (officeRef.current) {
        addAgentSprite(officeRef.current, data.agent_id as string, data.name as string, data.role as string);
      } else {
        pendingAgentsRef.current.push({ id: data.agent_id as string, name: data.name as string, role: data.role as string });
      }
    },
    onAgentLeft: (data) => {
      setAgents((prev) => prev.filter((a) => a.id !== (data.agent_id as string)));
      if (officeRef.current) {
        removeAgentSprite(officeRef.current, data.agent_id as string);
      }
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
        backgroundColor: 0x131620,
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
        const office = await createOffice(app, companyId);
        if (destroyed) return;
        officeRef.current = office;

        // Spawn NPCs
        await createNPCs(office);

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

        // HUD: title overlay (screen-space, unaffected by camera)
        const title = new Text({
          text: "HIVE",
          style: new TextStyle({
            fontSize: 14,
            fontFamily: "monospace",
            fill: 0x4a4a6a,
            fontWeight: "bold",
            letterSpacing: 4,
          }),
        });
        title.x = 12;
        title.y = 8;
        hudContainer.addChild(title);

        // HUD: status indicator
        const status = new Text({
          text: "● LIVE",
          style: new TextStyle({
            fontSize: 10,
            fontFamily: "monospace",
            fill: 0x66bb6a,
          }),
        });
        status.x = app.screen.width - 60;
        status.y = 8;
        status.name = "statusText";
        hudContainer.addChild(status);
      });

    return () => {
      destroyed = true;
      cameraCleanupRef.current?.();
      cameraCleanupRef.current = null;
      try {
        app.destroy(true, { children: true });
      } catch {
        app.stage?.removeChildren();
      }
      appRef.current = null;
    };
  }, [companyId]);

  return (
    <div className="relative w-full h-full">
      <div ref={canvasRef} className="w-full h-full" />
      <GifCapture app={pixiApp} companyName={companyId} />
      <ChatPanel
        messages={messages}
        agents={agents}
        companyId={companyId}
        connected={connected}
      />
    </div>
  );
}
