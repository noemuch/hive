"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Search, MessageSquare, Users } from "lucide-react";
import { type AgentInfo } from "@/components/GameView";
import { PixelAvatar } from "@/components/PixelAvatar";

import { seedBg } from "@/components/sidebar/utils";

export default function CmdkModal({
  agents,
  onAgentClick,
  onOpenChat,
  onOpenAgents,
  onClose,
}: {
  agents: AgentInfo[];
  onAgentClick: (agentId: string) => void;
  onOpenChat: () => void;
  onOpenAgents: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredAgents = query
    ? agents.filter((a) => a.name.toLowerCase().includes(query.toLowerCase()))
    : agents;

  const actions = useMemo(() => [
    { id: "chat", label: "Open Chat", description: "Toggle chat panel", Icon: MessageSquare, action: () => { onOpenChat(); onClose(); } },
    { id: "agents", label: "View Agents", description: "Open agents panel", Icon: Users, action: () => { onOpenAgents(); onClose(); } },
  ], [onOpenChat, onOpenAgents, onClose]);

  const totalItems = filteredAgents.length + actions.length;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, totalItems - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex < filteredAgents.length) {
        onAgentClick(filteredAgents[selectedIndex].id);
        onClose();
      } else {
        actions[selectedIndex - filteredAgents.length].action();
      }
    }
  }, [totalItems, selectedIndex, filteredAgents, actions, onAgentClick, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);


  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 80,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          maxWidth: "calc(100vw - 32px)",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
          overflow: "hidden",
        }}
      >
        {/* Search input */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: "1px solid var(--border)",
        }}>
          <Search size={15} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder="Search agents..."
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              fontSize: 13,
              color: "var(--foreground)",
            }}
          />
          <kbd style={{
            fontSize: 10,
            color: "var(--muted-foreground)",
            background: "var(--background)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 5px",
          }}>
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 300, overflowY: "auto", padding: "6px 0" }}>

          {filteredAgents.length > 0 && (
            <>
              <div style={{ padding: "4px 14px", fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Agents
              </div>
              {filteredAgents.map((agent, i) => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => { onAgentClick(agent.id); onClose(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "7px 14px",
                    width: "100%",
                    background: selectedIndex === i ? "color-mix(in srgb, var(--muted) 80%, transparent)" : "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 28, height: 28, borderRadius: "50%", overflow: "hidden", background: seedBg(agent.name) }}>
                      <PixelAvatar seed={agent.name} size={28} className="rounded-full" />
                    </div>
                    <span style={{
                      position: "absolute",
                      bottom: -1,
                      right: -1,
                      width: 7,
                      height: 7,
                      background: agent.status === "active" ? "var(--accent-green)" : "var(--muted-foreground)",
                      borderRadius: "50%",
                      border: "1.5px solid var(--card)",
                      display: "block",
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>{agent.name}</div>
                    <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>
                      {agent.role} · {agent.status === "active" ? "Online" : "Offline"}
                    </div>
                  </div>
                  {selectedIndex === i && (
                    <kbd style={{ fontSize: 10, color: "var(--muted-foreground)", background: "var(--background)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px" }}>↵</kbd>
                  )}
                </button>
              ))}
            </>
          )}

          <div style={{ margin: "4px 0", borderTop: "1px solid var(--border)" }} />
          <div style={{ padding: "4px 14px", fontSize: 10, fontWeight: 600, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Actions
          </div>
          {actions.map((action, i) => {
            const idx = filteredAgents.length + i;
            return (
              <button
                key={action.id}
                type="button"
                onClick={action.action}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "7px 14px",
                  width: "100%",
                  background: selectedIndex === idx ? "rgba(255,255,255,0.06)" : "none",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ width: 28, height: 28, background: "var(--muted)", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <action.Icon size={13} style={{ color: "var(--muted-foreground)" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}>{action.label}</div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{action.description}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: "8px 14px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 14,
          alignItems: "center",
        }}>
          {[["↑↓", "navigate"], ["↵", "open"], ["Esc", "close"]].map(([key, label]) => (
            <span key={key} style={{ fontSize: 10, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 4 }}>
              <kbd style={{ background: "var(--background)", border: "1px solid var(--border)", borderRadius: 3, padding: "1px 4px", fontSize: 9, color: "var(--muted-foreground)" }}>{key}</kbd>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
