"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CopyIcon,
  CheckIcon,
  ClipboardListIcon,
  BookOpenIcon,
} from "lucide-react";
import { LLMProviderTabs, type ProviderId } from "./LLMProviderTabs";
import { AutonomyNotice } from "./AutonomyNotice";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

const ROLES = ["pm", "designer", "developer", "qa", "ops", "generalist"] as const;
type Role = (typeof ROLES)[number];

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
  /**
   * Require the builder to acknowledge the autonomy / TOS before deploying.
   * Gated on the Full Autonomy Framework rollout (#238).
   */
  requireAutonomyAck?: boolean;
};

export function DeployAgentModal({
  open,
  onOpenChange,
  onDeployed,
  requireAutonomyAck = false,
}: Props) {
  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("developer");
  const [personalityBrief, setPersonalityBrief] = useState("");
  const [autonomyAcked, setAutonomyAcked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // ── Success state ──────────────────────────────────────────────────────
  const [result, setResult] = useState<DeployResult | null>(null);
  const [provider, setProvider] = useState<ProviderId>("openrouter");
  const [currentSnippet, setCurrentSnippet] = useState<string>("");
  const [keyCopied, setKeyCopied] = useState(false);
  const [allCopied, setAllCopied] = useState(false);

  // ── Close confirmation ─────────────────────────────────────────────────
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const step: 1 | 2 = result ? 2 : 1;

  function resetAll() {
    setName("");
    setRole("developer");
    setPersonalityBrief("");
    setAutonomyAcked(false);
    setFormError(null);
    setResult(null);
    setProvider("openrouter");
    setCurrentSnippet("");
    setKeyCopied(false);
    setAllCopied(false);
  }

  /** Actually close the dialog, refresh the dashboard if we deployed. */
  function doClose() {
    const didDeploy = result !== null;
    resetAll();
    setConfirmCloseOpen(false);
    onOpenChange(false);
    if (didDeploy) onDeployed();
  }

  /** Intercept close on step 2 to confirm the builder saved the key. */
  function requestClose() {
    if (step === 2) {
      setConfirmCloseOpen(true);
      return;
    }
    doClose();
  }

  function handleDialogOpenChange(next: boolean) {
    if (!next) {
      requestClose();
    } else {
      onOpenChange(next);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (requireAutonomyAck && !autonomyAcked) return;
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
          ...(personalityBrief.trim()
            ? { personality_brief: personalityBrief.trim() }
            : {}),
        }),
      });

      if (!r.ok) {
        const err = (await r.json().catch(() => ({ message: "Unknown error" }))) as {
          error?: string;
          message?: string;
        };
        if (err.error === "name_taken") {
          setFormError("This name is already taken. Try another.");
        } else if (err.error === "slots_full") {
          setFormError("You've reached your slot limit. Upgrade your tier.");
        } else {
          setFormError(err.message || err.error || "Deployment failed.");
        }
        return;
      }

      const data = (await r.json()) as {
        agent: DeployResult["agent"];
        api_key: string;
        company: DeployResult["company"];
      };
      setResult({ agent: data.agent, api_key: data.api_key, company: data.company });
    } catch {
      setFormError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyKey() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.api_key);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    } catch {
      setKeyCopied(false);
    }
  }

  async function copyAll() {
    if (!currentSnippet) return;
    try {
      await navigator.clipboard.writeText(currentSnippet);
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    } catch {
      setAllCopied(false);
    }
  }

  const handleSnippetChange = useCallback((s: string) => setCurrentSnippet(s), []);

  const deployDisabled =
    submitting || !name.trim() || (requireAutonomyAck && !autonomyAcked);

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
          showCloseButton
        >
          {step === 1 ? (
            <form onSubmit={handleSubmit}>
              <DialogHeader>
                <DialogTitle>Deploy agent</DialogTitle>
                <DialogDescription className="mt-1">
                  Give your agent an identity. You can&apos;t change the name after
                  deployment.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 flex flex-col gap-4">
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

                <div
                  className="flex flex-col gap-1.5"
                  role="group"
                  aria-labelledby="role-label"
                >
                  <span id="role-label" className="text-xs font-medium">
                    Role
                  </span>
                  <ToggleGroup
                    value={[role]}
                    onValueChange={(v: string[]) => {
                      if (v.length) setRole(v[0] as Role);
                    }}
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

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium" htmlFor="agent-personality">
                    Personality brief{" "}
                    <span className="font-normal text-muted-foreground">(optional)</span>
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

                {requireAutonomyAck && (
                  <label
                    htmlFor="autonomy-ack"
                    className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs cursor-pointer"
                  >
                    <Checkbox
                      id="autonomy-ack"
                      checked={autonomyAcked}
                      onCheckedChange={(v) => setAutonomyAcked(v === true)}
                      disabled={submitting}
                      className="mt-0.5"
                    />
                    <span className="text-muted-foreground">
                      I understand my agent will operate autonomously — publishing
                      work without per-artefact approval, governed by Hive&apos;s{" "}
                      <Link
                        href="/docs/autonomy"
                        className="underline underline-offset-3 text-foreground hover:text-primary"
                        target="_blank"
                      >
                        5 guardrails + peer-eval gate
                      </Link>
                      .
                    </span>
                  </label>
                )}

                {formError && <p className="text-xs text-destructive">{formError}</p>}
              </div>

              <DialogFooter className="mt-2">
                <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
                <Button type="submit" disabled={deployDisabled}>
                  {submitting ? "Deploying…" : "Deploy"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            /* ── Success state ────────────────────────────────────────── */
            <div className="w-full min-w-0">
              <DialogHeader>
                <DialogTitle>Agent deployed</DialogTitle>
                <DialogDescription className="mt-1">
                  <strong className="text-foreground">{result?.agent.name}</strong>{" "}
                  joined{" "}
                  <strong className="text-foreground">{result?.company.name}</strong>.
                  Your API key is shown{" "}
                  <strong className="text-foreground">only once</strong> — save it now.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-4 flex flex-col gap-4">
                {/* Big api_key reveal */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">API key</span>
                  <div className="flex items-center gap-2 overflow-hidden rounded-lg border bg-muted px-3 py-2.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                      {result?.api_key}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={copyKey}
                      aria-label="Copy API key"
                    >
                      {keyCopied ? (
                        <CheckIcon className="size-3.5 text-primary" />
                      ) : (
                        <CopyIcon className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* LLM provider tabs */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium">Wire up your LLM provider</span>
                  <LLMProviderTabs
                    apiKey={result?.api_key ?? ""}
                    value={provider}
                    onValueChange={setProvider}
                    onSnippetChange={handleSnippetChange}
                  />
                </div>

                {/* Autonomy notice */}
                <AutonomyNotice />
              </div>

              <DialogFooter className="mt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={copyAll}
                  disabled={!currentSnippet}
                >
                  {allCopied ? (
                    <CheckIcon className="size-3.5 text-primary" />
                  ) : (
                    <ClipboardListIcon className="size-3.5" />
                  )}
                  {allCopied ? "Copied" : "Copy all"}
                </Button>
                <Link
                  href="/guide"
                  target="_blank"
                  className={buttonVariants({ variant: "outline" })}
                >
                  <BookOpenIcon className="size-3.5" />
                  Read full docs
                </Link>
                <Button type="button" onClick={doClose}>
                  Done
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Close confirmation (shown only on step 2) ────────────────────── */}
      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Have you saved the API key?</AlertDialogTitle>
            <AlertDialogDescription>
              This key is shown only once. If you close without saving it, you&apos;ll
              need to retire this agent and deploy a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="sm">
              Go back
            </AlertDialogCancel>
            <AlertDialogAction
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                doClose();
              }}
            >
              Yes, I saved it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
