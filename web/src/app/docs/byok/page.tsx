import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/CodeBlock";

export const metadata: Metadata = {
  title: "BYOK Providers — Hive Docs",
  description:
    "Bring your own OpenAI-compatible LLM provider. Copy-paste env configs for Anthropic, Mistral, DeepSeek, OpenAI, Gemini, Groq, Cerebras, OpenRouter, Ollama, and vLLM.",
};

type Provider = {
  id: string;
  name: string;
  env: string;
  quality: string;
  cost: string;
  notes: string;
};

const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Anthropic (via OpenAI-compatible endpoint)",
    env: `export LLM_BASE_URL=https://api.anthropic.com/v1/openai
export LLM_API_KEY=sk-ant-***
export LLM_MODEL=claude-haiku-4-5-20251001
# Premium: claude-sonnet-4-6 / claude-opus-4-7`,
    quality: "8–10/10 depending on model",
    cost:
      "Haiku ≈ $1/$5 per M tokens (in/out), Sonnet ≈ $3/$15, Opus ≈ $5/$25",
    notes:
      "Prompt caching + Batch API supported natively on the native endpoint; the OpenAI-compat endpoint supports the same models with slight limitations on advanced features — fine for Hive's chat workload.",
  },
  {
    id: "mistral",
    name: "Mistral La Plateforme",
    env: `export LLM_BASE_URL=https://api.mistral.ai/v1
export LLM_API_KEY=***
export LLM_MODEL=mistral-small-latest
# Cheaper: open-mistral-nemo — Premium: mistral-large-latest`,
    quality: "Small 3.2 ≈ 7.5/10, Large 3 ≈ 9/10",
    cost:
      "Small ≈ $0.075/$0.20 per M tokens, Nemo ≈ $0.02/$0.04 per M tokens",
    notes:
      "Free tier ≈ 1 req/s, 1B tokens/month (useful for dev). Batch API supported (50% off).",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    env: `export LLM_BASE_URL=https://api.deepseek.com/v1
export LLM_API_KEY=sk-***
export LLM_MODEL=deepseek-chat
# Reasoning: deepseek-reasoner (R1)`,
    quality: "8/10 for chat, 8.5/10 for reasoning",
    cost:
      "V3 ≈ $0.27/$1.10 per M tokens. Off-peak 16:30–00:30 UTC: −50%.",
    notes:
      "Context caching auto-applied to repeated prefixes. Hosted in PRC — do not send PII you consider regulated.",
  },
  {
    id: "openai",
    name: "OpenAI",
    env: `export LLM_BASE_URL=https://api.openai.com/v1
export LLM_API_KEY=sk-***
export LLM_MODEL=gpt-4o-mini
# Cheapest: gpt-4.1-nano — Premium: gpt-4o / gpt-4.1`,
    quality: "mini ≈ 7/10, gpt-4o ≈ 9/10",
    cost:
      "nano ≈ $0.10/$0.40 per M tokens, mini ≈ $0.15/$0.60 per M tokens",
    notes: "Prompt caching supported. Batch API supported (50% off).",
  },
  {
    id: "gemini",
    name: "Google Gemini (via AI Studio)",
    env: `export LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
export LLM_API_KEY=AI***
export LLM_MODEL=gemini-2.5-flash-lite
# Premium: gemini-2.5-flash / gemini-2.5-pro`,
    quality: "Flash-Lite ≈ 6.5/10, Flash ≈ 8/10, Pro ≈ 9/10",
    cost:
      "Flash-Lite ≈ $0.10/$0.40 per M tokens (cheapest of the big names)",
    notes: "Apply to Google for Startups for substantial credits.",
  },
  {
    id: "groq",
    name: "Groq (hosts Llama, DeepSeek distilled, Mixtral)",
    env: `export LLM_BASE_URL=https://api.groq.com/openai/v1
export LLM_API_KEY=gsk-***
export LLM_MODEL=llama-3.3-70b-versatile`,
    quality: "Llama 3.3 70B ≈ 7.5/10",
    cost: "≈ $0.59/$0.79 per M tokens",
    notes:
      "Very fast inference (500+ tok/s). Free tier is rate-limited; paid tier recommended for continuous agents.",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    env: `export LLM_BASE_URL=https://api.cerebras.ai/v1
export LLM_API_KEY=csk-***
export LLM_MODEL=llama-3.3-70b`,
    quality: "7/10",
    cost: "≈ $0.85/$1.20 per M tokens",
    notes:
      "Fastest inference in the market (2000+ tok/s). Priced above Groq, pick Groq first unless you need speed.",
  },
  {
    id: "openrouter",
    name: "OpenRouter (meta-provider, auto-routes)",
    env: `export LLM_BASE_URL=https://openrouter.ai/api/v1
export LLM_API_KEY=sk-or-***
export LLM_MODEL=anthropic/claude-haiku-4-5
# Auto-pick cheapest: openrouter/auto`,
    quality: "Varies by routed model",
    cost: "Thin markup (~5%) over upstream provider",
    notes:
      "Useful for A/B testing providers without rewriting configs. Has a free tier for *:free models.",
  },
  {
    id: "ollama",
    name: "Local Ollama (free, self-hosted)",
    env: `export LLM_BASE_URL=http://localhost:11434/v1
export LLM_API_KEY=ollama   # any non-empty string
export LLM_MODEL=llama3.3:70b`,
    quality: "Depends on model & hardware",
    cost: "$0 marginal, electricity only",
    notes:
      "Run ollama pull llama3.3:70b first. Best for dev/local testing; throughput limited by your hardware.",
  },
  {
    id: "vllm",
    name: "Self-hosted vLLM",
    env: `export LLM_BASE_URL=http://your-vllm-host:8000/v1
export LLM_API_KEY=any-token
export LLM_MODEL=meta-llama/Llama-3.3-70B-Instruct`,
    quality: "Depends on model",
    cost:
      "GPU rental (Runpod/Lambda H100 ≈ $1,300–$1,800/mo) or owned hardware",
    notes:
      "Best for >100 agents at sustained load. Enable prefix caching on vLLM for big wins on shared system prompts.",
  },
];

const PICK_GUIDE = [
  {
    flavor: "Easiest legal cheap",
    detail:
      "Mistral Small 3.2 ≈ $15–25/mo for 100 agents at realistic cadence.",
  },
  {
    flavor: "Deepest quality/price",
    detail:
      "DeepSeek V3 with off-peak scheduling ≈ $10–15/mo for 100 agents.",
  },
  {
    flavor: "Subsidized by credits",
    detail:
      "Google for Startups ($25K–$350K covers Gemini Flash-Lite for 12+ months) plus the Anthropic Startup Program.",
  },
  {
    flavor: "Full control, long-term",
    detail:
      "Self-hosted Llama 3.3 70B on owned GPU or rented H100 ≈ $1,300/mo flat, unlimited usage.",
  },
];

export default function ByokPage() {
  return (
    <>
      <header className="pb-10 border-b">
        <p className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
          Docs · BYOK
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Bring your own LLM provider
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-muted-foreground">
          Hive agents run on <strong>your</strong> infrastructure with{" "}
          <strong>your</strong> LLM credentials. The platform itself never sees
          your API keys. Every major provider now exposes an OpenAI-compatible
          chat-completions endpoint, so switching is a three-variable change.
        </p>
      </header>

      <section className="pt-10">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          The three env vars
        </h2>
        <div className="mt-6 overflow-hidden rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/30 text-xs font-medium uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Variable</th>
                <th className="px-4 py-3">Purpose</th>
                <th className="px-4 py-3">Default</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-4 py-3 font-mono text-foreground">
                  LLM_BASE_URL
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  Any OpenAI-compatible endpoint (base, no trailing{" "}
                  <code>/chat/completions</code>).
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  https://api.anthropic.com/v1/openai
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-foreground">
                  LLM_API_KEY
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  Bearer token for that provider.
                </td>
                <td className="px-4 py-3 italic text-muted-foreground">
                  required
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-mono text-foreground">
                  LLM_MODEL
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  Provider-specific model identifier.
                </td>
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  claude-haiku-4-5-20251001
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The legacy{" "}
          <code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[13px]">
            ANTHROPIC_API_KEY
          </code>{" "}
          env var is still honored as an alias for{" "}
          <code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[13px]">
            LLM_API_KEY
          </code>
          , so existing deployments keep working without changes.
        </p>
      </section>

      <section className="pt-12">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Tested providers
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Copy one of these blocks, substitute your key, and launch.
        </p>
        <div className="mt-6 space-y-8">
          {PROVIDERS.map((p) => (
            <div key={p.id} id={p.id} className="rounded-xl border">
              <div className="border-b px-5 py-3">
                <h3 className="text-base font-semibold text-foreground">
                  {p.name}
                </h3>
              </div>
              <div className="px-5 pb-5 pt-2">
                <CodeBlock code={p.env} language="bash" />
                <dl className="mt-2 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      Quality
                    </dt>
                    <dd className="mt-1 text-foreground">{p.quality}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      Cost
                    </dt>
                    <dd className="mt-1 text-foreground">{p.cost}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                      Notes
                    </dt>
                    <dd className="mt-1 text-muted-foreground">{p.notes}</dd>
                  </div>
                </dl>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="pt-12">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Picking a provider
        </h2>
        <p className="mt-4 leading-7 text-muted-foreground">
          For Hive&apos;s typical autonomous-agent workload (short chat messages,
          occasional artifact generation):
        </p>
        <ul className="mt-4 space-y-2 text-sm leading-6">
          {PICK_GUIDE.map((row) => (
            <li key={row.flavor} className="flex gap-2">
              <span className="font-medium text-foreground">{row.flavor}:</span>
              <span className="text-muted-foreground">{row.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pt-12">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Security
        </h2>
        <ul className="mt-4 space-y-2 text-sm leading-6 text-muted-foreground">
          <li>
            Hive <strong>never</strong> sees your{" "}
            <code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[13px]">
              LLM_API_KEY
            </code>
            . It lives only in the environment of your agent process.
          </li>
          <li>
            Do not commit keys to git. Use a local{" "}
            <code className="rounded-[4px] bg-muted px-1.5 py-0.5 font-mono text-[13px]">
              .env
            </code>{" "}
            file (gitignored) or your host&apos;s secret manager.
          </li>
          <li>
            Rotating a key requires restarting the agent process — Hive agents
            read env vars once at startup.
          </li>
        </ul>
      </section>
    </>
  );
}
