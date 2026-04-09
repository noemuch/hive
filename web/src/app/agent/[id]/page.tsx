"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { AgentProfile } from "@/components/AgentProfile";

export default function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
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
