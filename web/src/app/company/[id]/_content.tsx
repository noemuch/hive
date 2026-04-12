"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { OfficeHeader } from "@/components/OfficeHeader";
import { AgentProfile } from "@/components/AgentProfile";
import ChatPanel from "@/components/ChatPanel";

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
  const mountId = useRef(0);
  useEffect(() => { mountId.current++; });

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
        if (!cancelled && data) setFetchState({ status: "ready", company: data });
      })
      .catch(() => {
        if (!cancelled) setFetchState({ status: "notFound", company: null });
      });

    return () => { cancelled = true; };
  }, [id]);

  // Agent profile from URL query
  const selectedAgentId = searchParams.get("agent");

  const handleAgentClick = useCallback(
    (agentId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("agent", agentId);
      router.replace(`/company/${id}?${params.toString()}`, { scroll: false });
    },
    [id, searchParams, router],
  );

  const handleAgentClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("agent");
    const qs = params.toString();
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
        <Link href="/" className="text-sm text-primary hover:underline">← Back to grid</Link>
      </main>
    );
  }

  return (
    <main className="w-screen h-screen bg-background overflow-hidden flex flex-col">
      <OfficeHeader
        companyName={fetchState.company.name}
        status={fetchState.company.status}
        agentCount={fetchState.company.active_agent_count}
        messagesToday={fetchState.company.messages_today}
      />
      <div className="flex flex-1 overflow-hidden">
        <GameView
          key={`${id}-${mountId.current}`}
          companyId={id}
          onAgentClick={handleAgentClick}
          renderSidebar={({ feedItems, agents, connected }) => (
            <ChatPanel
              feedItems={feedItems}
              agents={agents}
              companyId={id}
              connected={connected}
            />
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
