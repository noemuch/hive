# HEAR V1 Calibration — Grading Protocol

**Version**: 1.0
**Effective date**: 2026-04-11
**Rubric version required**: 1.0 (see `docs/research/HEAR-rubric.md`)

---

## Purpose

This document specifies the exact procedure for producing the V1 HEAR calibration set. It is binding: deviations must be documented in the grading session's final report.

The protocol uses **human-in-the-loop grading**: Claude Opus 4.6 produces initial grades; a human expert (Noé Chagué) reviews each grade and either confirms, adjusts, or flags it. The human's final grades are authoritative.

This protocol is pre-registered in `docs/research/calibration/pre-registration.md`.

---

## Principles

1. **Independence** — the human grader must not see the judge's own scores (Haiku judge prompts). Only Opus pre-grades, which are structurally distinct.
2. **Traceability** — every score must come with a one-sentence justification and timestamp.
3. **No discussion before completion** — the human grader does not discuss scores with anyone (including other Claude instances) until their entire grading session is finished.
4. **Reproducibility** — the entire calibration process, including the prompts used, is committed to git. Anyone should be able to re-execute the pipeline and obtain equivalent results.
5. **Honesty about limitations** — known V1 limitations are documented upfront (see "Limitations" section).

---

## Roles

### Opus pre-grader (Claude Opus 4.6)

The Opus pre-grader is run as a batch process. It receives:

- One artifact at a time (anonymized, synthetic)
- The full HEAR rubric as context
- The expert grader prompt (`grader-prompt-opus.md`)

It produces, for each artifact:

- Eight scores (one per HEAR axis) on a 1–10 integer scale
- A one-sentence justification per score
- An array of evidence quotes from the artifact per score
- A self-reported confidence per score (1–10)

All outputs are written to `grades/opus.json` in a standard schema.

The Opus pre-grader is run **once**, before the human review session begins. Results are frozen and committed to git.

### Human grader (Noé Chagué)

The human grader runs a review session after Opus pre-grades exist. For each artifact, the human:

1. Reads the artifact in full (no skimming)
2. Reads Opus's scores and justifications
3. For each of the 8 axes, chooses one of three actions:
   - **Confirm**: agree with Opus's score. Opus's score becomes the final score. (~70% expected)
   - **Adjust**: disagree with Opus. Enter a new score and a new one-sentence justification citing the specific evidence. The human's score becomes the final score. (~25% expected)
   - **Not gradable**: the axis cannot be graded from this single artifact (typically Persona Coherence, which requires longitudinal data, and occasionally Initiative Quality, which requires behavior windows). The axis is recorded as `null` with a justification. (~5% expected)

All outputs are written to `grades/noe.json`.

### Limits on the human session

- Maximum **10 items per session**. After 10 items, take a break of at least 30 minutes.
- Maximum **3 sessions per day**. After 3 sessions (~30 items), stop for the day.
- The entire 50-item grading must be distributed over at least 2 days to avoid fatigue effects.
- **No caffeine-induced rushing**: grading must be done when the grader is rested and focused.

These limits are standard in the psychometric instrument design literature to minimize fatigue-induced rater drift.

---

## Step-by-step procedure

### Phase 0 — Preparation

Before any grading:

1. Rubric v1.0 is committed (`docs/research/HEAR-rubric.md`)
2. 50 calibration items are generated and committed (`docs/research/calibration/items/*.md`)
3. Expert grader prompt is committed (`docs/research/calibration/grader-prompt-opus.md`)
4. Pre-registration is committed (`docs/research/calibration/pre-registration.md`)
5. CLI review tool is committed (`scripts/hear/review.ts`)

### Phase 1 — Opus pre-grading (automated, ~30–60 minutes)

Run:

```bash
bun run scripts/hear/pre-grade.ts
```

This script:

1. Loads all items from `items/*.md`
2. For each item, calls Claude Opus 4.6 via the Anthropic API with the expert grader prompt
3. Parses the JSON response
4. Validates against the expected schema
5. Writes incrementally to `grades/opus.json`

On completion, `grades/opus.json` contains 50 entries, each with 8 axis scores.

**The Opus pre-grading is committed to git before human review begins.** This is critical: it creates an immutable record that the human cannot retroactively influence.

### Phase 2 — Human review session (interactive, ~1.5–2 hours over 2 days)

Run:

```bash
bun run scripts/hear/review.ts
```

The CLI presents each item in order (order is randomized to prevent order effects):

1. Displays the item content in a scrollable pane
2. Shows the 8 axes with Opus's scores and justifications
3. For each axis, prompts the human: `[c] confirm, [a] adjust, [n] not gradable, [?] help`
4. If adjusting, prompts for new score (1–10) and new justification
5. Writes to `grades/noe.json` after each item (incremental save in case of crash)

The session can be paused and resumed. State is persisted.

### Phase 3 — Inter-rater agreement computation

After both grading files exist:

```bash
bun run scripts/hear/compute-agreement.ts
```

This script computes:

- **Cohen's κ per axis** (pairwise agreement, treating scores as categorical or ordinal)
- **Krippendorff's α per axis** (more robust to small samples and missing data)
- **Intraclass Correlation Coefficient (ICC)** per axis (for the ordinal data)
- **Pearson r** per axis (continuous correlation)
- **Mean absolute difference** per axis
- **Distribution of actions** (confirm / adjust / not gradable) per axis

Results are written to `analysis/v1-inter-rater.md`.

### Phase 4 — Disagreement resolution

For items where the human adjusted Opus's score by more than 2 points:

1. The grader re-reads the item and the Opus justification
2. The grader decides whether the disagreement reveals:
   - **Rubric ambiguity** → the rubric is refined; item is re-graded by both after rubric update
   - **Opus error** → Opus's score is wrong; human's score stands
   - **Human error** → rare, but possible; human adjusts their own score
   - **Genuine ambiguity** → item is dropped from the calibration set

All decisions are logged in `analysis/v1-disagreement-log.md`.

### Phase 5 — Final calibration set publication

The final calibration set is published as:

1. `items/*.md` — the artifacts (unchanged since generation)
2. `grades/noe.json` — final human grades (authoritative)
3. `grades/opus.json` — initial Opus grades (for reference and κ computation)
4. `analysis/v1-inter-rater.md` — agreement statistics
5. `analysis/v1-disagreement-log.md` — disagreement resolution notes

A summary is written to `docs/research/calibration/README.md` including:

- Number of items
- Number graded / dropped
- Cohen's κ per axis
- Known limitations
- Instructions for reproducing

---

## Quality control rules

### Rule 1 — Mandatory justifications

Every score, whether confirmed or adjusted, must have a justification. Confirmations can reuse Opus's justification verbatim (by pressing `c`). Adjustments require a new justification typed by the human.

### Rule 2 — No score without evidence

Every justification must cite or refer to specific evidence from the artifact. "It just feels right" is not acceptable.

### Rule 3 — Not-gradable is a valid answer

The grader is encouraged to mark an axis as "not gradable" when they genuinely cannot assess it from the single artifact. Forcing a score when uncertain introduces noise.

### Rule 4 — Uncertainty annotation

When torn between two scores (e.g., the item is between a "5" and a "7"), the grader picks the lower score and notes the uncertainty in the justification: `"between 5 and 7, leaning low because X"`. The analysis pipeline will use this flag to identify fuzzy-boundary items.

### Rule 5 — Do not look at other graders during session

During the grading session, the human grader must not:

- Discuss scores with any other person or AI
- Reread the rubric during a single item's grading (reread between items is fine)
- Skip ahead to see which items are coming
- Re-grade previously completed items mid-session (re-grading is allowed as a separate "pass 2" after the whole session, with a rationale)

---

## Technical setup

- All tools run locally (no external state)
- The Anthropic API key is stored in `.env` (not committed)
- All grading data lives in git
- Scripts use Bun and TypeScript
- No dependencies beyond what the Hive project already uses

---

## Limitations of V1

Documented explicitly so reviewers and future readers understand the scope:

1. **One human grader only** — the V1 calibration set has a single human anchor (Noé Chagué). V2 will add 2–3 external expert graders for independent replication.

2. **Human-in-the-loop, not blind grading** — because the human reviews Opus pre-grades rather than grading from scratch, the human's independence is partially compromised. Opus acts as an anchor, which may bias the human toward agreement. Mitigation: the protocol requires the human to form their own opinion *before* revealing Opus's grades where possible. V2 will compare blind grading vs. human-in-the-loop grading on a subset to quantify this anchoring effect.

3. **Synthetic artifacts only** — V1 uses 50 synthetic items generated by Opus 4.6 with specific quality targets. Real-world artifacts are not used. V2 will add a second calibration set based on real anonymized artifacts (with builder consent) to verify generalizability.

4. **Single rubric version** — V1 grades are produced against rubric v1.0. If the rubric evolves, previously graded items need re-grading against the new version. All grades are tagged with the rubric version.

5. **No external validity measures** — V1 does not yet correlate HEAR axes with external measures of the same constructs (e.g., established reasoning benchmarks). V2 adds convergent validity testing.

These limitations are acceptable for V1 because the primary goal is establishing a foundation. V2 will strengthen the foundation with independent graders, real data, and external validation.

---

## Sign-off

The human grader must sign each session's output with a line in `grades/noe.json`:

```json
{
  "grader": "noe",
  "session_id": "uuid",
  "session_start": "2026-04-11T10:00:00Z",
  "session_end": "2026-04-11T11:30:00Z",
  "items_graded_in_session": 10,
  "confirmed_by_grader": true,
  "grader_notes": "Feeling rested and focused. Any concerns?"
}
```

This is a procedural discipline: an explicit affirmation that the protocol was followed.

---

## Versioning

This is HEAR Grading Protocol v1.0. Changes are versioned. All grades are tagged with the protocol version they were produced under.
