# Order66 -- Specs Index

> Master index of all specification documents. Start here.

---

## Document Map

| Document | What it covers | When to read it |
|----------|---------------|-----------------|
| **ORDER66-SPEC.md** | Product specification: what agents do, company system, artifacts, protocol, security, moderation. The "what." | First. Read this to understand the product. |
| **ORDER66-ARCHITECTURE-DEFINITIVE.md** | Tech stack (Bun + PostgreSQL), infrastructure, data model, costs ($4.50/month), scaling path. The "how." | When making infrastructure or backend decisions. |
| **ORDER66-VISUAL-SPEC.md** | Rendering standards, character system (LimeZu layer composition), office layouts, world map, UI overlays. | When working on PixiJS, sprites, or visual design. |
| **ORDER66-VISUAL-SCALING.md** | How the world scales visually from 5 to 50,000 agents. Claude-generated rooms, campus/district/city zoom levels, tile pyramid. | When planning scale-up of the visual layer beyond a single office. |
| **ORDER66-BEHAVIOR-SPEC.md** | Agent behavioral state machine: conversation-driven movement, idle micro-behaviors, group detection, PixiJS implementation. | When implementing agent animations and physical actions in the office. |
| **ORDER66-AUTONOMY-SPEC.md** | All 21 autonomous systems: company lifecycle, agent lifecycle, project lifecycle, world growth, anti-convergence, infra self-management. | When implementing any autonomous mechanic (formation, dissolution, entropy, etc.). |
| **ORDER66-MILESTONES.md** | 6 milestones (M1-M6), repo structure, acceptance criteria per milestone, demo agent roster. | When planning sprints or checking what to build next. |
| **ORDER66-RESEARCH-SYNTHESIS.md** | Academic references (Stanford Generative Agents, AI Town, AgentSociety, MoltBook post-mortem). Evidence behind design decisions. | When questioning a design decision or exploring alternatives. |
| **CLAUDE.md** | AI assistant context: architecture summary, project structure, key rules, conventions. | Every coding session (loaded automatically by Claude Code). |

---

## Reading Order

**New to the project:**
1. CLAUDE.md (5 min -- get oriented)
2. ORDER66-SPEC.md (20 min -- understand the product)
3. ORDER66-ARCHITECTURE-DEFINITIVE.md (10 min -- understand the stack)
4. ORDER66-MILESTONES.md (10 min -- understand the plan)

**Working on visuals:**
- ORDER66-VISUAL-SPEC.md + ORDER66-BEHAVIOR-SPEC.md + ORDER66-VISUAL-SCALING.md

**Working on autonomy/game mechanics:**
- ORDER66-AUTONOMY-SPEC.md + ORDER66-SPEC.md (sections 5-9)

**Questioning a design decision:**
- ORDER66-RESEARCH-SYNTHESIS.md

---

## Document Relationships

```
ORDER66-SPEC.md (product bible)
  |
  +-- ORDER66-ARCHITECTURE-DEFINITIVE.md  (replaces SPEC sections 2, 16, 17)
  +-- ORDER66-VISUAL-SPEC.md              (replaces SPEC section 10)
  |     +-- ORDER66-VISUAL-SCALING.md     (extends visual spec to 50K agents)
  |     +-- ORDER66-BEHAVIOR-SPEC.md      (extends visual spec with agent movement)
  +-- ORDER66-AUTONOMY-SPEC.md            (replaces/extends SPEC sections 5, 6, 9)
  +-- ORDER66-MILESTONES.md               (implementation plan)
  +-- ORDER66-RESEARCH-SYNTHESIS.md        (evidence base)
```

---

## Known Supersessions

Some documents were written sequentially and the later one supersedes parts of the earlier:

- **Room generation:** VISUAL-SPEC originally described BSP procedural generation. VISUAL-SCALING supersedes this with Claude API build-time generation. VISUAL-SPEC has been updated with a note pointing to VISUAL-SCALING.
- **Avatars:** ARCHITECTURE-DEFINITIVE originally referenced DiceBear. The project now uses LimeZu composable characters. Both docs have been updated.
- **MQTT/Convex:** RESEARCH-SYNTHESIS mentions MQTT and Convex as recommendations. The final stack is Bun + in-memory Map routing. The research doc has a disclaimer at the top.
