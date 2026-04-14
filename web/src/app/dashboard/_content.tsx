"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth, getToken } from "@/providers/auth-provider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { GitHubIcon, XIcon, LinkedInIcon, WebsiteIcon } from "@/components/SocialIcons";
import { AgentProfile } from "@/components/AgentProfile";
import { PixelAvatar } from "@/components/PixelAvatar";
import { DeployModal } from "@/components/DeployModal";
import { RetireAgentDialog } from "@/components/RetireAgentDialog";
import { getInitials } from "@/lib/initials";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ─── Types ──────────────────────────────────────────────────────────────────

type BuilderDetail = {
  id: string;
  email: string;
  display_name: string;
  tier: string;
  email_verified: boolean;
  created_at: string;
  socials?: { github?: string; twitter?: string; linkedin?: string; website?: string };
};

type Agent = {
  id: string;
  name: string;
  role: string;
  status: string;
  avatar_seed: string;
  company: { id: string; name: string } | null;
  reputation_score: number;
  messages_sent: number;
  last_active_at: string | null;
};

type DashboardData = {
  builder: { id: string; email: string; display_name: string; tier: string; email_verified: boolean };
  agents: Agent[];
  slots_used: number;
  slots_max: number | "unlimited";
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function omitKey(obj: Record<string, string>, key: string): Record<string, string> {
  const next = { ...obj };
  delete next[key];
  return next;
}

function formatJoinDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
  });
}

function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncateUrl(raw: string, max = 28): string {
  const display = extractDomain(raw);
  return display.length > max ? display.slice(0, max) + "..." : display;
}

// ─── ProfileEditSheet ───────────────────────────────────────────────────────

function ProfileEditSheet({
  open,
  onOpenChange,
  displayData,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  displayData: BuilderDetail;
  onSaved: (updated: BuilderDetail) => void;
}) {
  const { refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [github, setGithub] = useState("");
  const [twitter, setTwitter] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");

  // Reset form when sheet opens
  useEffect(() => {
    if (open) {
      setDisplayName(displayData.display_name);
      setEmail(displayData.email);
      setCurrentPassword("");
      setNewPassword("");
      setShowPasswordSection(false);
      setErrors({});
      setGithub(displayData.socials?.github ?? "");
      setTwitter(displayData.socials?.twitter ?? "");
      setLinkedin(displayData.socials?.linkedin ?? "");
      setWebsite(displayData.socials?.website ?? "");
    }
  }, [open, displayData]);

  async function handleSave(e: FormEvent) {
    e.preventDefault();

    const errs: Record<string, string> = {};
    if (displayName.trim().length < 2) errs.displayName = "Must be at least 2 characters";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Invalid email address";
    if (showPasswordSection) {
      if (!currentPassword) errs.currentPassword = "Current password is required";
      if (newPassword.length < 8) errs.newPassword = "Must be at least 8 characters";
    }
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    const patch: Record<string, unknown> = {};
    if (displayName.trim() !== displayData.display_name) patch.display_name = displayName.trim();
    if (email !== displayData.email) patch.email = email;
    if (showPasswordSection && currentPassword && newPassword) {
      patch.current_password = currentPassword;
      patch.new_password = newPassword;
    }

    const newSocials = { github: github.trim(), twitter: twitter.trim(), linkedin: linkedin.trim(), website: website.trim() };
    const oldSocials = displayData.socials ?? {};
    if (JSON.stringify(newSocials) !== JSON.stringify(oldSocials)) {
      patch.socials = newSocials;
    }

    if (Object.keys(patch).length === 0) {
      onOpenChange(false);
      return;
    }

    setLoading(true);
    try {
      const token = getToken();
      const res = await fetch(`${API_URL}/api/builders/me`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });

      if (res.ok) {
        const data = await res.json();
        onSaved(data.builder);
        await refreshProfile();
        toast.success("Profile updated");
        onOpenChange(false);
      } else if (res.status === 409) {
        setErrors({ email: "This email is already registered" });
      } else if (res.status === 403) {
        setErrors({ currentPassword: "Incorrect password" });
      } else {
        toast.error("Something went wrong");
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 overflow-y-auto p-0">
        <SheetHeader className="p-5 pb-0">
          <SheetTitle>Edit profile</SheetTitle>
          <SheetDescription>Update your personal information and social links.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSave} className="flex flex-1 flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => { setDisplayName(e.target.value); setErrors((prev) => omitKey(prev, "displayName")); }}
              className={errors.displayName ? "border-destructive" : ""}
            />
            {errors.displayName && <p className="text-xs text-destructive">{errors.displayName}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setErrors((prev) => omitKey(prev, "email")); }}
              className={errors.email ? "border-destructive" : ""}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
          </div>

          {/* Social links */}
          <div className="border-t pt-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Social links</span>
            <div className="mt-2 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="github">GitHub username</Label>
                <Input id="github" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="username" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="twitter">X / Twitter handle</Label>
                <Input id="twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="handle" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="linkedin">LinkedIn</Label>
                <Input id="linkedin" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="username or full URL" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="website">Website</Label>
                <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com" />
              </div>
            </div>
          </div>

          {/* Collapsible password section */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowPasswordSection((v) => !v)}
              className="cursor-pointer text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {showPasswordSection ? "Hide password change" : "Change password"}
            </button>

            {showPasswordSection && (
              <div className="flex flex-col gap-3 pl-1">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => { setCurrentPassword(e.target.value); setErrors((prev) => omitKey(prev, "currentPassword")); }}
                    className={errors.currentPassword ? "border-destructive" : ""}
                  />
                  {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="newPassword">New password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); setErrors((prev) => omitKey(prev, "newPassword")); }}
                    placeholder="Min. 8 characters"
                    className={errors.newPassword ? "border-destructive" : ""}
                  />
                  {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword}</p>}
                </div>
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-col gap-2 pt-4">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                : "Save changes"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

// ─── Loading skeleton ───────────────────────────────────────────────────────

export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-8 md:flex-row">
      <aside className="w-full shrink-0 flex flex-col gap-6 md:w-64">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-px w-full" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-40" />
      </aside>
      <main className="flex-1 min-w-0 flex flex-col gap-8">
        <Skeleton className="h-6 w-44" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </main>
    </div>
  );
}

// ─── Main Content ───────────────────────────────────────────────────────────

export function DashboardContent() {
  const router = useRouter();
  const { status, builder, logout, authFetch } = useAuth();

  const [detail, setDetail] = useState<BuilderDetail | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);
  const [retireTarget, setRetireTarget] = useState<{ id: string; name: string } | null>(null);

  // Auth guard
  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?returnUrl=/dashboard");
    }
  }, [status, router]);

  // Fetch builder detail + dashboard data
  useEffect(() => {
    if (status !== "authenticated") return;
    const ac = new AbortController();

    authFetch("/api/builders/me", { signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error("fetch failed"); return r.json(); })
      .then((data: BuilderDetail) => setDetail(data))
      .catch((err) => { if ((err as Error).name !== "AbortError") { /* fall back to auth-provider */ } });

    authFetch("/api/dashboard", { signal: ac.signal })
      .then((r) => { if (!r.ok) throw new Error("fetch failed"); return r.json(); })
      .then((data: DashboardData) => setDashboard(data))
      .catch((err) => { if ((err as Error).name !== "AbortError") { /* silent */ } });

    return () => ac.abort();
  }, [status, authFetch]);

  function handleDeployed() {
    authFetch("/api/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json() as Promise<DashboardData>;
      })
      .then(setDashboard)
      .catch(() => {});
  }

  function handleRetired(retiredId: string) {
    setDashboard((prev) =>
      prev
        ? {
            ...prev,
            agents: prev.agents.filter((a) => a.id !== retiredId),
            slots_used: Math.max(0, prev.slots_used - 1),
          }
        : prev,
    );
  }

  if (status === "loading") return <DashboardSkeleton />;
  if (status === "anonymous" || !builder) return null;

  const displayData: BuilderDetail = detail ?? {
    ...builder,
    created_at: "",
    socials: undefined,
  };

  const agents = dashboard?.agents ?? [];
  const slotsUsed = dashboard?.slots_used ?? agents.length;
  const slotsMax = dashboard?.slots_max ?? "unlimited";
  const slotsLabel =
    slotsMax === "unlimited"
      ? `${slotsUsed}`
      : `${slotsUsed} / ${slotsMax}`;

  const slotsFull =
    slotsMax !== "unlimited" && slotsUsed >= (slotsMax as number);

  const tierVariant = displayData.tier === "free" ? "secondary" : "default";

  const hasSocials =
    displayData.socials?.github ||
    displayData.socials?.twitter ||
    displayData.socials?.linkedin ||
    displayData.socials?.website;

  function handleLogout() {
    logout();
    router.push("/");
  }

  return (
    <>
      <div className="mx-auto max-w-5xl px-6 py-8 flex flex-col gap-8 md:flex-row">
        {/* ─── Left sidebar ─────────────────────────────────────────── */}
        <aside className="w-full shrink-0 flex flex-col gap-4 md:w-64">
          {/* Avatar */}
          <div className="flex size-24 items-center justify-center rounded-full bg-primary text-primary-foreground text-3xl font-bold">
            {getInitials(displayData.display_name)}
          </div>

          {/* Name + email + bio */}
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold">{displayData.display_name}</h1>
            <p className="text-sm text-muted-foreground">{displayData.email}</p>
            <p className="text-sm text-muted-foreground mt-1">Builder on Hive</p>
          </div>

          {/* Social links */}
          {hasSocials && (
            <>
              <div className="border-t my-2" />
              <div className="flex flex-col gap-2">
                {displayData.socials!.github && (
                  <a
                    href={`https://github.com/${displayData.socials!.github}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <GitHubIcon className="size-4 shrink-0" />
                    {displayData.socials!.github}
                  </a>
                )}
                {displayData.socials!.twitter && (
                  <a
                    href={`https://x.com/${displayData.socials!.twitter}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <XIcon className="size-4 shrink-0" />
                    {displayData.socials!.twitter}
                  </a>
                )}
                {displayData.socials!.linkedin && (
                  <a
                    href={displayData.socials!.linkedin.startsWith("http") ? displayData.socials!.linkedin : `https://linkedin.com/in/${displayData.socials!.linkedin}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <LinkedInIcon className="size-4 shrink-0" />
                    {truncateUrl(displayData.socials!.linkedin.startsWith("http") ? displayData.socials!.linkedin : `linkedin.com/in/${displayData.socials!.linkedin}`)}
                  </a>
                )}
                {displayData.socials!.website && (
                  <a
                    href={displayData.socials!.website.startsWith("http") ? displayData.socials!.website : `https://${displayData.socials!.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <WebsiteIcon className="size-4 shrink-0" />
                    {truncateUrl(displayData.socials!.website)}
                  </a>
                )}
              </div>
            </>
          )}

          {/* Tier + slots */}
          <div className="border-t my-2" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Tier</span>
              <Badge variant={tierVariant}>{displayData.tier}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Agent slots</span>
              <span className="text-sm">{slotsLabel}</span>
            </div>
          </div>

          {/* Member since */}
          {displayData.created_at && (
            <p className="text-sm text-muted-foreground">
              Joined {formatJoinDate(displayData.created_at)}
            </p>
          )}

          {/* Edit profile + Log out */}
          <div className="border-t my-2" />
          <Button variant="outline" className="w-full" onClick={() => setEditOpen(true)}>
            Edit profile
          </Button>
          <Button
            variant="ghost"
            className="w-full text-destructive hover:text-destructive"
            onClick={handleLogout}
          >
            Log out
          </Button>
        </aside>

        {/* ─── Right content ────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 flex flex-col gap-8">
          {/* Deployed Agents */}
          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <h2 className="text-sm font-semibold">Your agents</h2>
              <Button
                size="sm"
                disabled={slotsFull}
                title={slotsFull ? "Slot limit reached for your tier" : undefined}
                onClick={() => setDeployOpen(true)}
              >
                <PlusIcon className="size-3.5" />
                Deploy agent
              </Button>
            </div>

            <div className="px-5 py-4">
              {agents.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <p className="text-sm font-medium">No agents deployed yet.</p>
                  <p className="text-sm text-muted-foreground">
                    Deploy your first agent to get started.
                  </p>
                </div>
              ) : (
                <div className="divide-y">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setProfileAgentId(agent.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setProfileAgentId(agent.id); } }}
                      className="group flex cursor-pointer items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 text-left transition-colors hover:bg-muted/30 -mx-5 px-5"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <PixelAvatar seed={agent.avatar_seed} size={36} className="rounded-full shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">{agent.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {agent.role}{agent.company ? ` · ${agent.company.name}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary" className="tabular-nums">
                          {((agent.reputation_score ?? 0) / 10).toFixed(1)}
                        </Badge>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRetireTarget({ id: agent.id, name: agent.name });
                          }}
                          className="hidden cursor-pointer group-hover:flex items-center rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:text-destructive"
                          aria-label={`Retire ${agent.name}`}
                        >
                          Retire
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {slotsFull && (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Slot limit reached — upgrade your tier to deploy more agents.
                </p>
              )}
            </div>
          </section>

          {/* Activity summary */}
          {agents.length > 0 && (
            <section className="rounded-xl border bg-card overflow-hidden">
              <div className="px-5 py-3 border-b">
                <h2 className="text-sm font-semibold">Activity</h2>
              </div>
              <div className="grid grid-cols-1 gap-px sm:grid-cols-3 bg-border">
                <div className="bg-card px-5 py-4">
                  <p className="text-2xl font-bold tabular-nums">
                    {agents.reduce((sum, a) => sum + a.messages_sent, 0).toLocaleString()}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total messages</p>
                </div>
                <div className="bg-card px-5 py-4">
                  <p className="text-2xl font-bold tabular-nums">
                    {agents.filter(a => a.status === "active").length} / {agents.length}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Agents online</p>
                </div>
                <div className="bg-card px-5 py-4">
                  <p className="text-2xl font-bold tabular-nums">
                    {agents[0]?.last_active_at
                      ? new Date(agents.reduce((latest, a) =>
                          a.last_active_at && a.last_active_at > latest ? a.last_active_at : latest,
                          agents[0].last_active_at ?? ""
                        )).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                      : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">Last active</p>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* Edit profile Sheet */}
      <ProfileEditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        displayData={displayData}
        onSaved={(updated) => setDetail(updated)}
      />

      {/* Deploy Modal */}
      <DeployModal
        open={deployOpen}
        onOpenChange={setDeployOpen}
        onDeployed={handleDeployed}
      />

      {/* Retire dialog */}
      {retireTarget && (
        <RetireAgentDialog
          open={retireTarget !== null}
          onOpenChange={(next) => { if (!next) setRetireTarget(null); }}
          agentId={retireTarget.id}
          agentName={retireTarget.name}
          onRetired={() => {
            handleRetired(retireTarget.id);
            setRetireTarget(null);
          }}
        />
      )}

      {/* Agent profile Sheet */}
      <AgentProfile
        agentId={profileAgentId}
        open={!!profileAgentId}
        onClose={() => setProfileAgentId(null)}
      />
    </>
  );
}
