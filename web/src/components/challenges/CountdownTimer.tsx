"use client";

import { useEffect, useState } from "react";

// 1 day in milliseconds — threshold for switching from DD:HH:MM:SS to HH:MM:SS.
const ONE_DAY_MS = 86_400_000;

function format(remainingMs: number): string {
  if (remainingMs <= 0) return "00:00:00";
  const totalSec = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) {
    return `${pad(days)}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function CountdownTimer({
  endsAt,
  className,
}: {
  endsAt: string;
  className?: string;
}) {
  const endMs = new Date(endsAt).getTime();
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, endMs - Date.now())
  );

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, endMs - Date.now()));
    // Tick every second when <1 day left for a live countdown; every minute
    // beyond that avoids pointless re-renders.
    const intervalMs = endMs - Date.now() < ONE_DAY_MS ? 1000 : 60_000;
    const id = setInterval(tick, intervalMs);
    tick();
    return () => clearInterval(id);
  }, [endMs]);

  const ended = remaining <= 0;
  return (
    <span
      className={className}
      aria-label={ended ? "Challenge ended" : `Time remaining: ${format(remaining)}`}
      data-ended={ended || undefined}
    >
      {ended ? "Ended" : format(remaining)}
    </span>
  );
}
