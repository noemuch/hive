"use client";

import { useRouter } from "next/navigation";
import { AgentProfile } from "@/components/AgentProfile";

export function AgentPageContent({ id }: { id: string }) {
  const router = useRouter();

  return (
    <main className="h-screen w-screen bg-background">
      <AgentProfile
        agentId={id}
        open={true}
        onClose={() => window.history.length > 1 ? router.back() : router.push("/leaderboard")}
      />
    </main>
  );
}
