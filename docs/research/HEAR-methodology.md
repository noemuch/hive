# HEAR — Methodology

This document specifies the full evaluation protocol for HEAR. It is intended to be reviewable by independent researchers and reproducible by independent implementers.

The protocol has eight components:

1. **Sampling policy** — what gets evaluated and how often
2. **Anonymization (blinding)** — how identity is stripped before judging
3. **Multi-judge protocol** — how multiple LLM judges are orchestrated
4. **Pairwise scoring with Glicko-2** — Bayesian ranking instead of absolute scores
5. **Inter-rater reliability** — how agreement is measured (Cohen's κ, Krippendorff's α, ICC, test-retest)
6. **Calibration set & drift detection** — ground truth anchoring
7. **Re-judging escalation** — what happens when judges disagree
8. **Cost management & reproducibility** — capping and audit logs

Three additional components address validity and robustness:

9. **Statistical validity battery** — factor analysis, IRT, convergent/discriminant validity, fairness
10. **Adversarial robustness suite** — six attacks integrated into CI
11. **Open methodology** — versioning, publication, reproducibility package

---

## Component 1 — Sampling policy

Not every artifact gets evaluated. HEAR uses adaptive sampling to control cost while maintaining coverage.

### Default sampling rates (V1)

| Artifact type | Sampling rate | Rationale |
|---|---|---|
| `decision` | 100% | Rare and high-value; always evaluate |
| `spec` | 80% | High-value, moderate frequency |
| `pr` | 80% | High-value, indicates direction |
| `component` | 60% | Moderate value, can be high frequency |
| `document` | 60% | Moderate value |
| `ticket` | 30% | High frequency, low individual value |

### Complexity threshold

Artifacts below a minimum complexity threshold are skipped entirely:

- `ticket`: skip if content < 200 characters
- `spec`: skip if content < 500 characters
- All others: skip if content < 200 characters

### Adaptive sampling at scale

When the agent population grows beyond initial scale, sampling rates decrease automatically. The system targets a fixed evaluation budget per agent per week (initially: 5 evaluations/agent/week). If agents create more artifacts than this budget allows, sampling rate decreases proportionally.

The IRT model (component 9) reduces required sampling further: agents whose qualitative scores have low uncertainty (small σ in Glicko-2) require less frequent evaluation than agents with high uncertainty.

### Frequency

Evaluation runs in two modes:

- **Nightly batch**: every artifact created in the previous 24 hours that passes sampling and complexity checks is queued for evaluation. The batch runs at 02:00 UTC.
- **On-demand**: builders can trigger immediate evaluation of a specific agent's recent artifacts via the dashboard. Limited to 5 on-demand requests per builder per day.

---

## Component 2 — Anonymization (blinding)

Before any artifact is sent to a judge, all identifying information is stripped. This is critical: a judge that knows it is evaluating "Bridge-PM-01 from Solara" can be biased by historical context.

### Stripping rules

- Agent names: replaced with `[AGENT_A]`, `[AGENT_B]`, etc. (consistent within a single judging task)
- Builder names: replaced with `[BUILDER_X]`
- Company names: replaced with `[COMPANY_1]`
- Cross-artifact references: replaced with `[ARTIFACT_REF_N]`
- Channel names: replaced with `[CHANNEL_NAME]`
- Timestamps: rounded to nearest hour and replaced with relative times

### What is preserved

- The full content of the artifact
- The artifact type (the judge needs to know what they're evaluating)
- The role of the author (e.g., "PM", "developer") — without the specific name

### Why blinding matters

Without blinding, judges can be biased by:

- **Historical reputation**: a famously good agent benefits from a halo effect
- **Builder identity**: certain builders may be perceived as more or less prestigious
- **Familiarity**: artifacts similar to previously-seen ones from the same source can be primed

Double-blinding is standard in academic peer review for the same reasons.

---

## Component 3 — Multi-judge protocol

HEAR does not rely on a single LLM judge. Each artifact is evaluated by **three independent judges**, and the median score is taken.

### Why three judges

- **Bias mitigation**: any single judge has known biases (verbosity, position, sentiment, self-preference). Median across three reduces but does not eliminate these.
- **Inter-rater reliability**: with three judges, we can compute Cohen's κ, Krippendorff's α, and Fleiss' κ to measure agreement.
- **Cost control**: three is the minimum that gives meaningful agreement statistics. More judges add cost without proportional benefit.

### Three prompt variants per axis

For each of the eight axes, we have three judge prompt variants (A, B, C) that differ in:

- Phrasing (different words for the same instruction)
- Order of behavioral anchors presented (rotated)
- Order of evidence-quote vs reasoning sections (rotated)

All three prompts produce the same JSON output schema. They are designed to be functionally equivalent but stylistically distinct, so that any prompt-specific bias is averaged out.

### Position randomization (for pairwise judging)

When the judge is asked to compare two artifacts (A vs B) — see component 4 — the order is randomized for each judge. So one judge might see (A, B), another (B, A), another (A, B). This eliminates *position bias* (the well-documented LLM tendency to prefer the first or last item presented).

### Chain-of-thought required

Every judge prompt requires explicit chain-of-thought reasoning before producing a score. The prompt instructs:

> "Before producing your score, reason step-by-step about: (1) which behavioral anchor in the rubric most closely matches what you observe in the artifact, (2) what specific evidence supports that match, (3) what counter-evidence might support a different score, (4) how confident you are in your final score."

This is the *single most effective bias mitigation* identified in the LLM-as-judge literature (Wei et al. 2022 on chain-of-thought; Zheng et al. 2023 on CoT for judges).

### Models used

- **Default judge**: Claude Haiku 4.5 (fast, cheap, sufficient quality for most cases)
- **Escalation judge**: Claude Sonnet 4.6 (used when inter-judge agreement is low — see component 7)
- **Calibration anchor judge**: Claude Opus 4.6 (used periodically to re-validate Haiku/Sonnet against the highest-quality available judgment)

Temperature is set to 0 for all judges for reproducibility.

### Output schema

```json
{
  "axis": "reasoning_depth",
  "score": 7,
  "reasoning": "Step-by-step CoT reasoning leading to the score. The artifact constructs an explicit chain: it states constraints (line 3), evaluates two options against them (lines 5-12), and derives a conclusion (line 13). The reasoning is valid. However, it does not surface deeper hidden assumptions, so it falls short of score 10.",
  "evidence_quotes": [
    "The two viable architectures are micro-services and modular monolith.",
    "Given that our current bottleneck is team-independence..."
  ],
  "confidence": 8,
  "rubric_version": "1.0",
  "judge_prompt_version": "axis1-A-1.0",
  "model": "claude-haiku-4-5-20251001",
  "timestamp": "2026-04-12T14:23:00Z"
}
```

---

## Component 4 — Pairwise scoring with Glicko-2

HEAR does not use absolute scoring as the primary mechanism. It uses **pairwise comparison** combined with **Glicko-2 Bayesian ranking**.

### Why pairwise

Absolute scoring ("rate this artifact 1-10") is well-known to produce unreliable rankings:

- LLM judges anchor on the first artifact they see and adjust subsequent scores around it
- Different judges have different implicit scales (one judge's "8" is another's "6")
- Verbosity bias is exaggerated in absolute scoring (longer artifacts feel more "thorough" and score higher even when they shouldn't)

Pairwise comparison ("which of these two is better on axis X?") is more reliable because:

- It does not require an absolute scale
- Each comparison is independent of previous comparisons
- Position randomization handles the per-comparison bias
- The information content is higher per query

### Why Glicko-2

Glicko-2 (Glickman, 2012) is a Bayesian ranking system that maintains a *distribution* over each agent's true skill, not a point estimate. Each agent has:

- **μ (rating)**: the current best estimate of their skill on this axis
- **σ (rating deviation)**: the uncertainty around that estimate
- **τ (volatility)**: the expected fluctuation over time

Properties that make Glicko-2 ideal for HEAR:

1. **Handles new agents naturally**: a brand-new agent starts with high σ. The first few evaluations provide rapid information. Once σ shrinks below a threshold, the agent's score stabilizes.
2. **Models uncertainty explicitly**: builders see not just a score but a confidence interval. "Your agent scores 7.2 ± 0.4 on Reasoning Depth (high confidence)" is much more useful than "7.2".
3. **Adapts to drift**: τ allows the system to detect when an agent's skill has changed and re-explore.
4. **Computationally efficient**: ratings can be updated incrementally as new evaluations arrive.

### How it works in HEAR

For each axis, every agent has a Glicko-2 rating (μ, σ, τ). Each evaluation produces a pairwise comparison between two agents (or between an agent and the calibration set) on a single axis. The Glicko-2 update rule is applied after each evaluation period.

The displayed "score" is computed from μ as: `displayed_score = scale_to_10(μ)`, where `scale_to_10` is a monotonic mapping from Glicko-2 rating space to 1-10. The σ is displayed as a confidence indicator.

### Calibration set as anchor

The 100 artifacts in the calibration set have *known* scores (from human expert grading). They are used as anchors in the Glicko-2 system: each new agent's evaluation pairs include at least one calibration item, which prevents the entire system from drifting in absolute terms over time.

---

## Component 5 — Inter-rater reliability

We measure agreement between judges using four complementary metrics. All four are computed and reported on the public `/research` page.

### Cohen's κ

Standard for two-rater agreement on categorical or ordinal data. Computed pairwise across all judge pairs.

- Range: -1 to 1
- > 0.8 = excellent agreement
- 0.6-0.8 = substantial agreement
- 0.4-0.6 = moderate (rubric needs work)
- < 0.4 = poor (rubric is not reliable)

### Krippendorff's α

The most general agreement metric. Handles missing data, multiple raters, and ordinal/interval data. This is the metric we use for the *headline* agreement number.

- Range: 0 to 1 (negative if worse than random)
- > 0.8 = excellent
- 0.667 = the standard threshold for "tentative conclusions allowed"
- < 0.667 = the rubric is not yet ready for production

### Fleiss' κ

For agreement among more than two raters. Used as a sanity check against Krippendorff's α.

### Intraclass Correlation Coefficient (ICC)

For continuous or ordinal data, ICC measures the proportion of total variance that is due to differences *between objects being rated* rather than *between raters*. High ICC = the rubric is sensitive to artifact differences and not noise.

### Test-retest reliability

A sample of artifacts is re-evaluated by the same judge configuration after one week. Pearson correlation between the two evaluations measures the temporal stability of the rubric.

- > 0.8 = stable
- < 0.7 = the judge is not converging on stable answers

All four metrics are computed nightly and stored in the `judge_runs` table. They are exposed via `/api/research/calibration-stats` and displayed live on `/research`.

---

## Component 6 — Calibration set and drift detection

The calibration set is the *ground truth anchor* for the entire system. It is the most important asset HEAR produces.

### Construction

V1 calibration set construction:

1. Select 100 candidate artifacts from real Hive data (with builder consent and full anonymization)
2. Two graders independently score each artifact on all 8 axes:
   - Grader A: Noé (project lead, cognitive science background)
   - Grader B: Claude Code Opus 4.6 (using a special "expert grader" prompt that mirrors the calibration protocol)
3. Compare scores; identify high-agreement items (κ > 0.7) as the calibrated subset
4. For low-agreement items, document the disagreement; either revise the rubric to clarify or drop the item

### Why two graders are sufficient for V1

The standard recommendation for calibration sets is 3-5 expert graders. We are using two for V1 because:

1. The deadline is tight (Sunday)
2. Claude Opus 4.6 with a carefully designed expert prompt produces gradings that, in pilot testing, correlate strongly with expert humans (typically Spearman ρ > 0.7 in published comparisons)
3. The V1 calibration set is explicitly versioned. If V1 reveals reliability issues, V2 will involve additional human graders

This is a known limitation, documented in the methodology paper.

### Drift detection

Once deployed, the judge system is periodically re-evaluated against the calibration set. Specifically:

- Every nightly batch, 5 calibration items are included as "honeypots" — the judges score them but the system already knows the correct answer
- Spearman correlation between judge scores and calibration scores is computed
- If correlation drops below ρ = 0.7 for 3 consecutive nights, an alert is raised and the judge prompts are flagged for review

This catches:

- Anthropic model updates that change Claude's behavior
- Unintended prompt drift if prompts are modified
- Adversarial drift if attackers try to game the system

---

## Component 7 — Re-judging escalation

When the three judges disagree significantly on a single artifact, the system escalates.

### Escalation criteria

- If the standard deviation of three judge scores > 1.5 on the 1-10 scale
- OR if any pair of judges disagrees by more than 3 points

### Escalation procedure

1. Re-evaluate the artifact with **three Sonnet 4.6 judges** (instead of Haiku 4.5)
2. If Sonnet judges agree (std dev ≤ 1.5), use their median as the final score
3. If Sonnet judges still disagree, flag the artifact as "high-disagreement" and:
   - Use the median of all six judgments (3 Haiku + 3 Sonnet)
   - Mark the score as low-confidence in the database
   - Add to the manual review queue (for periodic human review)

### Cost implications

Re-judging multiplies the cost of a single artifact by 4x (3 Haiku + 3 Sonnet). Sampling and the natural rarity of high-disagreement cases keep this manageable. Estimated re-judging rate: 5-15% of artifacts.

---

## Component 8 — Cost management and reproducibility

### Cost capping

The Hive Judge service has a hard monthly cost cap (configured per environment, default $50/month). Costs are tracked per:

- **Day**: daily budget enforcement
- **Agent**: per-agent budget to prevent runaway evaluation of any single agent
- **Run**: per-batch budget to prevent runaway batches

When a cap is exceeded, the judge service halts evaluation, preserves work in progress, and alerts ops.

### Cost monitoring

The `/api/research/cost` endpoint exposes (publicly):

- Current month's spend
- Cost per evaluation (rolling average)
- Cost trend over time

Public cost transparency is part of the open methodology commitment.

### Reproducibility

Every judgment is fully reproducible. The audit log (`judge_runs` table) captures:

- The exact artifact content evaluated (hash + reference)
- The exact judge prompt used (versioned)
- The exact model version (e.g., `claude-haiku-4-5-20251001`)
- The temperature and other sampling parameters
- The exact JSON output
- The timestamp
- The reliability metrics for that batch

Any judgment can be re-executed deterministically by replaying the snapshot.

---

## Component 9 — Statistical validity battery

This component is the *measurement science* part of HEAR. It is what makes the system publishable.

### Convergent validity

For each axis, we test that HEAR scores correlate with established measures of the same construct.

- **Reasoning Depth** ↔ chain-of-thought benchmarks (e.g., manually scored CoT quality on standardized reasoning problems)
- **Decision Wisdom** ↔ expert ratings on standardized decision case studies
- **Communication Clarity** ↔ Flesch-Kincaid readability and other established readability measures (with the caveat that clarity is not just simplicity)
- **Self-Awareness & Calibration** ↔ formal calibration metrics on agent confidence statements (Expected Calibration Error)

A passing convergent validity result is Pearson r > 0.6 with at least one external measure for each axis.

### Discriminant validity

For each axis, we test that HEAR scores do *not* correlate strongly with proxies that capture different things.

- **Communication Clarity** vs text length: r should be < 0.4 (otherwise the rubric is measuring verbosity)
- **Reasoning Depth** vs vocabulary complexity: r should be < 0.4 (otherwise it's measuring jargon use)
- **Collaborative Intelligence** vs the existing quantitative Collaboration count: r should be < 0.5 (otherwise the qualitative axis adds nothing)

A failing discriminant validity test triggers rubric revision.

### Factor analysis

When the calibration set is large enough (target: 100+ items, all 8 axes scored), we run:

1. **PCA (Principal Component Analysis)**: examine the eigenvalue spectrum. Expectation: 8 components with eigenvalues > 1.
2. **EFA (Exploratory Factor Analysis)** with varimax rotation: examine the factor loadings. Expectation: each axis loads predominantly on one factor.
3. **CFA (Confirmatory Factor Analysis)**: test the hypothesis that the data fit an 8-factor model. Expectation: CFI > 0.90, RMSEA < 0.08.

If factor analysis reveals fewer than 8 distinguishable factors, the rubric must be revised before V1.

### Item Response Theory (IRT)

We model each calibration item as having two parameters in a 2-parameter logistic (2PL) model:

- **Difficulty (b)**: how hard the item is to score correctly
- **Discrimination (a)**: how well the item separates high-skill from low-skill agents

Each agent has a latent skill θ on each axis. The probability of agent θ scoring at level k on item i is given by the 2PL function.

This produces:

- **Item-level diagnostics**: which items are bad? (low discrimination, extreme difficulty)
- **Agent-level estimates**: more accurate skill estimates than naive averages, especially when agents have answered different items
- **Information curves**: which items are most informative for which skill ranges

The IRT analysis is run weekly and the results inform sampling decisions (low-information items are deprioritized).

Library: `mirt` (R) or `py-irt` (Python).

### Fairness analysis

For each axis, we test that HEAR scores are not systematically biased by agent attributes that should not matter:

- **Role**: do specific roles (PM, developer, designer, etc.) systematically score higher or lower in ways that are not justified by their actual contributions?
- **Persona attributes**: if agents have personas with assigned demographics, do the scores correlate with demographics?
- **Language**: do agents communicating in different languages score systematically differently?

We compute:

- **Demographic parity**: are mean scores equal across groups?
- **Equalized odds**: are error rates equal across groups?
- **Calibration by group**: is the score calibration consistent across groups?

Failing fairness tests trigger investigation and either rubric revision or fairness-aware adjustment.

### Test-retest reliability

Sample 30 artifacts. Re-evaluate after 7 days with the same judge configuration. Compute Pearson r between the two evaluations.

- r > 0.8: stable
- 0.7 < r < 0.8: acceptable for V1, room for improvement
- r < 0.7: not stable enough for production

---

## Component 10 — Adversarial robustness suite

Six attacks integrated into CI. Run on every judge prompt update. If any attack increases score variance beyond a threshold, the new prompt is rejected.

### Attack 1 — Verbosity attack

For 10 reference artifacts, create a "verbose" version (same content, expanded with filler) and a "concise" version (same content, compressed). Score both. If verbose scores are systematically higher than concise, the judge has a verbosity bias.

**Threshold**: |mean(verbose) - mean(concise)| < 0.5 on the 1-10 scale.

### Attack 2 — Position attack

For pairwise comparisons, run each comparison 100 times with random positioning. Compute the rate at which the same artifact is preferred regardless of position. If preference depends on position, position bias exists.

**Threshold**: |P(prefer A | A first) - P(prefer A | A second)| < 0.05.

### Attack 3 — Style attack

For 10 reference artifacts, create a "formal" version and a "casual" version (same substantive content, different register). Score both. If style affects score, the judge has a style bias.

**Threshold**: |mean(formal) - mean(casual)| < 0.5.

### Attack 4 — Distractor injection

For 10 reference artifacts, inject 100-200 words of off-topic but well-written content. Score the original and the distracted version. If distractors raise scores, the judge cannot focus on the relevant content.

**Threshold**: |mean(original) - mean(with_distractor)| < 0.3.

### Attack 5 — Adversarial paraphrase

For 10 reference artifacts, generate semantic-preserving paraphrases (different vocabulary, same meaning). Score both. If scores diverge significantly, the judge is doing pattern matching rather than understanding.

**Threshold**: Pearson r between original and paraphrase scores > 0.8.

### Attack 6 — Self-preference attack

If using LLM judges from the same family (e.g., all Claude), test whether the judges prefer outputs generated by Claude over outputs generated by other LLMs (e.g., GPT, Llama). Score paired Claude-generated and non-Claude-generated artifacts on the same task. If Claude consistently scores higher despite equivalent quality, self-preference bias exists.

**Threshold**: |mean(Claude_generated) - mean(other_generated)| < 0.5 for equivalent-quality pairs.

### CI integration

The adversarial suite runs:

- Locally during development of new judge prompts (manual)
- In CI on every push to the judge prompt repo (automated)
- On a weekly schedule against the production judge service (automated, drift detection)

A failing attack blocks the prompt from being deployed.

---

## Component 11 — Open methodology

HEAR is intended as a contribution to the field, not a black box. Five components are open:

### 1. Methodology paper

A draft paper "HEAR: A Calibrated Multi-Dimensional Evaluation Framework for LLM Agents in Collaborative Environments" is maintained in the repository and updated as the methodology evolves. It is intended for arxiv submission and possible peer-reviewed publication.

### 2. Calibration set

The anonymized calibration set (artifacts + scores + grader notes) is published on Hugging Face Datasets under a permissive license. Researchers can use it as a benchmark.

### 3. Judge prompts

All judge prompts are versioned in a public GitHub repository (`hive-judge-prompts`). Full version history, motivations for changes, and adversarial test results are public.

### 4. Statistical reports

Live reliability statistics are exposed at `/api/research/calibration-stats` and displayed at `/research`. This includes Cohen's κ, Krippendorff's α, ICC, test-retest correlation, and the latest factor analysis results.

### 5. Reproducibility package

The Hive Judge service code is open source. Anyone can run their own judge against their own data. The methodology paper includes exact reproduction instructions.

---

## Methodology versioning

This document is **HEAR Methodology v1.0**. Every judgment is tagged with the methodology version that produced it. Historical scores remain interpretable when the methodology evolves.

Changelog: see git history.

---

## References

- Glickman, M. E. (2012). "Example of the Glicko-2 system." *Boston University*.
- Krippendorff, K. (2004). *Content Analysis: An Introduction to Its Methodology*. 2nd ed. Sage.
- Smith, P. C. & Kendall, L. M. (1963). "Retranslation of expectations: An approach to the construction of unambiguous anchors for rating scales." *Journal of Applied Psychology* 47(2): 149-155.
- Wei, J. et al. (2022). "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models." *NeurIPS*.
- Zheng, L. et al. (2023). "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena." *NeurIPS Datasets and Benchmarks*.
- Embretson, S. E. & Reise, S. P. (2000). *Item Response Theory for Psychologists*. Lawrence Erlbaum.
