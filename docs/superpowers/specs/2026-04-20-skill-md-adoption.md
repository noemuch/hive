# SKILL.md Adoption Decision + Validation Rules

**Created**: 2026-04-20
**Status**: approved for implementation
**Author**: Noé Chagué + AI design collaboration
**Related**: #213 (this spec), #214 (DB migration), #215 (registry endpoints), #216 (loader), #217 (MCP client), #218 (UI)
**Parent epic**: #183 (Phase 5 — Skills + Tools)

---

## 0. Executive Summary

We adopt the **Anthropic/skills.sh superset** as the canonical SKILL.md schema for Hive. This is the de-facto standard that skills.sh (85k+ skills), Hermes (70 bundled skills), VoltAgent (1000+ skills), and Claude Code all converge on. Our adoption is **maximally compatible** with external registries while adding a thin Hive-specific `category` and `version` field in frontmatter for filtering + lifecycle management.

**Key decisions:**
1. Source of truth: local `skills` table — remote URLs are pointers, not runtime dependencies
2. Validation: Zod schema at import time; fail-open for unknown optional fields
3. Import: URL → fetch → parse frontmatter → validate → store full content_md
4. Update strategy: user-triggered re-fetch (no background TTL for now, track `fetched_at`)
5. Reversibility: all decisions below are additive — no breaking changes required to pivot

---

## 1. SKILL.md Format Landscape (2026-04-20)

Three active implementations exist. They share a common core but diverge on optional fields.

### 1.1 Format comparison matrix

| Field | Anthropic / Claude Code | skills.sh | Hermes | Hive (this spec) |
|---|---|---|---|---|
| `name` (frontmatter) | ✅ required | ✅ required | ✅ required | ✅ required |
| `description` (frontmatter) | ✅ required | ✅ required | ✅ required | ✅ required |
| `version` (frontmatter) | ❌ absent | ⚠️ optional | ⚠️ optional | ✅ optional (added by Hive) |
| `category` (frontmatter) | ❌ absent | ✅ optional | ✅ optional | ✅ optional (used for filtering) |
| `author` (frontmatter) | ❌ absent | ⚠️ optional | ⚠️ optional | ⚠️ stored as `added_by_builder_id` |
| `tags` (frontmatter) | ❌ absent | ⚠️ optional | ⚠️ optional | ⚠️ ignored for now |
| `license` (frontmatter) | ❌ absent | ⚠️ optional | ⚠️ optional | ⚠️ displayed but not enforced |
| Body: free markdown | ✅ | ✅ | ✅ | ✅ |
| Body: structured sections | ❌ | ⚠️ sometimes | ⚠️ sometimes | ✅ accepted any |
| Max size | ~8KB (CLI display) | unknown | unknown | **32KB** hard limit (validated) |

### 1.2 Decision rationale: Anthropic/skills.sh superset

**Why not skills.sh-only**: skills.sh uses a CDN URL scheme (`https://skills.sh/{slug}`) with their own API. Depending on a third-party CDN at import time is acceptable; depending on it at agent runtime is not. We cache everything locally.

**Why not Anthropic-only**: Anthropic's internal format (used in Claude Code) has no `category` or `version`. We need both for the marketplace filtering UI (#218) and lifecycle management (invalidating old versions).

**Why superset is reversible**: We never write a Hive-only field into upstream registries. Our additions (`category`, `version`) are parsed but ignored by Claude Code and skills.sh, so skills authored for either platform load cleanly on Hive. If either standard evolves, we adopt additions without breaking existing rows.

### 1.3 Vendor lock-in risk matrix

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| skills.sh shuts down / paywalls | Medium | Low | All content cached in `skills.content_md`; source_url becomes tombstone |
| Anthropic breaks Claude Code SKILL.md compat | Low | Medium | Our validation is format-agnostic; body is stored verbatim |
| Hermes introduces incompatible frontmatter | Low | Low | `fail_open = true` on unknown fields; we log but don't reject |
| Multi-vendor standard forks (v2 wars) | Medium | Medium | `version` field + migration path documented in § 5 below |

---

## 2. Schema Definition

### 2.1 Canonical SKILL.md shape

```markdown
---
name: refactor-typescript-codebase
description: Step-by-step guide to safely refactor a TypeScript codebase at scale
version: "1.0"          # optional; Hive-added; semver string
category: engineering   # optional; Hive-added; see category taxonomy
---

# Refactor a TypeScript codebase

## When to use this skill
...

## Steps
...
```

**Rules:**
- Frontmatter block is required (opening `---` through closing `---`)
- `name`: required; slug-safe string (`[a-z0-9-]+`); max 128 chars
- `description`: required; plain text; max 512 chars
- `version`: optional; semver string or bare integer; defaults to `"1"` if absent
- `category`: optional; one of taxonomy below; defaults to `"general"` if absent or unknown
- Body after closing `---`: required; minimum 10 chars; maximum 32KB total including frontmatter
- Unknown frontmatter keys: accepted and ignored (fail-open)

### 2.2 Category taxonomy (v1)

| Category slug | Display name | Examples |
|---|---|---|
| `engineering` | Engineering | refactor, test-writing, code-review |
| `design` | Design | UI critique, accessibility audit |
| `writing` | Writing | technical writing, blog drafts |
| `research` | Research | literature review, summarization |
| `data` | Data | analysis, SQL, visualization |
| `product` | Product | spec writing, roadmap |
| `ops` | Operations | incident response, deploy |
| `general` | General | catch-all for uncategorized |

### 2.3 Zod validation schema

```typescript
import { z } from "zod";

const SKILL_CATEGORY = z.enum([
  "engineering", "design", "writing", "research",
  "data", "product", "ops", "general",
]).default("general");

export const SkillFrontmatterSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/).max(128),
  description: z.string().max(512),
  version: z.string().optional().default("1"),
  category: SKILL_CATEGORY,
}).passthrough(); // fail-open: unknown fields pass through

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

// Full document validation (called post-parse)
export const SkillDocumentSchema = z.object({
  frontmatter: SkillFrontmatterSchema,
  body: z.string().min(10),
  raw: z.string().max(32 * 1024), // 32KB hard cap
});
```

**Validation is fail-fast** at import time, not at agent runtime. If a SKILL.md fails validation, the import is rejected with a structured error (see § 3.3). Already-stored skills are never invalidated retroactively due to schema changes — only re-imports are re-validated.

### 2.4 JSON Schema equivalent (for documentation / interop)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://hive.app/schemas/skill-frontmatter-v1.json",
  "title": "Hive SKILL.md Frontmatter",
  "type": "object",
  "required": ["name", "description"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[a-z0-9-]+$",
      "maxLength": 128
    },
    "description": {
      "type": "string",
      "maxLength": 512
    },
    "version": {
      "type": "string",
      "default": "1"
    },
    "category": {
      "type": "string",
      "enum": ["engineering","design","writing","research","data","product","ops","general"],
      "default": "general"
    }
  },
  "additionalProperties": true
}
```

---

## 3. Import Flow

### 3.1 Flow diagram

```
[Builder enters URL or slug in UI]
         │
         ▼
[POST /api/skills/import  { source_url }]
         │
         ▼
┌──────────────────────────────────────────┐
│ 1. FETCH                                  │
│    GET source_url (timeout 10s)           │
│    Follow redirects (max 3)               │
│    Content-Type: must be text/*           │
│    Size check: abort if > 32KB            │
└──────────────────────────────────────────┘
         │  raw markdown string
         ▼
┌──────────────────────────────────────────┐
│ 2. PARSE FRONTMATTER                      │
│    Split on first `---` block             │
│    Parse YAML (gray-matter or @vscode/    │
│    yaml — existing dep preferred)         │
│    Extract: frontmatter object + body     │
└──────────────────────────────────────────┘
         │  { frontmatter, body, raw }
         ▼
┌──────────────────────────────────────────┐
│ 3. VALIDATE                               │
│    SkillDocumentSchema.parse(...)         │
│    On failure: return 422 + error details │
│    On success: continue                   │
└──────────────────────────────────────────┘
         │  validated SkillDocument
         ▼
┌──────────────────────────────────────────┐
│ 4. DEDUPLICATE                            │
│    SELECT id FROM skills                  │
│      WHERE source_url = $1               │
│    If exists AND builder is owner:        │
│      → update content_md + fetched_at    │
│    If exists AND builder is NOT owner:    │
│      → return existing skill (read-only) │
│    If new: insert                         │
└──────────────────────────────────────────┘
         │  skill row
         ▼
┌──────────────────────────────────────────┐
│ 5. STORE                                  │
│    INSERT INTO skills (                   │
│      slug, title, description,            │
│      source_url, content_md,              │
│      category, version,                   │
│      added_by_builder_id, fetched_at      │
│    ) VALUES (...)                          │
└──────────────────────────────────────────┘
         │
         ▼
[Return skill { id, slug, title, description, category }]
```

### 3.2 Slug derivation

Skills are addressed by slug in the DB. Slug is derived from `name` frontmatter field:

```typescript
function deriveSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 128);
}
```

Collision handling: if `slug` already exists and `source_url` differs → append `-2`, `-3` etc. The original slug is the canonical one (first-writer wins).

### 3.3 Error response shape

```json
{
  "error": "skill_validation_failed",
  "details": {
    "field": "name",
    "message": "name must match /^[a-z0-9-]+$/",
    "received": "My Skill!"
  }
}
```

Possible error codes:
- `skill_fetch_failed` — network error or timeout
- `skill_too_large` — body exceeds 32KB
- `skill_no_frontmatter` — no `---` block found
- `skill_validation_failed` — Zod validation error
- `skill_forbidden_url` — URL is on blocklist (localhost, internal IPs)

### 3.4 URL allowlist / blocklist

Fetching arbitrary URLs is a SSRF vector. At import time:

```typescript
const FORBIDDEN_HOSTS = [/^localhost/, /^127\./, /^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

function validateSourceUrl(url: string): void {
  const parsed = new URL(url); // throws on malformed
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("skill_forbidden_url");
  if (FORBIDDEN_HOSTS.some(r => r.test(parsed.hostname))) throw new Error("skill_forbidden_url");
}
```

---

## 4. Storage

### 4.1 Skills table (Phase 5 migration, already in `docs/superpowers/specs/2026-04-19-hive-marketplace-design.md` § 4.1)

The Phase 5 migration in the marketplace spec defines the base table. This spec adds two columns confirmed via patch #214:

```sql
CREATE TABLE skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,
  title           text NOT NULL,           -- = frontmatter.name (display form)
  description     text,                    -- = frontmatter.description
  source_url      text,                    -- pointer to origin SKILL.md (nullable for custom)
  content_md      text,                    -- full cached SKILL.md body (raw markdown)
  category        text NOT NULL DEFAULT 'general',  -- NEW (patch #214)
  version         text NOT NULL DEFAULT '1',        -- NEW (patch #214)
  fetched_at      timestamptz,             -- NEW: last time content_md was fetched
  added_by_builder_id uuid REFERENCES builders(id),
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX skills_category_idx ON skills (category);
CREATE INDEX skills_source_url_idx ON skills (source_url) WHERE source_url IS NOT NULL;
```

**Why store full content_md?**
- Runtime independence: agents load skill content without an outbound HTTP call
- Reproducibility: an agent's behavior at T is deterministic even if upstream URL changes at T+1
- Audit trail: content at import time is preserved; `fetched_at` timestamps each refresh

**Why NOT store parsed sections separately?**
- Premature optimization: most skills are < 4KB; column scan is fast
- Flexibility: different LLM providers benefit from different prompt injection formats; the loader decides at runtime how to inject the raw content_md, not the store

### 4.2 Custom skills (no source_url)

Builders can POST a raw SKILL.md body directly instead of a URL:
- `source_url = null`
- `fetched_at = null` (never refreshed from remote)
- `added_by_builder_id` = the builder who created it
- These are private to that builder (only they can attach to their agents)

Public vs. private is tracked by `source_url IS NULL` as a heuristic for now; a proper `is_public` column is deferred to Phase 6 when the marketplace for skills opens.

---

## 5. Update Strategy

### 5.1 Decision: user-triggered refresh (no background TTL in Phase 5)

Background TTL refresh was evaluated and rejected for Phase 5 because:
1. Skills rarely change once published (semver convention)
2. Silent content changes would invalidate agent behavior without builder awareness
3. Bun's runtime has no built-in scheduler; adding one for skill refresh is premature

**Phase 5 update flow:**

```
[Builder clicks "Refresh skill" in UI]
         │
         ▼
[POST /api/skills/:id/refresh]   (JWT, owner only)
         │
         ▼
[Re-run import flow § 3.1 with existing source_url]
         │
         ▼
[If content_md changed: bump fetched_at, log]
[If version field changed: store new version, warn builder]
[If validation fails: return error, keep old content]
```

**Stale skill detection:**
- `fetched_at` is displayed in the UI ("last updated 14 days ago")
- Skills not refreshed in > 90 days get a "may be outdated" badge in the UI (Phase 6)
- No automatic expiry — builder decides when to refresh or detach

### 5.2 Future: version-pinned import

When SKILL.md v2 emerges (likely adding `min_context_window`, `requires_tools`, etc.), builders will be able to pin to a specific version:

```
POST /api/skills/import { source_url, pin_version: "1.2.0" }
```

The DB stores `version` from frontmatter. If upstream source_url bumps to v2, a refresh will detect the version change and warn the builder before updating. This is the reversibility guarantee: we can pivot to v2 without silently breaking v1 agents.

---

## 6. Runtime Injection (loader interface contract)

This spec defines what the loader (issue #216) must receive. Full loader implementation is in #216.

```typescript
// Contract: what the loader gets from the DB
interface LoadedSkill {
  slug: string;
  title: string;
  description: string;
  content_md: string;   // full raw markdown
  category: string;
  version: string;
}

// Contract: how the loader injects into LLM context
// (loader decides format; this spec only constrains the input)
interface SkillInjectionResult {
  system_prompt_addition: string;  // prepended to agent system prompt
  token_estimate: number;          // for budget tracking
}
```

The loader must:
1. Load all skills attached to the agent via `agent_skills` join at agent startup
2. Inject `content_md` verbatim (or summarized if total exceeds context budget)
3. Respect `category` for progressive disclosure (load only when relevant, Phase 6)
4. Never make outbound HTTP calls at runtime — only reads from DB

---

## 7. Sample SKILL.md (Mock Import Test)

The following is a sample skill.sh-compatible SKILL.md that must validate cleanly against § 2.3:

```markdown
---
name: write-technical-spec
description: Write a clear, structured technical specification from a raw idea or user story
version: "1.1"
category: engineering
---

# Write a Technical Specification

Use this skill when an agent is asked to produce a spec from scratch or refine a rough idea into a structured document.

## When to apply
- User story or idea is provided but lacks structure
- Team needs alignment before implementation begins
- Review is expected from stakeholders with varying technical depth

## Steps

1. **Clarify scope** — ask 2-3 targeted questions to eliminate ambiguity before writing
2. **Define the problem** — one paragraph, problem statement only, no solutions yet
3. **List constraints** — technical, time, and organizational
4. **Propose solution** — architecture or approach; include trade-offs considered
5. **Define acceptance criteria** — concrete, testable, binary
6. **Identify dependencies** — what must exist before this ships
7. **Estimate effort** — rough order of magnitude (S/M/L/XL)

## Output format

```markdown
# [Spec title]

**Problem**: ...
**Solution**: ...
**Constraints**: ...
**Acceptance criteria**: ...
**Dependencies**: ...
**Effort**: M (~3-5 dev days)
```

## Anti-patterns to avoid
- Writing the solution before defining the problem
- Skipping trade-offs (there are always trade-offs)
- Acceptance criteria that are not binary (avoid "good", "fast", "better")
```

**Mock import test** (to be validated in unit test for #216):

```typescript
import { parseSkillMd } from "server/src/skills/parser";
import { SkillDocumentSchema } from "server/src/skills/schema";

const raw = fs.readFileSync("test/fixtures/write-technical-spec.md", "utf-8");
const parsed = parseSkillMd(raw);           // extract frontmatter + body
const validated = SkillDocumentSchema.parse(parsed); // throws on invalid

assert(validated.frontmatter.name === "write-technical-spec");
assert(validated.frontmatter.category === "engineering");
assert(validated.frontmatter.version === "1.1");
assert(validated.body.length > 10);
assert(validated.raw.length < 32 * 1024);
```

---

## 8. Implementation Issues for P5.4 (Loader — #216)

After this spec is merged, issue #216 should be broken into these sub-tasks:

### P5.4-A: Parser + Zod schema module
- `server/src/skills/parser.ts` — frontmatter extraction (gray-matter or manual)
- `server/src/skills/schema.ts` — Zod schema as defined in § 2.3
- Unit tests: valid skill, invalid name, missing frontmatter, oversized body, unknown fields (pass-through)
- No DB dependencies; pure functions

### P5.4-B: Import endpoint
- `POST /api/skills/import` — JWT, any authenticated builder
- `POST /api/skills` (custom, no URL) — JWT, any authenticated builder
- `POST /api/skills/:id/refresh` — JWT, owner only
- SSRF protection per § 3.4
- Deduplication per § 3.1
- Integration test: import sample skill from fixture, expect stored row

### P5.4-C: Loader integration in agent.ts
- On agent startup: `SELECT skills.content_md FROM skills JOIN agent_skills ON ...`
- Inject into system prompt as defined in § 6
- Token budget guard: if sum of all skill content_md > 8000 tokens, truncate lowest-priority skills (category = "general" first)
- No outbound HTTP at runtime

### P5.4-D: E2E test fixture
- `test/fixtures/write-technical-spec.md` — the sample skill from § 7
- Test: import fixture → validate → agent startup loads it → system prompt contains skill name

---

## 9. Reversibility Checklist

Per acceptance criteria: **decision must be reversible if the standard evolves.**

| Scenario | Impact | Recovery path |
|---|---|---|
| skills.sh dies | source_url becomes dead link | content_md still valid; skill keeps working; builder can detach |
| Anthropic publishes SKILL.md v2 with `requires_tools` | Unknown field in frontmatter | `passthrough()` in Zod accepts it; we add it to schema in next cycle |
| We need to reject previously-accepted skills | content_md stored; can re-validate on read | Add `validated_at` column; re-run validation job; flag stale |
| Category taxonomy needs extension | New enum value | ALTER TABLE skills ADD CONSTRAINT... OR widen to free-text `text` column with CHECK |
| Switch to JSON Schema instead of Zod | Schema is parallel-documented in § 2.4 | Both are expressed; switch is a refactor, not a data migration |

---

## 10. Out of scope (this spec)

- Skills marketplace / discoverability UI → #218
- Skill recommendations for agents → Phase 6
- License enforcement (CC, MIT, etc.) → Phase 6
- Skills version diffing → Phase 6
- MCP tool calling → separate spec + #217
- Argus adversarial testing of skill injection → #243

---

**End of spec.**
