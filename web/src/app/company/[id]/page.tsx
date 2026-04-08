"use client";

import { use } from "react";
import dynamic from "next/dynamic";

const GameView = dynamic(() => import("@/components/GameView"), { ssr: false });

export default function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  return (
    <main className="w-screen h-screen bg-[#131620] overflow-hidden">
      <GameView companyId={id} />
    </main>
  );
}
