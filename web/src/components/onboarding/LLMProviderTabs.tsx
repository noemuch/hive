"use client";

import { useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CopyableCodeBlock } from "./CopyableCodeBlock";

type ProviderId =
  | "openrouter"
  | "mistral"
  | "anthropic"
  | "openai"
  | "gemini"
  | "ollama";

type Provider = {
  id: ProviderId;
  label: string;
  note: string;
  signupUrl?: string;
  /** Build the env snippet for this provider, given the Hive API key. */
  build: (apiKey: string) => string;
};

const PROVIDERS: Provider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    note: "Recommended — 1 key, 300+ models across every major provider.",
    signupUrl: "https://openrouter.ai/",
    build: (k) => `# Hive
HIVE_API_KEY=${k}
HIVE_URL=ws://localhost:3000/agent
HIVE_API_URL=http://localhost:3000

# LLM — OpenRouter (1 key, 300+ models)
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=sk-or-v1-...
LLM_MODEL=anthropic/claude-haiku-4.5
LLM_PROVIDER=openrouter`,
  },
  {
    id: "mistral",
    label: "Mistral",
    note: "Cheapest quality sweet spot. $5 free credits on signup.",
    signupUrl: "https://console.mistral.ai/",
    build: (k) => `# Hive
HIVE_API_KEY=${k}
HIVE_URL=ws://localhost:3000/agent
HIVE_API_URL=http://localhost:3000

# LLM — Mistral La Plateforme
LLM_BASE_URL=https://api.mistral.ai/v1
LLM_API_KEY=...
LLM_MODEL=mistral-small-latest
LLM_PROVIDER=mistral`,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    note: "Premium quality. Claude Haiku 4.5 is fast and cheap.",
    signupUrl: "https://console.anthropic.com/",
    build: (k) => `# Hive
HIVE_API_KEY=${k}
HIVE_URL=ws://localhost:3000/agent
HIVE_API_URL=http://localhost:3000

# LLM — Anthropic Claude
LLM_BASE_URL=https://api.anthropic.com/v1/openai
LLM_API_KEY=sk-ant-...
LLM_MODEL=claude-haiku-4-5-20251001
LLM_PROVIDER=anthropic`,
  },
  {
    id: "openai",
    label: "OpenAI",
    note: "GPT-4o mini balances cost and quality well.",
    signupUrl: "https://platform.openai.com/",
    build: (k) => `# Hive
HIVE_API_KEY=${k}
HIVE_URL=ws://localhost:3000/agent
HIVE_API_URL=http://localhost:3000

# LLM — OpenAI
LLM_BASE_URL=https://api.openai.com/v1
LLM_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
LLM_PROVIDER=openai`,
  },
  {
    id: "gemini",
    label: "Gemini",
    note: "Google's Gemini 2.5 Flash-Lite is very cheap for throughput.",
    signupUrl: "https://aistudio.google.com/app/apikey",
    build: (k) => `# Hive
HIVE_API_KEY=${k}
HIVE_URL=ws://localhost:3000/agent
HIVE_API_URL=http://localhost:3000

# LLM — Google Gemini (OpenAI-compatible endpoint)
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_API_KEY=AI...
LLM_MODEL=gemini-2.5-flash-lite
LLM_PROVIDER=gemini`,
  },
  {
    id: "ollama",
    label: "Local Ollama",
    note: "Free, self-hosted. Run any open model on your own machine.",
    signupUrl: "https://ollama.com/",
    build: (k) => `# Hive
HIVE_API_KEY=${k}
HIVE_URL=ws://localhost:3000/agent
HIVE_API_URL=http://localhost:3000

# LLM — Local Ollama (self-hosted)
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=llama3.3:70b
LLM_PROVIDER=self-hosted`,
  },
];

type Props = {
  apiKey: string;
  /** Controlled selection. */
  value: ProviderId;
  onValueChange: (value: ProviderId) => void;
  /** Notify parent whenever the visible snippet changes (tab switch or key change). */
  onSnippetChange?: (snippet: string) => void;
};

export function LLMProviderTabs({ apiKey, value, onValueChange, onSnippetChange }: Props) {
  const current = PROVIDERS.find((p) => p.id === value) ?? PROVIDERS[0];

  useEffect(() => {
    if (onSnippetChange) onSnippetChange(current.build(apiKey));
    // Intentionally tracking both the selected tab and the key.
  }, [current, apiKey, onSnippetChange]);

  return (
    <Tabs
      value={value}
      onValueChange={(v) => onValueChange(v as ProviderId)}
      className="w-full"
    >
      <div className="-mx-1 overflow-x-auto px-1">
        <TabsList className="w-max min-w-full flex-nowrap">
          {PROVIDERS.map((p) => (
            <TabsTrigger key={p.id} value={p.id}>
              {p.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {PROVIDERS.map((p) => (
        <TabsContent key={p.id} value={p.id} className="mt-3 flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {p.note}
            {p.signupUrl && (
              <>
                {" "}
                <a
                  href={p.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-3 hover:text-foreground"
                >
                  Get an API key →
                </a>
              </>
            )}
          </p>
          <CopyableCodeBlock
            code={p.build(apiKey)}
            ariaLabel={`Copy ${p.label} env snippet`}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export type { ProviderId };
