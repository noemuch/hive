"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container, Text, TextStyle } from "pixi.js";
import { createOffice, TILE, OFFICE_W, OFFICE_H, SCALE } from "@/canvas/office";
import { addAgentSprite, showSpeechBubble, removeAgentSprite, loadCharacterTextures } from "@/canvas/agents";
import { setupCamera } from "@/canvas/camera";
import ChatPanel from "./ChatPanel";

type ChatMessage = {
  id: string;
  author: string;
  authorId: string;
  content: string;
  channel: string;
  timestamp: number;
};

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3000/watch";

type AgentInfo = { id: string; name: string; role: string; status: string };

export default function GameView() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const officeRef = useRef<Container | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pendingAgentsRef = useRef<{ id: string; name: string; role: string }[]>([]);
  const cameraCleanupRef = useRef<(() => void) | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState<string>("");
  const [companies, setCompanies] = useState<{ id: string; name: string; agent_count: number }[]>([]);

  // Fetch companies on mount
  useEffect(() => {
    fetch(
      (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000") +
        "/api/companies"
    )
      .then((r) => r.json())
      .then((list: { id: string; name: string; agent_count: number }[]) => {
        setCompanies(list);
        if (list.length > 0) {
          const best = list.sort((a, b) => (b.agent_count || 0) - (a.agent_count || 0))[0];
          setCompanyId(best.id);
          setCompanyName(best.name);
        }
      })
      .catch(() => { /* Server unreachable — will retry on reconnect */ });
  }, []);

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
        backgroundColor: 0x1a1a2e,
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

        // Scene graph: stage → worldContainer (camera target) + hudContainer (screen-space)
        const worldContainer = new Container();
        const hudContainer = new Container();
        app.stage.addChild(worldContainer);
        app.stage.addChild(hudContainer);

        // Load character textures, then create office
        await loadCharacterTextures();
        const office = await createOffice(app);
        if (destroyed) return;
        officeRef.current = office;

        // Flush any agents that arrived before the office was ready
        for (const pending of pendingAgentsRef.current) {
          addAgentSprite(office, pending.id, pending.name, pending.role);
        }
        pendingAgentsRef.current = [];

        // Office scaled by SCALE only — camera handles fit/zoom
        office.scale.set(SCALE);
        worldContainer.addChild(office);

        // Camera: zoom, pan, resize — lazy bounds accessor reads live OFFICE_W/H
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
        // PixiJS v8 resizeTo cleanup bug — safe to ignore
        app.stage?.removeChildren();
      }
      appRef.current = null;
    };
  }, []);

  const handleSelectCompany = (id: string) => {
    const company = companies.find((c) => c.id === id);
    if (!company || id === companyId) return;
    // Clear state for new company
    setMessages([]);
    setAgents([]);
    // Remove all agent sprites from canvas
    if (officeRef.current) {
      const toRemove = officeRef.current.children.filter((c) => c.name?.startsWith("agent-"));
      toRemove.forEach((c) => officeRef.current!.removeChild(c));
    }
    setCompanyId(id);
    setCompanyName(company.name);
  };

  // Update company label
  useEffect(() => {
    if (!officeRef.current || !companyName) return;
    const label = officeRef.current.getChildByName("companyLabel") as Text;
    if (label) {
      label.text = companyName.toUpperCase();
    }
  }, [companyName]);

  // WebSocket connection
  useEffect(() => {
    if (!companyId) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "watch_company", company_id: companyId }));
      setConnected(true);
    };

    ws.onmessage = (event) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try {
        data = JSON.parse(event.data as string);
      } catch {
        return;
      }

      switch (data.type) {
        case "message_posted":
          setMessages((prev) => [
            ...prev.slice(-99),
            {
              id: data.message_id,
              author: data.author,
              authorId: data.author_id,
              content: data.content,
              channel: data.channel,
              timestamp: data.timestamp,
            },
          ]);

          // Show speech bubble on canvas
          if (officeRef.current) {
            showSpeechBubble(officeRef.current, data.author_id, data.content);
          }
          break;

        case "agent_joined": {
          const info: AgentInfo = {
            id: data.agent_id,
            name: data.name,
            role: data.role,
            status: "active",
          };
          setAgents((prev) => [...prev.filter((a) => a.id !== info.id), info]);

          if (officeRef.current) {
            addAgentSprite(officeRef.current, data.agent_id, data.name, data.role);
          } else {
            // Office not ready yet — queue for replay once it loads
            pendingAgentsRef.current.push({ id: data.agent_id, name: data.name, role: data.role });
          }
          break;
        }

        case "agent_left":
          setAgents((prev) => prev.filter((a) => a.id !== data.agent_id));
          if (officeRef.current) {
            removeAgentSprite(officeRef.current, data.agent_id);
          }
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3 seconds
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          // Trigger re-render to reconnect (companyId dependency will re-run effect)
          setConnected(false);
        }
      }, 3000);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [companyId]);

  return (
    <div className="relative w-full h-full">
      {/* PixiJS canvas container */}
      <div ref={canvasRef} className="w-full h-full" />

      {/* Chat panel overlay */}
      <ChatPanel
        messages={messages}
        agents={agents}
        companyName={companyName}
        companyId={companyId}
        companies={companies}
        connected={connected}
        onSelectCompany={handleSelectCompany}
      />
    </div>
  );
}
