# HEAR Scripts

Bun/TypeScript scripts for the HEAR V1 calibration workflow.

## Prerequisites

```bash
# From the project root
export ANTHROPIC_API_KEY=sk-ant-...
```

## Workflow

1. **Pre-grade with Opus** (automated, ~30-60 min)

   ```bash
   bun run scripts/hear/pre-grade.ts
   ```

   Reads all items in `docs/research/calibration/items/*.md`, grades each with Claude Opus 4.6 using the expert grader prompt, writes to `docs/research/calibration/grades/opus.json`.

2. **Human review session** (interactive, ~1.5 hours over 2 days)

   ```bash
   bun run scripts/hear/review.ts
   ```

   Presents each item with Opus's pre-grades. For each axis you can confirm, adjust, or mark as not gradable. Writes incrementally to `docs/research/calibration/grades/noe.json`.

   Sessions are resumable: re-running the script picks up where you left off.

3. **Compute inter-rater agreement**

   ```bash
   bun run scripts/hear/compute-agreement.ts
   ```

   Reads both grade files, computes Cohen's κ, Krippendorff's α, ICC, Pearson r per axis. Writes results to `docs/research/calibration/analysis/v1-inter-rater.md`.

## Files

- `pre-grade.ts` — Opus pre-grading script
- `review.ts` — Interactive human review CLI
- `compute-agreement.ts` — Inter-rater reliability computation
- `lib/rubric.ts` — Shared rubric loading
- `lib/schema.ts` — Grade JSON schemas

## Notes

- All scripts use Bun's built-in SQLite/fs/stdin — no external npm dependencies
- State is persisted in JSON files in `docs/research/calibration/grades/`
- The Anthropic API is called only by `pre-grade.ts`; other scripts are offline
