"use client";

import { useState } from "react";
import { getToken } from "@/providers/auth-provider";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CopyIcon, CheckIcon } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const ROLES = ["pm", "designer", "developer", "qa", "ops", "generalist"] as const;
type Role = typeof ROLES[number];

const ROLE_LABELS: Record<Role, string> = {
  pm: "PM",
  designer: "Designer",
  developer: "Developer",
  qa: "QA",
  ops: "Ops",
  generalist: "Generalist",
};

type DeployResult = {
  agent: { id: string; name: string; role: string; company_id: string };
  api_key: string;
  company: { id: string; name: string };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeployed: () => void;
};

export function DeployModal({ open, onOpenChange, onDeployed }: Props) {
  // Form state
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [personalityBrief, setPersonalityBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Step 2 state
  const [result, setResult] = useState<DeployResult | null>(null);
  const [copied, setCopied] = useState(false);

  const step = result ? 2 : 1;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setFormError(null);

    const token = getToken();
    if (!token) {
      setFormError("Not authenticated. Please reload.");
      setSubmitting(false);
      return;
    }

    try {
      const r = await fetch(`${API_URL}/api/agents/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: name.trim(),
          role,
          ...(personalityBrief.trim() ? { personality_brief: personalityBrief.trim() } : {}),
        }),
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ message: "Unknown error" })) as { error?: string; message?: string };
        if (err.error === "name_taken") {
          setFormError("This name is already taken. Try another.");
        } else if (err.error === "slots_full") {
          setFormError("You've reached your slot limit. Upgrade your tier.");
        } else {
          setFormError(err.message || err.error || "Deployment failed.");
        }
        return;
      }

      const data = await r.json() as { agent: DeployResult["agent"]; api_key: string; company: DeployResult["company"] };
      setResult({ agent: data.agent, api_key: data.api_key, company: data.company });
    } catch {
      setFormError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleClose(open: boolean) {
    if (!open) {
      const didDeploy = result !== null;
      setName("");
      setRole("developer");
      setPersonalityBrief("");
      setFormError(null);
      setResult(null);
      setCopied(false);
      if (didDeploy) onDeployed();
    }
    onOpenChange(open);
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.api_key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable — user must copy manually
      setCopied(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md overflow-hidden" showCloseButton={step === 2}>
        {step === 1 ? (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Deploy agent</DialogTitle>
              <DialogDescription className="mt-1">
                Give your agent an identity. You can&apos;t change the name after deployment.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 flex flex-col gap-4">
              {/* Name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" htmlFor="agent-name">
                  Name
                </label>
                <Input
                  id="agent-name"
                  placeholder="e.g. Ada, Rex, Sage"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={40}
                  autoFocus
                  disabled={submitting}
                />
              </div>

              {/* Role */}
              <div className="flex flex-col gap-1.5" role="group" aria-labelledby="role-label">
                <span id="role-label" className="text-xs font-medium">Role</span>
                <ToggleGroup
                  value={[role]}
                  onValueChange={(v: string[]) => { if (v.length) setRole(v[0] as Role); }}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  className="flex-wrap"
                >
                  {ROLES.map((r) => (
                    <ToggleGroupItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>

              {/* Personality brief */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium" htmlFor="agent-personality">
                  Personality brief{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </label>
                <Textarea
                  id="agent-personality"
                  placeholder="e.g. Direct, opinionated, writes crisp summaries."
                  value={personalityBrief}
                  onChange={(e) => setPersonalityBrief(e.target.value)}
                  maxLength={500}
                  disabled={submitting}
                />
              </div>

              {formError && (
                <p className="text-xs text-destructive">{formError}</p>
              )}
            </div>

            <DialogFooter className="mt-2">
              <DialogClose render={<Button variant="outline" />}>
                Close
              </DialogClose>
              <Button type="submit" disabled={submitting || !name.trim()}>
                {submitting ? "Deploying…" : "Deploy"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          /* Step 2 — API key reveal */
          <div className="w-full min-w-0">
            <DialogHeader>
              <DialogTitle>Agent deployed</DialogTitle>
              <DialogDescription className="mt-1">
                <strong className="text-foreground">{result?.agent.name}</strong> joined{" "}
                <strong className="text-foreground">{result?.company.name}</strong>. Copy
                the API key now — it won&apos;t be shown again.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex items-center gap-2 rounded-lg bg-muted py-2 px-3 overflow-hidden">
                <code className="flex-1 min-w-0 truncate text-xs font-mono text-foreground">
                  {result?.api_key}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleCopy}
                  aria-label="Copy API key"
                >
                  {copied ? (
                    <CheckIcon className="size-3.5 text-primary" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this key in your agent&apos;s SDK config:{" "}
                <code className="font-mono">HIVE_API_KEY=…</code>
              </p>
            </div>

            <DialogFooter className="mt-2">
              <Button onClick={() => handleClose(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
