"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { LLM_PROVIDERS, LLM_PROVIDER_LABEL } from "@/lib/llmProviders";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Copy-feedback icon flips back to the clipboard icon after this many ms.
const COPY_FEEDBACK_MS = 2000;

type Step = 1 | 2 | 3;
type SnippetLang = "curl" | "js" | "python";

const EXPIRY_OPTIONS = [
  { label: "1 hour", value: "1h" },
  { label: "24 hours", value: "24h" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "Never", value: "never" },
] as const;

const SELECT_CLASS =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-foreground/30 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30";

const LANG_TABS: { value: SnippetLang; label: string }[] = [
  { value: "curl", label: "cURL" },
  { value: "js", label: "JavaScript" },
  { value: "python", label: "Python" },
];

function makeSnippets(agentId: string, token: string, apiUrl: string) {
  const endpoint = `${apiUrl}/api/agents/${agentId}/respond`;
  return {
    curl: `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello, what can you help me with?"}'`,
    js: `const res = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Authorization": "Bearer ${token}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ message: "Hello, what can you help me with?" }),
});
const data = await res.json();
console.log(data.response);`,
    python: `import requests

response = requests.post(
    "${endpoint}",
    headers={"Authorization": "Bearer ${token}"},
    json={"message": "Hello, what can you help me with?"},
)
print(response.json()["response"])`,
  };
}

// Phase 6 endpoints (hires + respond) may return 404/501 until the server
// work lands. Translate those into a friendly explainer rather than a raw
// HTTP error so the wizard stays useful pre-Phase 6.
function formatHireError(status: number, body: string, statusText: string): string {
  if (status === 404 || status === 501) {
    return "Hire API not yet available — Phase 6 server work is in progress.";
  }
  return body || `${status} ${statusText}`;
}

export function HireApiTab({ agentId }: { agentId: string }) {
  const [step, setStep] = useState<Step>(1);

  // Step 1
  const [hireLabel, setHireLabel] = useState("");
  const [llmProvider, setLlmProvider] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [expiry, setExpiry] = useState("7d");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Step 2
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  const [snippetLang, setSnippetLang] = useState<SnippetLang>("curl");

  // Step 3
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    response: string;
    cost_usd?: number;
    latency_ms?: number;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/hires`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: hireLabel || undefined,
          llm_provider: llmProvider || undefined,
          llm_key: llmKey,
          expires_in: expiry === "never" ? null : expiry,
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(formatHireError(res.status, body, res.statusText));
      }
      const data = (await res.json()) as { token: string };
      setToken(data.token);
      setStep(2);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Failed to generate token");
    } finally {
      setGenerating(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await fetch(`${API_URL}/api/agents/${agentId}/respond`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: testMessage }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(formatHireError(res.status, body, res.statusText));
      }
      const data = (await res.json()) as {
        response: string;
        cost_usd?: number;
        latency_ms?: number;
      };
      setTestResult(data);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Failed to call agent");
    } finally {
      setTesting(false);
    }
  }

  function handleCopyToken() {
    navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    });
  }

  // ─── Step 1: Configure ───────────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Configure your hire token. The agent will use your LLM credentials to respond on-demand.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hire-label">
            Label{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="hire-label"
            placeholder="e.g. my-app-integration"
            value={hireLabel}
            onChange={(e) => setHireLabel(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-provider">LLM Provider</Label>
          <select
            id="llm-provider"
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="" disabled>
              Select provider…
            </option>
            {LLM_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {LLM_PROVIDER_LABEL[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-key">LLM API Key</Label>
          <Input
            id="llm-key"
            type="password"
            placeholder="sk-…"
            value={llmKey}
            onChange={(e) => setLlmKey(e.target.value)}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            Stored encrypted, used only for this agent&apos;s responses.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="hire-expiry">Token Expiry</Label>
          <select
            id="hire-expiry"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className={SELECT_CLASS}
          >
            {EXPIRY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {generateError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <p className="text-xs text-destructive">{generateError}</p>
          </div>
        )}

        <Button
          className="w-full"
          disabled={generating || !llmProvider || !llmKey.trim()}
          onClick={handleGenerate}
        >
          {generating ? "Generating…" : "Generate token"}
        </Button>
      </div>
    );
  }

  // ─── Step 2: Token + snippets ────────────────────────────────────────────────

  if (step === 2) {
    const snippets = makeSnippets(agentId, token, API_URL);

    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Save this token now — it won&apos;t be shown again.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Hire token</Label>
          <div className="flex items-start gap-2">
            <code className="flex-1 break-all rounded-lg border bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed">
              {token}
            </code>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleCopyToken}
              aria-label="Copy token"
              className="mt-0.5 shrink-0"
            >
              {copied ? (
                <Check className="size-3.5 text-green-500" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Code snippets</Label>
          <div className="flex gap-0.5 rounded-lg border bg-muted/50 p-0.5">
            {LANG_TABS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setSnippetLang(value)}
                className={cn(
                  "flex-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  snippetLang === value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <pre className="overflow-x-auto rounded-lg border bg-muted/30 p-3 text-xs font-mono leading-relaxed">
            <code>{snippets[snippetLang]}</code>
          </pre>
        </div>

        <Button onClick={() => setStep(3)}>Test it now →</Button>
      </div>
    );
  }

  // ─── Step 3: Live test ───────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Send a live message to the agent and see its response.
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="test-msg">Message</Label>
        <Textarea
          id="test-msg"
          placeholder="Type a message to the agent…"
          value={testMessage}
          onChange={(e) => setTestMessage(e.target.value)}
          className="min-h-24"
        />
      </div>

      <Button
        onClick={handleTest}
        disabled={testing || !testMessage.trim()}
      >
        {testing ? "Sending…" : "Send message"}
      </Button>

      {testError && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <p className="text-xs text-destructive">{testError}</p>
        </div>
      )}

      {testResult && (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{testResult.response}</p>
          {(testResult.cost_usd != null || testResult.latency_ms != null) && (
            <div className="flex items-center gap-3 border-t pt-2 text-xs text-muted-foreground">
              {testResult.latency_ms != null && (
                <span>{testResult.latency_ms}ms</span>
              )}
              {testResult.cost_usd != null && (
                <span>${testResult.cost_usd.toFixed(6)}</span>
              )}
            </div>
          )}
        </div>
      )}

      <Button variant="outline" onClick={() => setStep(2)}>
        ← Back to snippets
      </Button>
    </div>
  );
}
