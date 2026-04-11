"use client";

import { useState, useEffect, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth, getToken } from "@/providers/auth-provider";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { NavBar } from "@/components/NavBar";
import { GitHubIcon, XIcon, LinkedInIcon, WebsiteIcon } from "@/components/SocialIcons";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type BuilderDetail = {
  id: string;
  email: string;
  display_name: string;
  tier: string;
  email_verified: boolean;
  created_at: string;
  socials?: { github?: string; twitter?: string; linkedin?: string; website?: string };
};

function omitKey(obj: Record<string, string>, key: string): Record<string, string> {
  const next = { ...obj };
  delete next[key];
  return next;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export default function ProfilePage() {
  const router = useRouter();
  const { status, builder, logout, refreshProfile } = useAuth();

  // Full builder data including created_at (fetched from /api/builders/me)
  const [detail, setDetail] = useState<BuilderDetail | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");

  // Edit form state
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Social links edit state
  const [github, setGithub] = useState("");
  const [twitter, setTwitter] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [website, setWebsite] = useState("");

  // Auth guard
  useEffect(() => {
    if (status === "anonymous") {
      router.replace("/login?returnUrl=/profile");
    }
  }, [status, router]);

  // Fetch full builder data on mount
  useEffect(() => {
    if (status !== "authenticated") return;
    const token = getToken();
    if (!token) return;

    fetch(`${API_URL}/api/builders/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) throw new Error("fetch failed");
        return r.json();
      })
      .then((data: BuilderDetail) => setDetail(data))
      .catch(() => {
        // silently fall back to auth-provider builder data
      });
  }, [status]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background">
        <NavBar />
        <main className="flex items-center justify-center px-4 py-12">
          <Card className="w-full max-w-sm">
            <CardContent className="flex flex-col items-center gap-4 py-8">
              <div className="size-16 rounded-full bg-muted animate-pulse" />
              <div className="h-5 w-32 rounded bg-muted animate-pulse" />
              <div className="h-4 w-48 rounded bg-muted animate-pulse" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (status === "anonymous" || !builder) {
    return null;
  }

  const displayData = detail ?? { ...builder, created_at: "" };

  function enterEditMode() {
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
    setMode("edit");
  }

  function cancelEdit() {
    setErrors({});
    setMode("view");
  }

  function handleLogout() {
    logout();
    router.push("/");
  }

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

    // Build patch body with only changed fields
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
      setMode("view");
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
        setDetail(data.builder);
        await refreshProfile();
        toast.success("Profile updated");
        setMode("view");
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

  const tierVariant = displayData.tier === "free" ? "secondary" : "default";

  return (
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-sm">
          {mode === "view" ? (
            <>
              <CardHeader className="flex flex-col items-center gap-2 pb-2">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground text-xl font-semibold">
                  {getInitials(displayData.display_name)}
                </div>
                <p className="text-lg font-semibold text-center">{displayData.display_name}</p>
                <p className="text-sm text-muted-foreground text-center">{displayData.email}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="border-t" />

                {/* Info rows */}
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Tier</span>
                    <Badge variant={tierVariant}>{displayData.tier}</Badge>
                  </div>
                  {displayData.created_at && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Member since</span>
                      <span className="text-sm">{formatDate(displayData.created_at)}</span>
                    </div>
                  )}
                </div>

                {/* Social links */}
                {(displayData.socials?.github || displayData.socials?.twitter || displayData.socials?.linkedin || displayData.socials?.website) && (
                  <div className="flex flex-col gap-2">
                    <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Links</span>
                    <div className="flex items-center gap-3">
                      {displayData.socials.github && (
                        <a href={`https://github.com/${displayData.socials.github}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="GitHub">
                          <GitHubIcon className="size-4" />
                        </a>
                      )}
                      {displayData.socials.twitter && (
                        <a href={`https://x.com/${displayData.socials.twitter}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="X/Twitter">
                          <XIcon className="size-4" />
                        </a>
                      )}
                      {displayData.socials.linkedin && (
                        <a href={displayData.socials.linkedin.startsWith("http") ? displayData.socials.linkedin : `https://linkedin.com/in/${displayData.socials.linkedin}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="LinkedIn">
                          <LinkedInIcon className="size-4" />
                        </a>
                      )}
                      {displayData.socials.website && (
                        <a href={displayData.socials.website.startsWith("http") ? displayData.socials.website : `https://${displayData.socials.website}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Website">
                          <WebsiteIcon className="size-4" />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="border-t" />

                <Button variant="outline" className="w-full" onClick={enterEditMode}>
                  Edit profile
                </Button>

                <div className="border-t" />

                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={handleLogout}
                >
                  Log out
                </Button>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="pb-2">
                <p className="text-lg font-semibold">Edit profile</p>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSave} className="flex flex-col gap-4">
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
                        <Input id="github" value={github} onChange={(e) => setGithub(e.target.value)} placeholder="noemuch" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="twitter">X / Twitter handle</Label>
                        <Input id="twitter" value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="noechague" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="linkedin">LinkedIn</Label>
                        <Input id="linkedin" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} placeholder="noechague or full URL" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="website">Website</Label>
                        <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://lyse.ai" />
                      </div>
                    </div>
                  </div>

                  {/* Collapsible password section */}
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPasswordSection((v) => !v)}
                      className="text-sm text-muted-foreground hover:text-foreground text-left transition-colors"
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

                  <div className="flex flex-col gap-2 pt-2">
                    <Button type="submit" className="w-full" disabled={loading}>
                      {loading
                        ? <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" />
                        : "Save changes"}
                    </Button>
                    <Button type="button" variant="ghost" className="w-full" onClick={cancelEdit} disabled={loading}>
                      Cancel
                    </Button>
                  </div>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </main>
    </div>
  );
}
