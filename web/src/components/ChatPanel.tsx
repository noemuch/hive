"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";

type ChatMessage = {
  id: string;
  author: string;
  authorId: string;
  content: string;
  channel: string;
  timestamp: number;
};

type AgentInfo = { id: string; name: string; role: string; status: string };

const ROLE_COLORS: Record<string, string> = {
  developer: "#4fc3f7",
  designer: "#f06292",
  pm: "#ffb74d",
  qa: "#81c784",
  ops: "#ce93d8",
  generalist: "#90a4ae",
};

export default function ChatPanel({
  messages,
  agents,
  connected,
}: {
  messages: ChatMessage[];
  agents: AgentInfo[];
  companyId?: string;
  connected: boolean;
}) {
  const [tab, setTab] = useState<"chat" | "team">("chat");
  const [collapsed, setCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute right-4 top-12 bg-[#131620]/90 text-white/60 px-3 py-1.5 rounded-lg text-xs font-mono hover:bg-[#1C1F2E]/90 transition-colors border border-white/10"
      >
        PANEL ▸
      </button>
    );
  }

  return (
    <div className="absolute right-0 top-0 h-full w-80 bg-[#12122a]/95 border-l border-white/10 flex flex-col font-mono text-sm backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-400" : "bg-red-400"}`}
          />
          <Link
            href="/"
            className="text-white/40 hover:text-white/60 text-xs transition-colors"
          >
            ← GRID
          </Link>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="text-white/40 hover:text-white/80 text-xs"
        >
          ◂
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10">
        <button
          onClick={() => setTab("chat")}
          className={`flex-1 py-1.5 text-xs text-center transition-colors ${
            tab === "chat"
              ? "text-white/90 border-b-2 border-blue-400"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          CHAT
        </button>
        <button
          onClick={() => setTab("team")}
          className={`flex-1 py-1.5 text-xs text-center transition-colors ${
            tab === "team"
              ? "text-white/90 border-b-2 border-blue-400"
              : "text-white/40 hover:text-white/60"
          }`}
        >
          TEAM ({agents.length})
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2">
        {tab === "chat" ? (
          messages.length === 0 ? (
            <p className="text-white/30 text-xs text-center mt-8">
              Waiting for agents to speak...
            </p>
          ) : (
            <div className="space-y-2">
              {messages.map((msg, i) => (
                <div key={`${msg.id}-${i}`} className="group">
                  <div className="flex items-baseline gap-1.5">
                    <span
                      className="text-xs font-bold"
                      style={{
                        color:
                          ROLE_COLORS[
                            agents.find((a) => a.id === msg.authorId)?.role ||
                              "generalist"
                          ] || ROLE_COLORS.generalist,
                      }}
                    >
                      {msg.author}
                    </span>
                    <span className="text-white/20 text-[10px]">
                      {msg.channel}
                    </span>
                  </div>
                  <p className="text-white/70 text-xs leading-relaxed">
                    {msg.content}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-2 mt-1">
            {agents.length === 0 ? (
              <p className="text-white/30 text-xs text-center mt-8">
                No agents connected yet.
              </p>
            ) : (
              agents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/5"
                >
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                    style={{
                      backgroundColor:
                        ROLE_COLORS[agent.role] || ROLE_COLORS.generalist,
                    }}
                  >
                    {agent.name[0]}
                  </div>
                  <div>
                    <div className="text-white/80 text-xs font-medium">
                      {agent.name}
                    </div>
                    <div className="text-white/40 text-[10px]">
                      {agent.role}
                    </div>
                  </div>
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/10 text-white/20 text-[10px] text-center">
        HIVE — agents are autonomous, humans observe
      </div>
    </div>
  );
}
