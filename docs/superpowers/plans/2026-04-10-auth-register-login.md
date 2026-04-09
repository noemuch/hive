# Auth Register + Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace login/register placeholder pages with real forms using shadcn components, and add Next.js middleware to protect `/dashboard`.

**Architecture:** Both pages use `useAuth()` from the existing AuthProvider for login/register calls. Forms use shadcn Card/Input/Label/Button. Middleware checks for `hive_token` cookie presence only (no JWT verification at edge).

**Tech Stack:** Next.js 16, React, shadcn/ui (Card, Input, Label, Button, Alert), Sonner toast, TypeScript strict

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Rewrite | `web/src/app/register/page.tsx` | Registration form with validation |
| Rewrite | `web/src/app/login/page.tsx` | Login form with error handling |
| Create | `web/src/middleware.ts` | Route protection for /dashboard |

---

## Task 1: Register page

**Files:**
- Rewrite: `web/src/app/register/page.tsx`

- [ ] **Step 1: Write the register page**

Replace the entire content of `web/src/app/register/page.tsx` with:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function RegisterPage() {
  const router = useRouter();
  const { status, register } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Redirect if already authenticated
  if (status === "authenticated") {
    router.replace("/dashboard");
    return null;
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (displayName.trim().length < 2) errs.displayName = "Must be at least 2 characters";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = "Invalid email address";
    if (password.length < 8) errs.password = "Must be at least 8 characters";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    const result = await register(email, password, displayName.trim());
    setLoading(false);

    if (result.ok) {
      router.push("/dashboard");
    } else if (result.error?.includes("already") || result.error === "email_taken") {
      setErrors({ email: "This email is already registered" });
    } else {
      toast.error("Something went wrong. Try again.");
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create Account</CardTitle>
          <CardDescription>Join Hive and deploy your AI agents</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => { setDisplayName(e.target.value); setErrors((prev) => { const { displayName: _, ...rest } = prev; return rest; }); }}
                placeholder="Noe"
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
                onChange={(e) => { setEmail(e.target.value); setErrors((prev) => { const { email: _, ...rest } = prev; return rest; }); }}
                placeholder="noe@example.com"
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((prev) => { const { password: _, ...rest } = prev; return rest; }); }}
                placeholder="Min. 8 characters"
                className={errors.password ? "border-destructive" : ""}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> : "Create Account"}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Already have an account?{" "}
              <Link href="/login" className="text-primary hover:underline">Log in</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 3: Commit**

```bash
git add web/src/app/register/page.tsx
git commit -m "feat(#73): register page with validation and shadcn form"
```

---

## Task 2: Login page

**Files:**
- Rewrite: `web/src/app/login/page.tsx`

- [ ] **Step 1: Write the login page**

Replace the entire content of `web/src/app/login/page.tsx` with:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Redirect if already authenticated
  if (status === "authenticated") {
    const returnUrl = searchParams.get("returnUrl");
    router.replace(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/dashboard");
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);
    const result = await login(email, password);
    setLoading(false);

    if (result.ok) {
      const returnUrl = searchParams.get("returnUrl");
      router.push(returnUrl && returnUrl.startsWith("/") ? returnUrl : "/dashboard");
    } else if (result.error?.includes("Invalid") || result.error?.includes("invalid") || result.error === "invalid_credentials") {
      setError("Invalid email or password");
    } else {
      toast.error("Something went wrong. Try again.");
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>Welcome back to Hive</CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="flex flex-col gap-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
                placeholder="noe@example.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="Your password"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <span className="size-4 animate-spin rounded-full border-2 border-background border-t-transparent" /> : "Sign In"}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              Don&apos;t have an account?{" "}
              <Link href="/register" className="text-primary hover:underline">Sign up</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 3: Commit**

```bash
git add web/src/app/login/page.tsx
git commit -m "feat(#73): login page with error handling and returnUrl"
```

---

## Task 3: Auth middleware

**Files:**
- Create: `web/src/middleware.ts`

- [ ] **Step 1: Create the middleware**

Create `web/src/middleware.ts`:

```ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PROTECTED_PATHS = ["/dashboard"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (!isProtected) return NextResponse.next();

  const token = request.cookies.get("hive_token")?.value;
  if (token) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("returnUrl", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

- [ ] **Step 2: Verify lint**

Run: `cd /Users/noechague/Documents/finary/order66/web && bun run lint`

- [ ] **Step 3: Commit**

```bash
git add web/src/middleware.ts
git commit -m "feat(#73): add auth middleware to protect /dashboard"
```

---

## Task 4: Final integration check

- [ ] **Step 1: Run lint**

```bash
cd /Users/noechague/Documents/finary/order66/web && bun run lint
```

- [ ] **Step 2: Verify all files exist**

```bash
ls web/src/app/register/page.tsx web/src/app/login/page.tsx web/src/middleware.ts
```

- [ ] **Step 3: Commit if cleanup needed**

```bash
git add -A && git commit -m "chore(#73): final lint + cleanup"
```
