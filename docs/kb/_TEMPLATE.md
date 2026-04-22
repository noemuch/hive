---
# Copy this file as tier1/QXXX-<short-slug>.md
# Frontmatter is parsed — stick to these keys.

id: Q000
slug: <short-kebab-slug>
title: <one-line precise title, max 80 chars>
tier: 1
status: OPEN                       # DECIDED | OPEN | BLOCKED | DEFERRED | STALE
confidence: LOW                    # HIGH | MEDIUM | LOW
decision: null                     # one-line; null if OPEN

researched_on: null                # YYYY-MM-DD
researched_by: claude-opus-4-7
expires_on: null                   # YYYY-MM-DD (typically +90 days)
cost_usd: 0

depends_on: []                     # [Q022, Q011]
blocks: []                         # [Q027, Q030]
supersedes: null                   # QXXX if this replaces an older decision
superseded_by: null

tags: []                           # [mcp, tools, figma, safety, ...]
poc_path: null                     # docs/kb/tier1/pocs/Q000-slug/ if applicable
---

# Q000 — <Title>

## Question

**Precise question** (1-2 sentences).

> Original framing from master list (optional quote).

## TL;DR (3 lines max)

- Line 1: the decision
- Line 2: why
- Line 3: what it blocks/enables

## Why it matters for Hive

1-3 bullet points tying this to a concrete Hive capability or risk.

## Investigation

### Official documentation

- [Source 1](url) — key finding
- [Source 2](url) — key finding

### Prior art / competitive landscape

- **Tool/company X**: what they do, URL, verdict on applicability

### Hands-on POC

If applicable: link to `pocs/Q000-<slug>/`, describe setup, results, failure modes observed.

```bash
# Reproducible commands
```

### Failure modes observed (in the wild)

- **Mode A**: [description] — source: HN/Reddit/GitHub issue URL
- **Mode B**: [description] — source: [...]

### Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A | ... | ... | Accept |
| B | ... | ... | Reject — reason |
| C | ... | ... | Defer |

## Decision

**We WILL**: [concrete action].

**We will NOT**: [explicit non-goal].

**Reason**: [2-3 sentences].

## Impact on Hive architecture

- **Requires** (dependencies):
  - [ ] Migration N ...
  - [ ] Code change in `server/src/...`
- **Enables** (what this unlocks):
  - [Feature X]
- **Estimated effort**: [N days of pipeline work]
- **Cost impact**: [+/- $/month]

## Open sub-questions

- [ ] Sub-question 1 (deferred to Tier 2 if not blocking)
- [ ] Sub-question 2

## Legacy doc contradictions

If this decision contradicts a claim in a legacy doc, list here:

- `docs/PRODUCT.md:123` claims X, actually Y because Z. Logged in `_DEBT.md`.

## References

- [URL1]
- file:line references
- `hive-fleet@commit-sha`
