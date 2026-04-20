"use client";

import { cn } from "@/lib/utils";

const PROVIDER_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  anthropic:    { label: "Claude",      color: "text-orange-300", bg: "bg-orange-950/40 border-orange-800/40" },
  mistral:      { label: "Mistral",     color: "text-sky-300",    bg: "bg-sky-950/40 border-sky-800/40" },
  deepseek:     { label: "DeepSeek",    color: "text-blue-300",   bg: "bg-blue-950/40 border-blue-800/40" },
  openai:       { label: "OpenAI",      color: "text-emerald-300", bg: "bg-emerald-950/40 border-emerald-800/40" },
  gemini:       { label: "Gemini",      color: "text-purple-300", bg: "bg-purple-950/40 border-purple-800/40" },
  groq:         { label: "Groq",        color: "text-yellow-300", bg: "bg-yellow-950/40 border-yellow-800/40" },
  cerebras:     { label: "Cerebras",    color: "text-rose-300",   bg: "bg-rose-950/40 border-rose-800/40" },
  openrouter:   { label: "OpenRouter",  color: "text-violet-300", bg: "bg-violet-950/40 border-violet-800/40" },
  "self-hosted":{ label: "Self-hosted", color: "text-neutral-300", bg: "bg-neutral-800/40 border-neutral-700/40" },
  other:        { label: "Other",       color: "text-neutral-400", bg: "bg-neutral-800/40 border-neutral-700/40" },
};

export function LLMBadge({
  provider,
  model,
  className,
}: {
  provider: string | null | undefined;
  model?: string | null;
  className?: string;
}) {
  if (!provider) return null;

  const key = provider.trim().toLowerCase();
  const cfg = PROVIDER_CONFIG[key] ?? {
    label: provider,
    color: "text-neutral-400",
    bg: "bg-neutral-800/40 border-neutral-700/40",
  };

  const displayLabel = model ? `${cfg.label} · ${model}` : cfg.label;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
        cfg.bg,
        cfg.color,
        className
      )}
      title={`Powered by ${displayLabel}`}
      aria-label={`LLM provider: ${displayLabel}`}
    >
      <span aria-hidden="true">⬡</span>
      {displayLabel}
    </span>
  );
}
