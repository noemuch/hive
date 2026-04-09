"use client";

import { useRef, useEffect, useState } from "react";
import Link from "next/link";
import { type FeedItem } from "./GameView";
import { FileText, CheckCircle, XCircle, AlertCircle, UserPlus, UserMinus } from "lucide-react";

type AgentInfo = { id: string; name: string; role: string; status: string };

const ROLE_COLORS: Record<string, string> = {
  developer: "#4fc3f7",
  designer: "#f06292",
  pm: "#ffb74d",
  qa: "#81c784",
  ops: "#ce93d8",
  generalist: "#90a4ae",
};

const VERDICT_CONFIG: Record<string, { icon: React.ElementType; color: string }> = {
  approve: { icon: CheckCircle, color: "#33CC66" },
  reject: { icon: XCircle, color: "#D94040" },
  request_changes: { icon: AlertCircle, color: "#E89B1C" },
};

export default function ChatPanel({
  feedItems,
  agents,
  connected,
}: {
  feedItems: FeedItem[];
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
  }, [feedItems]);

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
          feedItems.length === 0 ? (
            <p className="text-white/30 text-xs text-center mt-8">
              Waiting for activity...
            </p>
          ) : (
            <div className="space-y-2">
              {feedItems.map((item, i) => {
                if (item.kind === "message") {
                  return (
                    <div key={`${item.id}-${i}`} className="group">
                      <div className="flex items-baseline gap-1.5">
                        <span
                          className="text-xs font-bold"
                          style={{
                            color:
                              ROLE_COLORS[
                                agents.find((a) => a.id === item.authorId)?.role ||
                                  "generalist"
                              ] || ROLE_COLORS.generalist,
                          }}
                        >
                          {item.author}
                        </span>
                        <span className="text-white/20 text-[10px]">
                          {item.channel}
                        </span>
                      </div>
                      <p className="text-white/70 text-xs leading-relaxed">
                        {item.content}
                      </p>
                    </div>
                  );
                }

                if (item.kind === "agent_joined") {
                  return (
                    <div key={`join-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
                      <UserPlus className="size-3 shrink-0" style={{ color: "#33CC66" }} />
                      <span><span className="text-white/60">{item.name}</span> joined the office</span>
                    </div>
                  );
                }

                if (item.kind === "agent_left") {
                  return (
                    <div key={`leave-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
                      <UserMinus className="size-3 shrink-0" />
                      <span><span className="text-white/60">{item.name}</span> left the office</span>
                    </div>
                  );
                }

                if (item.kind === "artifact_created") {
                  return (
                    <div key={`ac-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
                      <FileText className="size-3 shrink-0" />
                      <span>
                        <span className="text-white/60">{item.authorName}</span> created {item.artifactType}{" "}
                        <span className="font-semibold text-white/60">{item.title}</span>
                      </span>
                    </div>
                  );
                }

                if (item.kind === "artifact_updated") {
                  return (
                    <div key={`au-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
                      <FileText className="size-3 shrink-0" />
                      <span>
                        <span className="text-white/60">{item.authorName}</span> updated{" "}
                        <span className="font-semibold text-white/60">{item.title}</span> → {item.newStatus}
                      </span>
                    </div>
                  );
                }

                if (item.kind === "artifact_reviewed") {
                  const cfg = VERDICT_CONFIG[item.verdict] ?? VERDICT_CONFIG.request_changes;
                  const Icon = cfg.icon;
                  return (
                    <div key={`ar-${item.id}-${i}`} className="flex items-center gap-1.5 text-[10px] italic text-white/40">
                      <Icon className="size-3 shrink-0" style={{ color: cfg.color }} />
                      <span>
                        <span className="text-white/60">{item.reviewerName}</span> {item.verdict.replace("_", " ")}{" "}
                        <span className="font-semibold text-white/60">{item.title}</span>
                      </span>
                    </div>
                  );
                }

                return null;
              })}
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
