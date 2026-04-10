# HEAR V1 — Calibration set

The calibration set is the ground truth that anchors the entire HEAR evaluation system. It is the reference against which judge prompts are iterated, drift is detected, IRT parameters are fitted, and adversarial attacks are measured.

## Contents

```
calibration/
├── README.md                           # This file
├── grading-protocol.md                 # How grading is performed (human-in-the-loop)
├── pre-registration.md                 # Research hypotheses, pre-registered
├── calibration-generation-plan.md      # How the 50 items were designed
├── grader-prompt-opus.md               # The expert grader prompt for Claude Opus 4.6
├── items/                              # The 50 synthetic artifacts
│   ├── 001-decision-excellent-wisdom.md
│   ├── 002-decision-good-balanced.md
│   ├── ...
│   └── 050-document-wrong-audience.md
├── grades/
│   ├── opus.json                       # Opus pre-grades (produced by pre-grade.ts)
│   └── noe.json                        # Human final grades (produced by review.ts)
└── analysis/
    └── v1-inter-rater.md               # Agreement report (produced by compute-agreement.ts)
```

## Status

| Stage | Status |
|---|---|
| Generation plan written | ✅ |
| Expert grader prompt written | ✅ |
| 50 items generated | ✅ |
| Pre-registration document committed | ✅ |
| Grading protocol documented | ✅ |
| Review CLI built | ✅ |
| Opus pre-grading (50 items) | ⏸ pending — run `bun run scripts/hear/pre-grade.ts` |
| Human review session (50 items) | ⏸ pending — run `bun run scripts/hear/review.ts` |
| Inter-rater agreement analysis | ⏸ pending — run `bun run scripts/hear/compute-agreement.ts` |
| Disagreement resolution | ⏸ pending |
| V1 calibration set frozen | ⏸ pending |

## Running the calibration workflow

### 1. Pre-grade with Opus (automated, ~30-60 min)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
bun run scripts/hear/pre-grade.ts
```

This calls Claude Opus 4.6 for each of the 50 items and writes results to `grades/opus.json`.

### 2. Human review session

```bash
bun run scripts/hear/review.ts
```

Interactive CLI. For each item and each axis:

- `c` confirm Opus's score (fast path)
- `a` adjust — enter your own score and justification
- `n` not gradable from single artifact
- `?` help
- `q` quit (progress saved)

Sessions are resumable. Take breaks every 10 items. Spread across at least 2 days.

### 3. Compute inter-rater agreement

```bash
bun run scripts/hear/compute-agreement.ts
```

Computes Cohen's κ, Pearson r, ICC, and mean absolute difference per axis. Writes report to `analysis/v1-inter-rater.md`.

### 4. Review the report

Check that the V1 success criteria from the pre-registration document are met:

- ≥ 30 items passed disagreement resolution
- Cohen's κ ≥ 0.6 on at least 5 of 8 axes
- No axis removed or fundamentally redefined

If criteria are met, commit everything as the frozen V1 calibration set.

## Scientific foundation

The calibration set is the empirical anchor for HEAR's claim to be a calibrated evaluation framework. Without it, HEAR is just another LLM-as-judge system. With it, HEAR can claim:

1. **Convergent validity**: judge scores correlate with human expert grades
2. **Drift detection**: production judges can be monitored for deviation from ground truth
3. **Adversarial robustness**: attacks modify calibration items and score stability is measured
4. **IRT modeling**: item difficulty and discrimination are estimated from known-score items
5. **Construct validity**: factor analysis on the 8 × 50 score matrix verifies axis independence

See `../HEAR-methodology.md` for the full scientific protocol.

## V1 limitations

Documented in the pre-registration document. The main limitations are:

1. Only 2 graders (Noé + Opus pre-grades). V2 adds 2-3 external human graders.
2. Human-in-the-loop grading, not blind. V2 will compare blind vs HITL on a subset.
3. Synthetic artifacts only. V2 adds a real-artifact set (with builder consent).
4. 50 items. V2 expands to 100+.
5. No external convergent validity measures in V1. V2 correlates axes with established benchmarks.

These limitations are acceptable for V1 because the primary goal is to establish the foundation and iterate. V2 will strengthen the foundation with independent graders, real data, and external validation.
