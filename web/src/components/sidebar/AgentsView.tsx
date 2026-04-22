"use client";

import { useState } from "react";
import { Search, ChevronDown, ChevronRight } from "lucide-react";

import { type AgentInfo } from "@/components/GameView";
import { PixelAvatar } from "@/components/PixelAvatar";
import { capitalize } from "@/lib/utils";

import { seedBg } from "@/components/sidebar/utils";

function statusLabel(s: string): string {
  if (s === "active" || s === "connected" || s === "assigned") return "Online";
  if (s === "idle" || s === "sleeping") return "Sleeping";
  return "Disconnected";
}

export default function AgentsView({
  agents,
  bureauName,
  onlineCount,
  onAgentClick,
}: {
  agents: AgentInfo[];
  bureauName: string;
  onlineCount: number;
  onAgentClick: (agentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(true);

  const filtered = query
    ? agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : agents;

  const online = filtered
    .filter((a) => a.status !== "retired")
    .sort((a, b) => {
      const aOnline = statusLabel(a.status) === "Online" ? 0 : 1;
      const bOnline = statusLabel(b.status) === "Online" ? 0 : 1;
      return aOnline - bOnline;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Panel header */}
      <div style={{
        padding: "11px 14px",
        borderBottom: "1px solid var(--border)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
          {bureauName}
        </span>
        {onlineCount > 0 && (
          <span style={{
            fontSize: 10,
            color: "var(--accent-green)",
            background: "rgba(116,196,130,0.08)",
            padding: "2px 7px",
            borderRadius: 20,
            border: "1px solid rgba(116,196,130,0.15)",
          }}>
            ● {onlineCount} online
          </span>
        )}
      </div>

      {/* Search */}
      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0, position: "relative" }}>
        <Search size={12} style={{
          position: "absolute",
          left: 18,
          top: "50%",
          transform: "translateY(-50%)",
          color: "var(--muted-foreground)",
        }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents..."
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "5px 8px 5px 26px",
            fontSize: 11,
            color: "var(--foreground)",
            outline: "none",
          }}
        />
      </div>

      {/* Agents list */}
      <div className="scrollbar-subtle" style={{ flex: 1, overflowY: "auto", padding: "6px 10px 10px" }}>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 2px",
            background: "none",
            border: "none",
            cursor: "pointer",
            width: "100%",
            marginBottom: 4,
          }}
        >
          {expanded
            ? <ChevronDown size={10} style={{ color: "var(--muted-foreground)" }} />
            : <ChevronRight size={10} style={{ color: "var(--muted-foreground)" }} />}
          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Agents
          </span>
          <span style={{ fontSize: 10, color: "var(--muted-foreground)", opacity: 0.6 }}>({online.length})</span>
        </button>

        {expanded && online.map((agent) => (
          <AgentRow key={agent.id} agent={agent} onClick={() => onAgentClick(agent.id)} />
        ))}

      </div>
    </div>
  );
}

function AgentRow({ agent, onClick }: { agent: AgentInfo; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "5px 6px",
        borderRadius: 6,
        background: hovered ? "color-mix(in srgb, var(--muted) 60%, transparent)" : "none",
        border: "none",
        cursor: "pointer",
        width: "100%",
        textAlign: "left",
        transition: "background 150ms",
      }}
    >
      <div style={{ position: "relative", flexShrink: 0 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", overflow: "hidden", background: seedBg(agent.avatar_seed ?? agent.name) }}>
          <PixelAvatar seed={agent.avatar_seed ?? agent.name} size={34} className="rounded-full" />
        </div>
        <span style={{
          position: "absolute",
          bottom: -1,
          right: -1,
          width: 9,
          height: 9,
          background: statusLabel(agent.status) === "Online" ? "var(--accent-green)" : "var(--muted-foreground)",
          borderRadius: "50%",
          border: "2px solid var(--card)",
          display: "block",
        }} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>{agent.name}</span>
          <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{capitalize(agent.role)}</span>
        </div>
        <div style={{ fontSize: 10, marginTop: 1, color: "var(--muted-foreground)" }}>
          {statusLabel(agent.status)}
        </div>
      </div>
    </button>
  );
}
