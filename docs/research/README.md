# HEAR — Hive Evaluation Architecture for Reasoning

A calibrated, multi-dimensional evaluation framework for LLM agents in collaborative environments.

## Validation Results (V1)

Two independent graders (structural reader + skeptical reader) evaluated 50 calibration items across 7 axes:

| Axis | Cohen's κ | Pearson r | ICC | Mean Abs Diff |
|------|-----------|-----------|-----|---------------|
| Reasoning Depth | 0.848 | 0.953 | 0.909 | 1.02 |
| Decision Wisdom | 0.814 | 0.955 | 0.897 | 1.06 |
| Communication Clarity | 0.870 | 0.964 | 0.935 | 1.04 |
| Initiative Quality | N/A | N/A | N/A | N/A |
| Collaborative Intelligence | 0.783 | 0.962 | 0.910 | 1.24 |
| Self-Awareness & Calibration | 0.746 | 0.946 | 0.884 | 1.58 |
| Contextual Judgment | 0.814 | 0.907 | 0.888 | 1.00 |

**Interpretation:** κ > 0.8 = excellent, 0.6–0.8 = substantial. All 6 active axes exceed the pre-registered success threshold of κ ≥ 0.6. Initiative Quality requires behavioral windows (longitudinal data) and is expected to be N/A on single-artifact evaluation.

[Full inter-rater report →](calibration/analysis/v1-inter-rater.md)

## Documents

| File | Audience | Purpose |
|------|----------|---------|
| [HEAR-overview.md](HEAR-overview.md) | Anyone | Strategic vision, gap addressed |
| [HEAR-theoretical-framework.md](HEAR-theoretical-framework.md) | Researchers | 7 axes derived from 6 scientific frameworks |
| [HEAR-rubric.md](HEAR-rubric.md) | Graders | Behavioral anchors (BARS) for each axis |
| [HEAR-methodology.md](HEAR-methodology.md) | Engineers | Evaluation protocol: sampling, blinding, multi-judge, IRT, adversarial |
| [HEAR-architecture.md](HEAR-architecture.md) | Implementers | Technical system design |
| [HEAR-roadmap.md](HEAR-roadmap.md) | Project | Epics, issues, sequencing |

## Calibration Data

All calibration materials are open source:

- [50 calibration items](calibration/items/) — synthetic artifacts covering 6 types × diverse quality levels
- [Grading protocol](calibration/grading-protocol.md) — psychometric SOP (fatigue limits, anti-bias rules)
- [Grader prompt](calibration/grader-prompt-opus.md) — exact prompt template (v1.0)
- [Pre-registration](calibration/pre-registration.md) — binding hypotheses and success criteria
- [Grader A scores](calibration/grades/grader-a.json) — structural reader (Opus)
- [Grader B scores](calibration/grades/grader-b.json) — skeptical reader (Opus, independent)
- [Agreement analysis](calibration/analysis/v1-inter-rater.md) — κ, ICC, Pearson r per axis

## Adversarial Robustness

6 attacks tested against the judge ([`scripts/hear/adversarial.ts`](../../scripts/hear/adversarial.ts)):

1. **Verbosity** — filler sentences (threshold: Δ ≤ 1.5)
2. **Position** — content reordering (threshold: Δ ≤ 1.0)
3. **Distractor** — irrelevant high-sounding paragraph (threshold: Δ ≤ 1.5)
4. **Paraphrase** — mechanical synonym substitution (threshold: Δ ≤ 1.5)
5. **Re-identification** — identity hints injected (threshold: Δ ≤ 0.5)
6. **Contamination** — canary GUID detection (threshold: 0, zero tolerance)

## Anti-Contamination

52 evaluation documents contain [canary watermarks](calibration/canary-manifest.json). If a GUID appears in any model output, it proves training data contamination.

## Known Limitations (V1)

- Two graders are both Opus instances (shared model biases possible). V2 adds human grader + second model family.
- Calibration items are synthetic. V2 adds real agent-produced artifacts.
- Initiative Quality and Persona Coherence require longitudinal data (deferred to V2).
- Blinding is token-level only (writing style not scrubbed).

## Citation

> Chagué, N. (2026). HEAR: A Calibrated Multi-Dimensional Evaluation Framework for LLM Agents in Collaborative Environments. https://github.com/noemuch/hive
