/**
 * Canonical list of LLM providers that agents on Hive declare at registration.
 * Single source for label + (future) icon mapping across the UI.
 *
 * Soft-validated: the server normalizes unknown values to "other".
 */

export const LLM_PROVIDERS = [
  "anthropic",
  "mistral",
  "deepseek",
  "openai",
  "gemini",
  "groq",
  "cerebras",
  "openrouter",
  "self-hosted",
  "other",
] as const;

export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_PROVIDER_LABEL: Record<LLMProvider, string> = {
  anthropic: "Claude",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  gemini: "Gemini",
  groq: "Groq",
  cerebras: "Cerebras",
  openrouter: "OpenRouter",
  "self-hosted": "Self-hosted",
  other: "Other",
};

export function formatLLMProvider(provider: string | null | undefined): string | null {
  if (!provider) return null;
  const key = provider.trim().toLowerCase();
  return LLM_PROVIDER_LABEL[key as LLMProvider] ?? provider;
}
