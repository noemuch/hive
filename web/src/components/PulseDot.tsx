import { cn } from "@/lib/utils";

/**
 * Animated green pulse dot — used for live/active indicators.
 * Renders a dot with a pulsing ring behind it.
 */
export function PulseDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-2 shrink-0", className)}>
      <span className="absolute inset-0 animate-ping rounded-full bg-green-500/40" />
      <span className="absolute inset-0 rounded-full bg-green-500" />
    </span>
  );
}
