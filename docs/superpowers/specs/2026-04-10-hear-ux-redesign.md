# HEAR UX Redesign — 3-Altitude Progressive Disclosure

**Date:** 2026-04-10
**Author:** Noe Chague
**Status:** Design approved

---

## Overview

Redesign all HEAR quality surfaces using 7 principles derived from Linear, Vercel, Datadog, and Gather:

1. **Hero number first** — composite quality score is THE number, big and centered
2. **3 altitudes** — Survol (composite) → Exploration (7 axes) → Drilldown (judgments)
3. **Progressive disclosure** — axes only after a click, drilldown only after another click
4. **Monochrome + signal color** — colors only encode scores (green ≥7, yellow 4-6, red ≤3)
5. **Sorted by score** — best axis on top, worst on bottom (not alphabetical)
6. **F-pattern layout** — top-left = most important number
7. **Narrative summaries** — each agent gets a one-line natural language summary

## Surfaces to redesign

### 1. Agent Profile (Sheet slide-over)

**Altitude 1 — Survol (default view on open):**
- Avatar + name + role + company + status
- Hero composite score (large, centered)
- 7-day trend sparkline + delta ("▲ +0.4 this week")
- One-line natural language summary ("Strong in decision-making and clarity. Needs work on self-awareness.")
- 2 stat cards (messages sent, artifacts created) — secondary, small
- Single CTA button: "See quality breakdown →"

**Altitude 2 — Exploration (after CTA click):**
- Back button + agent name + composite score (smaller, top-right)
- Tab bar: Performance | Quality | Composite
- 7 axes as horizontal bars, **sorted by score descending**
- Each bar: axis name (left) + progress bar (center) + score number (right)
- Each bar has a one-line contextual description below (not the rubric definition — the verdict for THIS agent)
- Worst axis has a ⚠ warning icon
- Every bar row is clickable → opens altitude 3
- No spider chart (replaced by sorted bars — more readable, no label truncation)

**Altitude 3 — Drilldown (after clicking an axis bar):**
- Back button "← Quality Breakdown"
- Axis name as heading
- Score + 10-day trend sparkline + confidence label (Calibrated/Provisional/New)
- "What this measures" — 2-3 sentence plain-language explanation
- Recent judgments as cards:
  - Artifact title + type badge + date + score badge (colored)
  - Judge reasoning as prose
  - Evidence quotes as indented blockquotes
  - "View artifact →" link

### 2. Dashboard Builder Cards

Each agent card shows:
- Agent name + role + company
- Hero composite score (large, centered)
- Trend delta (▲ +0.4 / ▼ -0.2 / ● stable)
- Only 2 bars: **best axis** and **worst axis** (not all 7)
- One-line natural language summary
- Single CTA: "See breakdown →"
- Agents without evaluation: "Evaluation pending — first report tomorrow morning"

### 3. Leaderboard

- Clean table (no podium in quality mode)
- Columns: rank, agent name, role, quality score, trend
- Dimension toggle at top: Performance | Quality | Composite
- Filters at bottom (not top): axis dropdown, role dropdown
- One score number per row (not bars or breakdowns)
- Click agent → opens profile sheet

### 4. Research Page

Already redesigned as long-form prose (Linear-style). No changes needed.

## What is removed

- **Spider chart** — removed from V1. Replaced by sorted horizontal bars. Spider charts are visually appealing but poor for comparison (Nielsen Norman Group research). Can return as optional "advanced view" in V2.
- **7-bar breakdown on dashboard cards** — replaced by best + worst only. Full breakdown is in the profile.
- **Axis descriptions on dashboard cards** — too dense. Moved to profile altitude 2.
- **Confidence rings on dashboard** — simplified to text label in profile only.

## What is new

- **Natural language summaries** per agent — generated from the axis scores, displayed in altitude 1 and dashboard cards
- **Sorted axes** — always descending by score, not alphabetical
- **⚠ warning on weakest axis** — visual signal for the area needing attention
- **"What this measures" section** — plain-language explanation in altitude 3 (not the rubric jargon)

## Component changes

| Component | Action |
|---|---|
| `AgentProfile.tsx` | Rewrite as 3-altitude progressive disclosure |
| `QualityPanel.tsx` | Rewrite → becomes altitude 2 (sorted bars, no spider chart) |
| `QualityDrilldown.tsx` | Rewrite → becomes altitude 3 (cleaner, narrative cards) |
| `QualityBreakdown.tsx` | Rewrite → dashboard cards (hero number + best/worst bars) |
| `QualityTrend.tsx` | Keep, integrate as inline sparkline |
| `QualitySpiderChart` (SVG in QualityPanel) | Delete |
| Leaderboard `_content.tsx` | Simplify quality view (remove podium, cleaner table) |

## Natural language summary generation

The summary is generated client-side from the axis scores (no LLM call):

```typescript
function generateSummary(axes: Record<string, { score: number }>): string {
  const sorted = Object.entries(axes)
    .filter(([, v]) => v.score != null)
    .sort((a, b) => b[1].score - a[1].score);

  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  const bestLabel = AXIS_SUMMARIES[best[0]]; // e.g., "decision-making"
  const worstLabel = AXIS_SUMMARIES[worst[0]]; // e.g., "self-awareness"

  if (worst[1].score >= 7) return `Consistently strong across all axes.`;
  if (best[1].score < 4) return `Needs improvement across most axes.`;
  return `Strong in ${bestLabel}. Needs work on ${worstLabel}.`;
}
```

No API call, no LLM. Pure client-side from the scores already fetched.

## Not in scope

- Research page (already done)
- Canvas/office integration (V2)
- Notification system (E10, separate)
- Actionable recommendations (V2)
