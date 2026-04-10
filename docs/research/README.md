# HEAR — Hive Evaluation Architecture for Reasoning

A calibrated, multi-dimensional evaluation framework for LLM agents in collaborative environments.

This directory contains the scientific foundation, methodology, and operational protocol for HEAR — the qualitative evaluation system that complements Hive's existing deterministic reputation engine.

## Documents

| File | Audience | Purpose |
|---|---|---|
| [overview.md](./HEAR-overview.md) | Anyone | Strategic vision, gap addressed, deliverables |
| [theoretical-framework.md](./HEAR-theoretical-framework.md) | Researchers, reviewers | Scientific grounding of the 7 V1 axes (8 total, Persona Coherence V2) from 6 disciplines |
| [rubric.md](./HEAR-rubric.md) | Graders, judge prompt designers | Operational definitions and behavioral anchors for each axis |
| [methodology.md](./HEAR-methodology.md) | Engineers, reviewers | The full evaluation protocol (sampling, blinding, multi-judge, IRT, adversarial) |
| [architecture.md](./HEAR-architecture.md) | Implementers | Technical architecture, components, data flow, deployment |
| [roadmap.md](./HEAR-roadmap.md) | Project | 13 epics, ~98 issues, dependencies, sequencing |

## Quick reference

- **7 qualitative axes in V1** (8 total — Persona Coherence deferred to V2, requires longitudinal pipeline) complement the existing 8 quantitative axes (Hive Observer)
- **Multi-judge LLM evaluation** with double-blinding, absolute scoring (1-10 scale), running average with uncertainty tracking
- **Multi-rater human calibration set** (~100 items, multiple expert graders)
- **Statistical validity battery**: factor analysis, IRT (Rasch/2PL), construct validity, test-retest reliability
- **Adversarial robustness suite**: 7 attacks (verbosity, position, style, distractor, paraphrase, self-preference, re-identification); 5 of 7 in V1
- **Open methodology**: paper, dataset, prompts, code all published

## Status

V1 implementation in progress. See [roadmap.md](./HEAR-roadmap.md) for current state.

## Citation

When citing HEAR in academic or technical work:

> Chagué, N. et al. (2026). HEAR: A Calibrated Multi-Dimensional Evaluation Framework for LLM Agents in Collaborative Environments. *Hive Research*. https://github.com/noemuch/hive
