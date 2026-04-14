# Hero Dot Canvas + Office View Multi-Company — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a HeroDotCanvas hero section above the company grid on `/`, and enhance the `/company/[id]` page with a header bar, loading/404 states, and agent click → profile slide-over.

**Architecture:** HeroDotCanvas is a standalone Canvas 2D component receiving `companies[]` as props from HomeContent. The office view page gets a header bar component, loading/error states, and wires AgentProfile sheet via URL query param `?agent=:id`. GameView gets minimal changes — just an `onAgentClick` callback prop.

**Tech Stack:** Next.js 16, React, Canvas 2D API, shadcn/ui (Badge, Button, Skeleton, Sheet), PixiJS 8 (existing), TypeScript strict

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `web/src/components/HeroDotCanvas.tsx` | Canvas 2D hero with company dots, animations, interactions |
| Create | `web/src/components/OfficeHeader.tsx` | Top bar for office view (back, name, status, stats) |
| Modify | `web/src/components/HomeContent.tsx` | Import and render HeroDotCanvas above grid, pass companies up from CompanyGrid |
| Modify | `web/src/components/CompanyGrid.tsx` | Expose `rawCompanies` via callback so HomeContent can pass to HeroDotCanvas |
| Modify | `web/src/app/company/[id]/page.tsx` | Add fetch, loading/404, OfficeHeader, AgentProfile wiring |
| Modify | `web/src/components/GameView.tsx` | Add `onAgentClick` callback prop, wire click on agent sprites |
| Modify | `web/src/canvas/agents.ts` | Add click handler on agent sprites, expose via callback |

---

## Task 1: Lift companies data from CompanyGrid to HomeContent

**Files:**
- Modify: `web/src/components/CompanyGrid.tsx`
- Modify: `web/src/components/HomeContent.tsx`

- [ ] **Step 1: Add `onCompaniesLoaded` callback prop to CompanyGrid**

In `web/src/components/CompanyGrid.tsx`, add a new optional prop and call it when `rawCompanies` changes:

```tsx
// Add to props type
export function CompanyGrid({
  search,
  sort,
  filter,
  onClearFilters,
  onCompaniesLoaded,
}: {
  search: string;
  sort: string;
  filter: string;
  onClearFilters?: () => void;
  onCompaniesLoaded?: (companies: Company[]) => void;
}) {
```

Add a `useEffect` after the `rawCompanies` state:

```tsx
useEffect(() => {
  onCompaniesLoaded?.(rawCompanies);
}, [rawCompanies, onCompaniesLoaded]);
```

- [ ] **Step 2: Wire in HomeContent**

In `web/src/components/HomeContent.tsx`, add state and pass callback:

```tsx
import { type Company } from "@/components/CompanyCard";

// Inside HomeContent:
const [companies, setCompanies] = useState<Company[]>([]);

// In JSX, add onCompaniesLoaded to CompanyGrid:
<CompanyGrid
  search={debouncedSearch}
  sort={sort}
  filter={filter}
  onClearFilters={handleClearFilters}
  onCompaniesLoaded={setCompanies}
/>
```

- [ ] **Step 3: Verify the app builds**

Run: `cd web && bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/components/CompanyGrid.tsx web/src/components/HomeContent.tsx
git commit -m "feat(#71): lift companies data from CompanyGrid to HomeContent"
```

---

## Task 2: Create HeroDotCanvas component

**Files:**
- Create: `web/src/components/HeroDotCanvas.tsx`

- [ ] **Step 1: Create the component with Canvas 2D rendering**

Create `web/src/components/HeroDotCanvas.tsx`:

```tsx
"use client";

import { useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { type Company } from "@/components/CompanyCard";

const STATUS_COLORS: Record<string, string> = {
  active: "#33CC66",
  forming: "#E89B1C",
  dissolved: "#686E82",
  struggling: "#686E82",
};

const MIN_RADIUS = 16;
const MAX_RADIUS = 48;
const CANVAS_HEIGHT = 200;
const LABEL_FONT = '11px Inter, system-ui, sans-serif';
const LABEL_GAP = 8;
const PULSE_DURATION = 2000;
const FADE_DURATION = 500;

type CircleData = {
  x: number;
  y: number;
  radius: number;
  color: string;
  name: string;
  companyId: string;
  pulses: boolean;
};

function computeCircles(companies: Company[], width: number): CircleData[] {
  if (companies.length === 0 || width === 0) return [];

  const circles: CircleData[] = companies.map((c) => {
    const radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, 12 + c.agent_count * 4));
    return {
      x: 0,
      y: CANVAS_HEIGHT / 2 - LABEL_GAP,
      radius,
      color: STATUS_COLORS[c.status] || STATUS_COLORS.dissolved,
      name: c.name,
      companyId: c.id,
      pulses: c.messages_today > 0,
    };
  });

  // Horizontal layout: evenly spaced, centered
  const totalWidth = circles.reduce((sum, c) => sum + c.radius * 2, 0);
  const gap = Math.max(24, (width - totalWidth) / (circles.length + 1));
  let cursor = gap;
  for (const circle of circles) {
    circle.x = cursor + circle.radius;
    cursor += circle.radius * 2 + gap;
  }

  return circles;
}

function hitTest(circles: CircleData[], mx: number, my: number): CircleData | null {
  for (let i = circles.length - 1; i >= 0; i--) {
    const c = circles[i];
    const dx = mx - c.x;
    const dy = my - c.y;
    if (dx * dx + dy * dy <= c.radius * c.radius) return c;
  }
  return null;
}

export function HeroDotCanvas({ companies }: { companies: Company[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const circlesRef = useRef<CircleData[]>([]);
  const hoveredRef = useRef<string | null>(null);
  const startTimeRef = useRef(performance.now());
  const opacityRef = useRef(0);
  const rafRef = useRef<number>(0);
  const router = useRouter();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    const now = performance.now();
    const elapsed = now - startTimeRef.current;

    // Fade in
    opacityRef.current = Math.min(1, elapsed / FADE_DURATION);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.globalAlpha = opacityRef.current;

    const circles = circlesRef.current;
    const hovered = hoveredRef.current;

    for (const c of circles) {
      ctx.save();

      // Pulse animation
      let scale = 1;
      if (c.pulses) {
        const phase = ((now % PULSE_DURATION) / PULSE_DURATION) * Math.PI * 2;
        scale = 1 + 0.05 * (0.5 + 0.5 * Math.sin(phase));
      }

      // Glow on hover
      if (hovered === c.companyId) {
        ctx.shadowColor = c.color;
        ctx.shadowBlur = 16;
      }

      // Circle
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.radius * scale, 0, Math.PI * 2);
      ctx.fillStyle = c.color;
      ctx.fill();
      ctx.restore();

      // Label
      ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      ctx.font = LABEL_FONT;
      ctx.textAlign = "center";
      ctx.fillText(c.name, c.x, c.y + c.radius + LABEL_GAP + 11);
    }

    ctx.restore();
    rafRef.current = requestAnimationFrame(draw);
  }, []);

  // Resize + recompute circles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const parent = canvas.parentElement!;
    const observer = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = CANVAS_HEIGHT * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${CANVAS_HEIGHT}px`;
      circlesRef.current = computeCircles(companies, rect.width);
    });
    observer.observe(parent);

    return () => observer.disconnect();
  }, [companies]);

  // Animation loop
  useEffect(() => {
    startTimeRef.current = performance.now();
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // Mouse interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getMousePos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onMove = (e: MouseEvent) => {
      const pos = getMousePos(e);
      const hit = hitTest(circlesRef.current, pos.x, pos.y);
      hoveredRef.current = hit?.companyId ?? null;
      canvas.style.cursor = hit ? "pointer" : "default";
    };

    const onClick = (e: MouseEvent) => {
      const pos = getMousePos(e);
      const hit = hitTest(circlesRef.current, pos.x, pos.y);
      if (hit) router.push(`/company/${hit.companyId}`);
    };

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("click", onClick);
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("click", onClick);
    };
  }, [router]);

  return (
    <div className="w-full mb-6">
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: CANVAS_HEIGHT }}
        aria-label="Company activity map"
        role="img"
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire HeroDotCanvas into HomeContent**

In `web/src/components/HomeContent.tsx`, add import and render above the grid controls:

```tsx
import { HeroDotCanvas } from "@/components/HeroDotCanvas";

// In JSX, after the h1/p block and before GridControls:
{companies.length > 0 && <HeroDotCanvas companies={companies} />}
```

- [ ] **Step 3: Verify the app builds**

Run: `cd web && bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/components/HeroDotCanvas.tsx web/src/components/HomeContent.tsx
git commit -m "feat(#71): add HeroDotCanvas hero section above company grid"
```

---

## Task 3: Create OfficeHeader component

**Files:**
- Create: `web/src/components/OfficeHeader.tsx`

- [ ] **Step 1: Create the header bar component**

Create `web/src/components/OfficeHeader.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Users, MessageSquare } from "lucide-react";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  forming: "secondary",
  dissolved: "outline",
};

export function OfficeHeader({
  companyName,
  status,
  agentCount,
  messagesToday,
}: {
  companyName: string;
  status: string;
  agentCount: number;
  messagesToday: number;
}) {
  return (
    <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 py-2 bg-background/80 backdrop-blur-sm border-b border-foreground/10">
      <Button variant="ghost" size="icon" asChild className="shrink-0">
        <Link href="/" aria-label="Back to grid">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>

      <h1 className="text-sm font-semibold truncate">{companyName}</h1>

      <Badge variant={STATUS_VARIANT[status] || "outline"} className="shrink-0">
        {status}
      </Badge>

      <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="size-3" />
          {agentCount}
        </span>
        <span className="flex items-center gap-1">
          <MessageSquare className="size-3" />
          {messagesToday}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd web && bun run lint`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/components/OfficeHeader.tsx
git commit -m "feat(#71): add OfficeHeader component for office view"
```

---

## Task 4: Add agent click handler to GameView + canvas

**Files:**
- Modify: `web/src/components/GameView.tsx`
- Modify: `web/src/canvas/agents.ts`

- [ ] **Step 1: Add click callbacks to agent sprites in agents.ts**

In `web/src/canvas/agents.ts`, the agent sprites need to be interactive. Add a module-level click handler and expose a setter:

```ts
// At module level, after existing imports/constants:
let onAgentClickCallback: ((agentId: string) => void) | null = null;

export function setOnAgentClick(cb: ((agentId: string) => void) | null) {
  onAgentClickCallback = cb;
}
```

In the `addAgentSprite` function, after creating the sprite container, make it interactive:

```ts
// After creating the agent container (the Container that holds sprite + labels):
container.eventMode = "static";
container.cursor = "pointer";
container.on("pointertap", () => {
  onAgentClickCallback?.(id);
});
```

Note: identify the exact container variable name by reading the current code. The container that groups the sprite + name label for a single agent is what needs the event.

- [ ] **Step 2: Add `onAgentClick` prop to GameView**

In `web/src/components/GameView.tsx`, add the prop and wire it:

```tsx
// Change the component signature:
export default function GameView({
  companyId,
  onAgentClick,
}: {
  companyId: string;
  onAgentClick?: (agentId: string) => void;
}) {
```

Import `setOnAgentClick` from agents.ts and wire it in the PixiJS init effect:

```tsx
import { addAgentSprite, showSpeechBubble, removeAgentSprite, loadCharacterTextures, setOnAgentClick } from "@/canvas/agents";

// Inside the PixiJS init useEffect, after loadCharacterTextures():
setOnAgentClick(onAgentClick ?? null);

// In the cleanup return:
setOnAgentClick(null);
```

- [ ] **Step 3: Verify the app builds**

Run: `cd web && bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/canvas/agents.ts web/src/components/GameView.tsx
git commit -m "feat(#71): add agent click handler to canvas sprites and GameView"
```

---

## Task 5: Enhance company page with header, loading, 404, and AgentProfile

**Files:**
- Modify: `web/src/app/company/[id]/page.tsx`

- [ ] **Step 1: Rewrite the company page with fetch, states, and wiring**

Replace `web/src/app/company/[id]/page.tsx` with:

```tsx
"use client";

import { use, useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { OfficeHeader } from "@/components/OfficeHeader";
import { AgentProfile } from "@/components/AgentProfile";

const GameView = dynamic(() => import("@/components/GameView"), { ssr: false });

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

type CompanyData = {
  name: string;
  status: string;
  agent_count: number;
  active_agent_count: number;
  messages_today: number;
};

export default function CompanyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Fetch company info
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    fetch(`${API_URL}/api/companies/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled && data) setCompany(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [id]);

  // Agent profile from URL query
  const selectedAgentId = searchParams.get("agent");

  const handleAgentClick = useCallback(
    (agentId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("agent", agentId);
      router.replace(`/company/${id}?${params.toString()}`, { scroll: false });
    },
    [id, searchParams, router],
  );

  const handleAgentClose = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("agent");
    const qs = params.toString();
    router.replace(`/company/${id}${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [id, searchParams, router]);

  if (loading) {
    return (
      <main className="w-screen h-screen bg-background overflow-hidden flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="w-64 h-6" />
          <Skeleton className="w-48 h-4" />
          <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-foreground mt-4" />
        </div>
      </main>
    );
  }

  if (notFound) {
    return (
      <main className="w-screen h-screen bg-background overflow-hidden flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="text-muted-foreground">Company not found.</p>
        <a href="/" className="text-sm text-primary hover:underline">← Back to grid</a>
      </main>
    );
  }

  return (
    <main className="w-screen h-screen bg-background overflow-hidden relative">
      {company && (
        <OfficeHeader
          companyName={company.name}
          status={company.status}
          agentCount={company.active_agent_count}
          messagesToday={company.messages_today}
        />
      )}
      <GameView companyId={id} onAgentClick={handleAgentClick} />
      <AgentProfile
        agentId={selectedAgentId}
        open={!!selectedAgentId}
        onClose={handleAgentClose}
      />
    </main>
  );
}
```

- [ ] **Step 2: Check if GET /api/companies/:id exists**

Run: `cd  && grep -n "companies/:id" server/src/index.ts`

If it doesn't exist, we need to check if the `/api/companies` endpoint returns individual company data, or if we need to add a simple endpoint. If missing, add a route that queries by ID:

```ts
// In server/src/index.ts, in the router:
if (path.match(/^\/api\/companies\/[^/]+$/) && req.method === "GET") {
  const companyId = path.split("/").pop()!;
  const result = await pool.query(
    `SELECT id, name, description, status, agent_count, active_agent_count, messages_today, floor_plan, founded_at
     FROM companies WHERE id = $1`,
    [companyId]
  );
  if (result.rows.length === 0) return new Response("Not found", { status: 404 });
  return Response.json(result.rows[0]);
}
```

- [ ] **Step 3: Verify the app builds**

Run: `cd web && bun run lint`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/app/company/\\[id\\]/page.tsx
# If server was modified:
# git add server/src/index.ts
git commit -m "feat(#71): enhance company page with header, loading, 404, agent profile"
```

---

## Task 6: Final integration check + cleanup

**Files:**
- Verify all modified files

- [ ] **Step 1: Run lint on both server and web**

```bash
cd web && bun run lint
```

- [ ] **Step 2: Verify bg-background consistency**

The old company page used `bg-[#131620]`. The new page uses `bg-background`. Confirm that `bg-background` resolves to the same dark color to avoid white flash on navigation. Check the CSS:

```bash
grep -r "background" web/src/app/globals.css | head -10
```

If `--background` is `#131620` or equivalent in the dark theme, no change needed.

- [ ] **Step 3: Update README if needed**

Check if README mentions routes — add `/company/[id]` if routes are documented.

- [ ] **Step 4: Final commit if any cleanup**

```bash
git add -A
git commit -m "chore(#71): final lint + cleanup"
```
