"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Hexagon, Search, MessageSquare, Users, Link2, Check } from "lucide-react";
import { type FeedItem, type AgentInfo } from "@/components/GameView";
import ChatView from "@/components/sidebar/ChatView";
import AgentsView from "@/components/sidebar/AgentsView";
import CmdkModal from "@/components/sidebar/CmdkModal";

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    // Read initial value via a microtask to satisfy lint rule
    const id = setTimeout(() => setIsMobile(mq.matches), 0);
    return () => {
      mq.removeEventListener("change", handler);
      clearTimeout(id);
    };
  }, []);
  return isMobile;
}

export default function CompanySidebar({
  companyName,
  onlineCount,
  feedItems,
  agents,
  onAgentClick,
}: {
  companyName: string;
  onlineCount: number;
  feedItems: FeedItem[];
  agents: AgentInfo[];
  onAgentClick: (agentId: string) => void;
}) {
  const [activePanel, setActivePanel] = useState<"chat" | "agents" | null>("chat");
  const [unreadCount, setUnreadCount] = useState(0);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const isMobile = useIsMobile();
  const prevMsgCountRef = useRef(0);

  // ⌘K keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCmdkOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Unread count
  useEffect(() => {
    const msgCount = feedItems.filter((f) => f.kind === "message").length;
    // Reset baseline on reconnect/replay (count dropped to 0 or below prev)
    if (msgCount < prevMsgCountRef.current) {
      prevMsgCountRef.current = msgCount;
      return;
    }
    if (activePanel !== "chat" && msgCount > prevMsgCountRef.current) {
      setUnreadCount((c) => c + (msgCount - prevMsgCountRef.current));
    }
    if (activePanel === "chat") {
      setUnreadCount(0);
    }
    prevMsgCountRef.current = msgCount;
  }, [feedItems, activePanel]);

  const toggle = useCallback((panel: "chat" | "agents") => {
    setActivePanel((p) => (p === panel ? null : panel));
    if (panel === "chat") setUnreadCount(0);
  }, []);

  const handleOpenChat = useCallback(() => setActivePanel("chat"), []);
  const handleOpenAgents = useCallback(() => setActivePanel("agents"), []);
  const handleCloseCmdk = useCallback(() => setCmdkOpen(false), []);

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, []);

  const panelOpen = activePanel !== null;

  // Panel content
  const panel = activePanel === "chat" ? (
    <ChatView
      feedItems={feedItems}
      agents={agents}
      companyName={companyName}
      onlineCount={onlineCount}
    />
  ) : activePanel === "agents" ? (
    <AgentsView
      agents={agents}
      companyName={companyName}
      onlineCount={onlineCount}
      onAgentClick={onAgentClick}
    />
  ) : null;

  // Mobile panel transform
  const mobilePanelStyle: React.CSSProperties = isMobile ? {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    height: "85vh",
    borderRadius: "12px 12px 0 0",
    border: "1px solid var(--border)",
    borderBottom: "none",
    zIndex: 50,
    transform: panelOpen ? "translateY(0)" : "translateY(100%)",
    transition: "transform 300ms ease",
  } : {};

  return (
    <>
      <div style={{ display: "flex", flexShrink: 0, height: "100%" }}>
        {/* Icon Rail */}
        <div style={{
          width: 48,
          background: "var(--card)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          padding: "10px 0",
          gap: 4,
          flexShrink: 0,
        }}>
          {/* Logo → home */}
          <Link
            href="/"
            aria-label="Go to home"
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--foreground)",
              marginBottom: 10,
              borderRadius: 7,
              textDecoration: "none",
            }}
          >
            <Hexagon size={20} strokeWidth={1.5} />
          </Link>

          {/* Search / ⌘K */}
          <RailButton
            label="Search"
            active={false}
            onClick={() => setCmdkOpen(true)}
            kbdHint="⌘K"
            isMobile={isMobile}
          >
            <Search size={14} />
          </RailButton>

          {/* Chat */}
          <RailButton
            label="Chat"
            active={activePanel === "chat"}
            onClick={() => toggle("chat")}
            isMobile={isMobile}
          >
            <MessageSquare size={14} />
            {unreadCount > 0 && (
              <span style={{
                position: "absolute",
                top: 2,
                right: 2,
                minWidth: 14,
                height: 14,
                padding: "0 3px",
                background: "#ef4444",
                borderRadius: 9999,
                border: "1.5px solid var(--card)",
                fontSize: 9,
                fontWeight: 700,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </RailButton>

          {/* Agents */}
          <RailButton
            label="Agents"
            active={activePanel === "agents"}
            onClick={() => toggle("agents")}
            isMobile={isMobile}
          >
            <Users size={14} />
          </RailButton>

          <div style={{ flex: 1 }} />

          {/* Copy link */}
          <RailButton label="Copy link" active={copied} onClick={handleCopyLink} isMobile={isMobile}>
            {copied ? <Check size={14} /> : <Link2 size={14} />}
          </RailButton>
        </div>

        {/* Content Panel — desktop (animated) */}
        {!isMobile && (
          <div style={{
            width: panelOpen ? 272 : 0,
            overflow: "hidden",
            transition: "width 250ms cubic-bezier(0.4, 0, 0.2, 1)",
            flexShrink: 0,
            background: "var(--card)",
          }}>
            <div style={{
              width: 272,
              height: "100%",
              background: "var(--card)",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}>
              {panel}
            </div>
          </div>
        )}
      </div>

      {/* Content Panel — mobile bottom sheet */}
      {isMobile && (
        <div style={{
          background: "var(--card)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          ...mobilePanelStyle,
        }}>
          {/* Drag handle */}
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
            <div style={{ width: 32, height: 4, background: "var(--muted-foreground)", opacity: 0.3, borderRadius: 2 }} />
          </div>
          {panel}
        </div>
      )}

      {/* ⌘K Modal */}
      {cmdkOpen && (
        <CmdkModal
          agents={agents}
          onAgentClick={onAgentClick}
          onOpenChat={handleOpenChat}
          onOpenAgents={handleOpenAgents}
          onClose={handleCloseCmdk}
        />
      )}
    </>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
  kbdHint,
  isMobile,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  kbdHint?: string;
  isMobile?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: 34,
        height: 34,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: active
          ? "var(--muted)"
          : hovered
            ? "color-mix(in srgb, var(--muted) 60%, transparent)"
            : "none",
        border: "none",
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
        cursor: "pointer",
        transition: "background 150ms, color 150ms",
      }}
    >
      {children}
      {hovered && !isMobile && (
        <div style={{
          position: "absolute",
          left: "calc(100% + 10px)",
          top: "50%",
          transform: "translateY(-50%)",
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "4px 8px",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--foreground)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          gap: 5,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}>
          {label}
          {kbdHint && (
            <kbd style={{
              fontSize: 10,
              fontFamily: "inherit",
              background: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "1px 4px",
              color: "var(--muted-foreground)",
              lineHeight: 1.4,
            }}>
              {kbdHint}
            </kbd>
          )}
        </div>
      )}
    </button>
  );
}
