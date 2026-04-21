"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Check, Copy, Loader2, ShieldAlert } from "lucide-react";
import { getToken } from "@/providers/auth-provider";
import { LLM_PROVIDERS, LLM_PROVIDER_LABEL, type LLMProvider } from "@/lib/llmProviders";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const MAX_HIRE_NAME_LENGTH = 64;
const COPY_FEEDBACK_MS = 1800;

type ProviderPreset = {
  baseUrl: string;
  defaultModel: string;
  keyHint: string;
};

const PROVIDER_PRESETS: Partial<Record<LLMProvider, ProviderPreset>> = {
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1/openai",
    defaultModel: "claude-haiku-4-5-20251001",
    keyHint: "sk-ant-...",
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    keyHint: "mistral-...",
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    keyHint: "sk-...",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    keyHint: "sk-...",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash-lite",
    keyHint: "AIza...",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    keyHint: "gsk_...",
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    defaultModel: "llama3.1-8b",
    keyHint: "csk_...",
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "anthropic/claude-haiku",
    keyHint: "sk-or-...",
  },
};

const SELECTABLE_PROVIDERS = LLM_PROVIDERS.filter(
  (p) => p !== "self-hosted" && p !== "other",
);

const EXPIRATION_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never" },
] as const;

type ExpirationValue = (typeof EXPIRATION_OPTIONS)[number]["value"];

type Agent = {
  id: string;
  name: string;
};

type HireResponse = {
  hire?: { id: string; name: string };
  hire_token?: string;
  error?: string;
  message?: string;
};

type RespondResponse = {
  response?: string;
  message?: string;
  content?: string;
  cost_usd?: number;
  latency_ms?: number;
  error?: string;
};

type Step = 1 | 2 | 3;

export function HireApiTab({ agent }: { agent: Agent }) {
  const [step, setStep] = useState<Step>(1);

  // Step 1 form
  const [hireName, setHireName] = useState("");
  const [providerId, setProviderId] = useState<LLMProvider>("anthropic");
  const [llmKey, setLlmKey] = useState("");
  const [expiration, setExpiration] = useState<ExpirationValue>("30");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Step 2 result
  const [hireToken, setHireToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  // Step 3 test
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    text: string;
    cost_usd: number | null;
    latency_ms: number | null;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testPhase6Notice, setTestPhase6Notice] = useState(false);

  const preset = PROVIDER_PRESETS[providerId];

  const snippets = useMemo(
    () =>
      hireToken
        ? buildSnippets({
            token: hireToken,
            agentId: agent.id,
            apiUrl: API_URL,
          })
        : null,
    [hireToken, agent.id],
  );

  async function handleGenerate() {
    const authToken = getToken();
    if (!authToken) {
      setGenerateError("You need to be signed in to generate a hire token.");
      return;
    }

    const trimmedName = hireName.trim();
    if (trimmedName.length === 0) {
      setGenerateError("Give this hire a name you'll recognize later.");
      return;
    }
    if (llmKey.trim().length === 0) {
      setGenerateError("An LLM API key is required so the hire can actually answer.");
      return;
    }

    setGenerating(true);
    setGenerateError(null);

    try {
      const body: Record<string, unknown> = {
        name: trimmedName,
        llm_api_key: llmKey.trim(),
      };
      if (preset) {
        body.llm_base_url = preset.baseUrl;
        body.llm_model = preset.defaultModel;
      }
      if (expiration !== "never") {
        body.expires_in_days = Number(expiration);
      }

      const res = await fetch(`${API_URL}/api/agents/${agent.id}/hires`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      });

      const data = (await res.json().catch(() => ({}))) as HireResponse;
      if (!res.ok || !data.hire_token) {
        setGenerateError(
          data.message || data.error || `Request failed (${res.status}).`,
        );
        return;
      }
      setHireToken(data.hire_token);
      setStep(2);
    } catch (err) {
      setGenerateError(
        err instanceof Error ? err.message : "Network error. Try again.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopyToken() {
    if (!hireToken) return;
    try {
      await navigator.clipboard.writeText(hireToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), COPY_FEEDBACK_MS);
    } catch {
      // clipboard blocked — silently ignore.
    }
  }

  async function handleCopySnippet(id: string, code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedSnippet(id);
      setTimeout(() => setCopiedSnippet(null), COPY_FEEDBACK_MS);
    } catch {
      // clipboard blocked — silently ignore.
    }
  }

  async function handleTest() {
    if (!hireToken) return;
    const trimmed = testMessage.trim();
    if (trimmed.length === 0) return;

    setTesting(true);
    setTestResult(null);
    setTestError(null);
    setTestPhase6Notice(false);

    const startedAt = performance.now();
    try {
      const res = await fetch(`${API_URL}/api/agents/${agent.id}/respond`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${hireToken}`,
        },
        body: JSON.stringify({ message: trimmed }),
      });

      if (res.status === 404 || res.status === 501) {
        setTestPhase6Notice(true);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as RespondResponse;
      if (!res.ok) {
        setTestError(
          data.message || data.error || `Request failed (${res.status}).`,
        );
        return;
      }

      const clientLatency = Math.round(performance.now() - startedAt);
      const text = data.response ?? data.message ?? data.content ?? "";
      setTestResult({
        text: typeof text === "string" ? text : JSON.stringify(text, null, 2),
        cost_usd: typeof data.cost_usd === "number" ? data.cost_usd : null,
        latency_ms: typeof data.latency_ms === "number" ? data.latency_ms : clientLatency,
      });
    } catch (err) {
      setTestError(
        err instanceof Error ? err.message : "Network error. Try again.",
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <StepHeader step={step} />

      {step === 1 && (
        <Step1Form
          hireName={hireName}
          onHireNameChange={setHireName}
          providerId={providerId}
          onProviderChange={setProviderId}
          llmKey={llmKey}
          onLlmKeyChange={setLlmKey}
          expiration={expiration}
          onExpirationChange={setExpiration}
          preset={preset}
          generating={generating}
          generateError={generateError}
          onGenerate={handleGenerate}
        />
      )}

      {step === 2 && hireToken && snippets && (
        <Step2Token
          agentName={agent.name}
          token={hireToken}
          snippets={snippets}
          copiedToken={copiedToken}
          copiedSnippet={copiedSnippet}
          onCopyToken={handleCopyToken}
          onCopySnippet={handleCopySnippet}
          onContinue={() => setStep(3)}
        />
      )}

      {step === 3 && (
        <Step3Test
          agentName={agent.name}
          testMessage={testMessage}
          onTestMessageChange={setTestMessage}
          testing={testing}
          testResult={testResult}
          testError={testError}
          phase6Notice={testPhase6Notice}
          onSend={handleTest}
          onBack={() => setStep(2)}
        />
      )}
    </div>
  );
}

// ─── Step header ────────────────────────────────────────────────────────────

function StepHeader({ step }: { step: Step }) {
  return (
    <ol className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {[1, 2, 3].map((n) => {
        const active = n === step;
        const done = n < step;
        return (
          <li key={n} className="flex items-center gap-1.5">
            <span
              className={
                active
                  ? "inline-flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                  : done
                    ? "inline-flex size-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-semibold text-primary"
                    : "inline-flex size-5 items-center justify-center rounded-full border text-[10px] font-semibold"
              }
            >
              {n}
            </span>
            <span className={active ? "font-medium text-foreground" : ""}>
              {["Generate", "Integrate", "Test"][n - 1]}
            </span>
            {n < 3 && <span className="text-muted-foreground/60">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Step 1: Generate ───────────────────────────────────────────────────────

function Step1Form({
  hireName,
  onHireNameChange,
  providerId,
  onProviderChange,
  llmKey,
  onLlmKeyChange,
  expiration,
  onExpirationChange,
  preset,
  generating,
  generateError,
  onGenerate,
}: {
  hireName: string;
  onHireNameChange: (v: string) => void;
  providerId: LLMProvider;
  onProviderChange: (v: LLMProvider) => void;
  llmKey: string;
  onLlmKeyChange: (v: string) => void;
  expiration: ExpirationValue;
  onExpirationChange: (v: ExpirationValue) => void;
  preset: ProviderPreset | undefined;
  generating: boolean;
  generateError: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hire-name">Hire name</Label>
        <Input
          id="hire-name"
          value={hireName}
          onChange={(e) => onHireNameChange(e.target.value)}
          placeholder="prod-backend"
          maxLength={MAX_HIRE_NAME_LENGTH}
        />
        <p className="text-xs text-muted-foreground">
          A label just for you — shown in your dashboard next to this token.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hire-provider">LLM provider</Label>
        <Select
          value={providerId}
          onValueChange={(v) => onProviderChange(v as LLMProvider)}
        >
          <SelectTrigger id="hire-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SELECTABLE_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {LLM_PROVIDER_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset && (
          <p className="text-xs text-muted-foreground">
            Default model: <span className="font-mono">{preset.defaultModel}</span>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hire-key">
          {LLM_PROVIDER_LABEL[providerId]} API key
        </Label>
        <Input
          id="hire-key"
          type="password"
          autoComplete="off"
          value={llmKey}
          onChange={(e) => onLlmKeyChange(e.target.value)}
          placeholder={preset?.keyHint ?? "sk-..."}
        />
        <p className="text-xs text-muted-foreground">
          Used only to call the LLM on your behalf. Stored encrypted; never
          shown again.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hire-expiration">Expiration</Label>
        <Select
          value={expiration}
          onValueChange={(v) => onExpirationChange(v as ExpirationValue)}
        >
          <SelectTrigger id="hire-expiration" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EXPIRATION_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {generateError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{generateError}</span>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onGenerate} disabled={generating} className="gap-1.5">
          {generating && (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          )}
          Generate token
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: Integrate ──────────────────────────────────────────────────────

type SnippetMap = {
  curl: string;
  js: string;
  python: string;
};

function Step2Token({
  agentName,
  token,
  snippets,
  copiedToken,
  copiedSnippet,
  onCopyToken,
  onCopySnippet,
  onContinue,
}: {
  agentName: string;
  token: string;
  snippets: SnippetMap;
  copiedToken: boolean;
  copiedSnippet: string | null;
  onCopyToken: () => void;
  onCopySnippet: (id: string, code: string) => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed">
        <p className="font-medium text-foreground">
          Save this token now — you won&apos;t see it again.
        </p>
        <p className="mt-0.5 text-muted-foreground">
          Hive stores a one-way hash. Lose it and you&apos;ll need to generate a
          new one.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Hire token</Label>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-[11px] leading-relaxed">
            {token}
          </code>
          <Button
            size="sm"
            variant="outline"
            onClick={onCopyToken}
            className="gap-1.5"
          >
            {copiedToken ? (
              <Check className="size-3.5 text-green-500" aria-hidden="true" />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            {copiedToken ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Integration snippets</Label>
        <Tabs defaultValue="curl" className="w-full">
          <TabsList>
            <TabsTrigger value="curl">cURL</TabsTrigger>
            <TabsTrigger value="js">JavaScript</TabsTrigger>
            <TabsTrigger value="python">Python</TabsTrigger>
          </TabsList>
          {(["curl", "js", "python"] as const).map((id) => (
            <TabsContent key={id} value={id} className="mt-2">
              <div className="relative">
                <pre className="max-h-56 overflow-auto rounded-lg border bg-muted/30 p-3 pr-10 font-mono text-[11px] leading-relaxed">
                  {snippets[id]}
                </pre>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onCopySnippet(id, snippets[id])}
                  className="absolute right-1.5 top-1.5 size-7 p-0"
                  aria-label={`Copy ${id} snippet`}
                >
                  {copiedSnippet === id ? (
                    <Check
                      className="size-3.5 text-green-500"
                      aria-hidden="true"
                    />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>

      <div className="flex justify-end">
        <Button onClick={onContinue} className="gap-1.5">
          Test it now → ({agentName})
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: Test ───────────────────────────────────────────────────────────

function Step3Test({
  agentName,
  testMessage,
  onTestMessageChange,
  testing,
  testResult,
  testError,
  phase6Notice,
  onSend,
  onBack,
}: {
  agentName: string;
  testMessage: string;
  onTestMessageChange: (v: string) => void;
  testing: boolean;
  testResult: { text: string; cost_usd: number | null; latency_ms: number | null } | null;
  testError: string | null;
  phase6Notice: boolean;
  onSend: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hire-test-message">
          Send {agentName} a message
        </Label>
        <Textarea
          id="hire-test-message"
          value={testMessage}
          onChange={(e) => onTestMessageChange(e.target.value)}
          placeholder="What's the smallest change that would de-risk this migration?"
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Sent with your hire token against{" "}
          <span className="font-mono">POST /api/agents/:id/respond</span>.
        </p>
      </div>

      {phase6Notice && (
        <div className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed">
          <p className="font-medium text-foreground">
            Live invoke is not wired up yet
          </p>
          <p className="mt-0.5 text-muted-foreground">
            The <span className="font-mono">/respond</span> endpoint lands in
            Phase 6. Your token already works — you can call the other
            endpoints shown in Step 2 today.
          </p>
        </div>
      )}

      {testError && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{testError}</span>
        </div>
      )}

      {testResult && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {testResult.text || "(empty response)"}
          </pre>
          <div className="flex flex-wrap items-center gap-3 border-t pt-2 text-xs text-muted-foreground">
            {testResult.cost_usd != null && (
              <span>
                Cost: <span className="font-mono">${testResult.cost_usd.toFixed(6)}</span>
              </span>
            )}
            {testResult.latency_ms != null && (
              <span>
                Latency: <span className="font-mono">{testResult.latency_ms}ms</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Back to snippets
        </Button>
        <Button
          onClick={onSend}
          disabled={testing || testMessage.trim().length === 0}
          className="gap-1.5"
        >
          {testing && (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          )}
          Send
        </Button>
      </div>
    </div>
  );
}

// ─── Snippet builders ───────────────────────────────────────────────────────

function buildSnippets({
  token,
  agentId,
  apiUrl,
}: {
  token: string;
  agentId: string;
  apiUrl: string;
}): SnippetMap {
  const endpoint = `${apiUrl}/api/agents/${agentId}/respond`;

  const curl = `curl -X POST "${endpoint}" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello"}'`;

  const js = `const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ message: "Hello" }),
});
const data = await res.json();
console.log(data.response);`;

  const python = `import requests

res = requests.post(
    "${endpoint}",
    headers={
        "Authorization": "Bearer ${token}",
        "Content-Type": "application/json",
    },
    json={"message": "Hello"},
)
print(res.json()["response"])`;

  return { curl, js, python };
}
