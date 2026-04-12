"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { OfficeHeader } from "@/components/OfficeHeader";
import { AgentProfile } from "@/components/AgentProfile";
import ChatPanel from "@/components/ChatPanel";
import AgentsPanel from "@/components/AgentsPanel";

const GameView = dynamic(() => import("@/components/GameView"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-background" />,
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type CompanyData = {
  name: string;
  status: string;
  agent_count: number;
  active_agent_count: number;
  messages_today: number;
};

type FetchState =
  | { status: "loading"; company: null }
  | { status: "notFound"; company: null }
  | { status: "ready"; company: CompanyData };

export default function CompanyContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [fetchState, setFetchState] = useState<FetchState>({
    status: "loading",
    company: null,
  });

  // Fetch company info
  useEffect(() => {
    let cancelled = false;

    fetch(`${API_URL}/api/companies/${id}`)
      .then((r) => {
        if (r.status === 404) {
          if (!cancelled) setFetchState({ status: "notFound", company: null });
          return null;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: CompanyData | null) => {
        if (!cancelled && data)
          setFetchState({ status: "ready", company: data });
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: "notFound", company: null });
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  // Panel state
  const [chatOpen, setChatOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const toggleChat = useCallback(() => {
    setChatOpen((v) => !v);
    setAgentsOpen(false);
  }, []);

  const toggleAgents = useCallback(() => {
    setAgentsOpen((v) => !v);
    setChatOpen(false);
  }, []);

  const panelOpen = chatOpen || agentsOpen;

  // Agent profile from URL query
  const selectedAgentId = searchParams.get("agent");

  const handleAgentClick = useCallback(
    (agentId: string) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set("agent", agentId);
      router.replace(`/company/${id}?${p.toString()}`, { scroll: false });
    },
    [id, searchParams, router],
  );

  const handleAgentClose = useCallback(() => {
    const p = new URLSearchParams(searchParams.toString());
    p.delete("agent");
    const qs = p.toString();
    router.replace(`/company/${id}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [id, searchParams, router]);

  if (fetchState.status === "loading") {
    return (
      <main className="w-screen h-screen bg-background overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="w-64 h-6" />
          <Skeleton className="w-48 h-4" />
          <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground mt-4" />
        </div>
      </main>
    );
  }

  if (fetchState.status === "notFound") {
    return (
      <main className="w-screen h-screen bg-background overflow-hidden flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="text-muted-foreground">Company not found.</p>
        <Link href="/" className="text-sm text-primary hover:underline">
          ← Back to grid
        </Link>
      </main>
    );
  }

  return (
    <main className="w-screen h-screen bg-background overflow-hidden flex flex-col">
      <OfficeHeader
        companyName={fetchState.company.name}
        status={fetchState.company.status}
        chatOpen={chatOpen}
        agentsOpen={agentsOpen}
        onlineCount={fetchState.company.active_agent_count}
        unreadCount={unreadCount}
        onChatToggle={toggleChat}
        onAgentsToggle={toggleAgents}
      />
      <div className="flex flex-1 overflow-hidden">
        <GameView
          companyId={id}
          onAgentClick={handleAgentClick}
          panelOpen={panelOpen}
          renderSidebar={({ feedItems, agents }) => (
            <>
              <ChatPanel
                feedItems={feedItems}
                agents={agents}
                open={chatOpen}
                onClose={() => setChatOpen(false)}
                onUnreadChange={setUnreadCount}
              />
              <AgentsPanel
                agents={agents}
                open={agentsOpen}
                onClose={() => setAgentsOpen(false)}
                onAgentClick={handleAgentClick}
              />
            </>
          )}
        />
      </div>
      <AgentProfile
        agentId={selectedAgentId}
        open={!!selectedAgentId}
        onClose={handleAgentClose}
      />
    </main>
  );
}
