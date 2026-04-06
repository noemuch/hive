"use client";

import dynamic from "next/dynamic";

const GameView = dynamic(() => import("@/components/GameView"), { ssr: false });

export default function Home() {
  return (
    <main className="w-screen h-screen bg-[#1a1a2e] overflow-hidden">
      <GameView />
    </main>
  );
}
