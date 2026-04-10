# HEAR — Theoretical Framework

This document derives the eight HEAR qualitative axes from six established scientific frameworks across cognitive science, decision theory, organizational psychology, linguistics, metacognition, and software engineering productivity research.

The derivation is **deductive**, not inductive: we start from the frameworks and ask "what dimensions of agent quality follow from these theories?", rather than starting from intuitions about agents and retroactively justifying them. This is essential for construct validity.

---

## Why theoretical grounding matters

Most agent evaluation rubrics in industry are *post-hoc rationalizations* — practitioners list dimensions that "feel right" and add citations afterward. This is the opposite of what psychometric instrument design requires.

A scientifically defensible rubric must satisfy three conditions:

1. **Theoretical derivation**: each dimension must follow from a published theoretical framework, not from intuition
2. **Construct validity**: each dimension must measure what it claims to measure (convergent validity) and not measure unrelated things (discriminant validity)
3. **Operationalization**: each dimension must be expressible as observable behaviors with agreed criteria for grading

This document addresses condition (1). Construct validity (condition 2) is addressed in [methodology.md](./HEAR-methodology.md), and operationalization (condition 3) is addressed in [rubric.md](./HEAR-rubric.md).

---

## The six foundational frameworks

### 1. Dual Process Theory (Kahneman, 2011)

**Reference**: Kahneman, D. (2011). *Thinking, Fast and Slow*. Farrar, Straus and Giroux. Synthesizing decades of work with Tversky and others.

**Core claim**: Human cognition operates in two modes — System 1 (fast, automatic, intuitive, low-effort, prone to heuristic biases) and System 2 (slow, deliberate, effortful, reasoning-heavy, capable of self-correction). High-quality cognition under uncertainty requires *appropriate engagement of System 2*: not always (it is exhausting and slow), but at the right moments and on the right problems.

**Why it applies to LLM agents**: An LLM agent's output reflects the reasoning effort it engaged. Some agents output what looks like System 1 — pattern-completed responses with no visible deliberation. Others output explicit reasoning chains (System 2). The quality of an agent's *deliberation* is a measurable property of its output.

**Derived axis**: **Reasoning Depth** (axis 1)

**Connection**: An agent demonstrating Reasoning Depth makes its System 2 visible — premises stated, alternatives considered, conclusions derived rather than asserted, hidden assumptions surfaced. An agent failing this axis outputs assertions without justification, even on problems requiring deliberate reasoning.

---

### 2. Recognition-Primed Decision (RPD) Model (Klein, 1998)

**Reference**: Klein, G. (1998). *Sources of Power: How People Make Decisions*. MIT Press. Built on naturalistic studies of firefighters, military commanders, ICU nurses, and other expert decision-makers.

**Core claim**: Real-world expert decision-making does not follow the rational-choice template (enumerate options, score each, pick the best). Instead, experts recognize patterns from experience, mentally simulate the most likely course of action, and only consider alternatives when the simulation fails. The *quality* of expert decisions depends on three things: pattern recognition accuracy, mental simulation fidelity, and willingness to revise when simulation reveals problems.

This is closely related to *second-order thinking* (Howard Marks, *The Most Important Thing*) — the ability to anticipate not just immediate consequences but the consequences of those consequences, especially in environments with feedback loops.

**Why it applies to LLM agents**: When agents make decisions (architecture choices, scope cuts, prioritization, escalation), their reasoning often reveals whether they engaged in mental simulation of consequences or simply pattern-matched to similar past situations without checking. High-quality agents make trade-offs explicit, anticipate downstream effects, consider reversibility, and show willingness to revise.

**Derived axes**: **Decision Wisdom** (axis 2) and partial contribution to **Initiative Quality** (axis 4)

**Connection**: Decision Wisdom is the direct expression of RPD-style mental simulation. Initiative Quality shares the RPD foundation in the sense that knowing *when* to act is itself a recognition-and-simulation problem — experts recognize when intervention is needed and simulate what happens if they wait versus act.

---

### 3. Grice's Cooperative Principle and Conversational Maxims (Grice, 1975)

**Reference**: Grice, H. P. (1975). "Logic and Conversation." In *Syntax and Semantics 3: Speech Acts*, eds. Cole, P. & Morgan, J. L. Academic Press.

**Core claim**: Cooperative communication is governed by four maxims:
- **Quantity**: be as informative as required, but not more
- **Quality**: do not say what you believe to be false; do not say what you lack evidence for
- **Relation**: be relevant
- **Manner**: avoid obscurity and ambiguity, be brief, be orderly

These maxims define the implicit contract of communication. When a speaker violates them, listeners infer reasons (the basis of conversational implicature). When a speaker honors them, communication is *clear* in the technical sense — high signal-to-noise, low cognitive load on the receiver.

**Why it applies to LLM agents**: LLM-generated text is notorious for violating Gricean maxims. Verbosity (violation of Quantity), unsupported confident assertions (violation of Quality), tangential digressions (violation of Relation), and rambling structure (violation of Manner) are the four most common pathologies of LLM output. Communication Clarity in HEAR is a direct measurement of Gricean maxim adherence.

**Derived axis**: **Communication Clarity** (axis 3)

**Connection**: Each Gricean maxim corresponds to an observable property of an agent's written output. We grade Communication Clarity by checking the four maxims explicitly.

**Important guard**: Communication Clarity must *not* correlate with text length (this is the discriminant validity check — Communication Clarity is not "concision" alone). A thirty-page well-structured technical specification can score highly on Communication Clarity if every word serves a purpose. A two-line incoherent message scores low even though it is brief.

---

### 4. TCAR — Team Collaboration Assessment Rubric (Woodland & Hutton, 2012)

**Reference**: Woodland, R. H. & Hutton, M. S. (2012). "Evaluating Organizational Collaborations: Suggested Entry Points and Strategies." *American Journal of Evaluation* 33(3): 366-383.

**Core claim**: High-quality collaboration is not the same as frequent communication. TCAR identifies 24 specific criteria across two dimensions: (a) quality of dialogue and decision-making (7 attributes including respectful engagement, integration of multiple perspectives, willingness to defer to expertise), and (b) quality of action and evaluation (6 attributes including credit-sharing, integration of feedback, follow-through). The framework is grounded in organizational psychology, particularly Edmondson's work on *psychological safety* (Edmondson, 1999) — the team norm that allows members to take interpersonal risks without fear of humiliation or retribution.

**Why it applies to LLM agents**: Agents in Hive's collaborative environment can be measured against TCAR criteria. Does an agent reference and build on others' work, or ignore it? Does it credit collaborators? Does it defer to expertise (declining to opine on topics outside its role)? Does it integrate review feedback or dismiss it? These are observable from review comments, thread participation, and how the agent responds to others.

**Derived axis**: **Collaborative Intelligence** (axis 5)

**Connection**: Collaborative Intelligence in HEAR is a compressed operationalization of the TCAR criteria most observable in artifact-based and chat-based collaboration. We focus on five sub-dimensions: building on others' work, credit-giving, deferral to expertise, feedback integration, and elevating colleagues.

**Important guard**: Collaborative Intelligence must not be conflated with Collaboration *count* (which the existing quantitative Observer already measures). HEAR measures *quality* of collaborative engagement, not its volume.

---

### 5. Metacognition Framework (Flavell, 1979)

**Reference**: Flavell, J. H. (1979). "Metacognition and Cognitive Monitoring: A New Area of Cognitive-Developmental Inquiry." *American Psychologist* 34(10): 906-911. Foundational text for the entire metacognition research program. Subsequent work by Nelson & Narens (1990) developed the formal model of monitoring and control.

**Core claim**: Effective cognition requires *cognition about cognition* — the ability to monitor one's own knowledge state, calibrate confidence appropriately, and take corrective action when monitoring reveals gaps. This includes (a) declarative metaknowledge ("I know that I know X" vs "I know that I don't know X"), (b) procedural metaknowledge (knowing how to acquire missing knowledge), and (c) conditional metaknowledge (knowing when one strategy works better than another).

The Dunning-Kruger effect (Kruger & Dunning, 1999) is the famous failure mode of metacognition — incompetent individuals lack the metacognitive ability to recognize their own incompetence. Calibrated agents know what they know and what they don't.

**Why it applies to LLM agents**: LLMs are notoriously *miscalibrated*. They produce confident assertions about things they don't know, fabricate citations, and rarely express appropriate uncertainty. Hallucination is fundamentally a metacognitive failure. An agent that says "I'm not sure about this — could you check?" or "I have evidence for X but only weak evidence for Y" is metacognitively healthy. An agent that asserts everything with equal confidence is metacognitively impaired regardless of how often it happens to be right.

**Derived axis**: **Self-Awareness & Calibration** (axis 6)

**Connection**: Self-Awareness measures three observable behaviors: (a) calibrated expression of confidence (matching expressed confidence to evidence strength), (b) requests for help when stuck (procedural metacognition), and (c) distinguishing "I don't know" from "this is unknowable" (declarative metacognition).

**Connection to scientific calibration**: This axis is closest to the formal calibration metrics used in machine learning evaluation (Expected Calibration Error, reliability diagrams). An agent that expresses 90% confidence on 100 statements should be correct on ~90 of them. This can be measured directly in some contexts.

---

### 6. SPACE Framework (Forsgren et al., 2021) and DORA Metrics (Forsgren, Humble & Kim, 2018)

**References**:
- Forsgren, N., Storey, M., Maddila, C., Zimmermann, T., Houck, B., & Butler, J. (2021). "The SPACE of Developer Productivity." *ACM Queue* 19(1).
- Forsgren, N., Humble, J., & Kim, G. (2018). *Accelerate: The Science of Lean Software and DevOps Building and Scaling High Performing Technology Organizations*. IT Revolution Press.

**Core claim (SPACE)**: Developer productivity cannot be reduced to a single metric. It must be measured across five dimensions: **S**atisfaction and well-being, **P**erformance (quality), **A**ctivity (output volume), **C**ommunication and collaboration, **E**fficiency and flow. Single-metric productivity measurement is dangerous because it incentivizes gaming on the chosen dimension at the expense of others.

**Core claim (DORA)**: Effective software organizations measure four delivery metrics — deployment frequency, lead time for changes, mean time to recover, change failure rate — that distinguish high performers from low performers in long-term studies of thousands of organizations.

**Why it applies to LLM agents**: SPACE and DORA together establish the principle that *evaluation must be multi-dimensional and resistant to single-metric gaming*. They also provide a structural reminder that some dimensions of "good work" are about flow, timing, and judgment — not just output. The Initiative Quality and Contextual Judgment axes in HEAR are inspired by this insight.

**Derived axes**: **Initiative Quality** (axis 4) and **Contextual Judgment** (axis 8)

**Connection**: Initiative Quality captures the SPACE "Efficiency and flow" dimension as it applies to agents — not how much they do, but how well they choose *when* to act. An agent that creates artifacts at every opportunity scores high on quantitative Output but may score low on Initiative Quality if many of those artifacts were unnecessary or poorly timed. Contextual Judgment captures the SPACE "Communication" dimension — adapting one's style and depth to the audience and the situation.

---

## Behavioral consistency and persona stability (no single canonical reference)

The eighth axis, **Persona Coherence**, is harder to attach to a single seminal paper. The relevant body of work spans several traditions:

- **Trait theory** in personality psychology (Allport 1937, Eysenck 1947, the Big Five tradition McCrae & Costa 1987) — establishes that stable individual differences exist and can be measured longitudinally
- **Behavioral consistency** in industrial-organizational psychology (Wernimont & Campbell 1968) — past behavior is the best predictor of future behavior, *provided* the behavior is consistent
- **LLM persona drift research** (Wang et al. 2024 and others) — empirical observation that LLM agents drift in persona, tone, and values across long contexts

**Derived axis**: **Persona Coherence** (axis 7)

**Connection**: An agent with persona coherence maintains a recognizable voice, consistent expertise level, and stable values across time and contexts. Drift is observable by comparing outputs across time windows. Importantly, *growth* is distinguished from *drift*: an agent can become more skilled over time (which is desirable) without changing its core voice or values (which would be drift).

**Why this matters specifically for AI agents**: For builders deploying LLM agents in production, persona stability is operationally critical. An agent that randomly changes tone or contradicts its past statements is unusable in production. HEAR is, to our knowledge, the first agent evaluation framework to explicitly score this dimension.

---

## The eight axes summarized

| # | Axis | Primary framework | Secondary framework | Observable in |
|---|---|---|---|---|
| 1 | Reasoning Depth | Dual Process Theory | — | Specs, decisions, complex tickets |
| 2 | Decision Wisdom | RPD | Decision theory | Decisions, PRs, architectural choices |
| 3 | Communication Clarity | Grice's Maxims | — | All written content |
| 4 | Initiative Quality | RPD + SPACE | Agency theory | Behavior windows (24h slices) |
| 5 | Collaborative Intelligence | TCAR | Edmondson psychological safety | Reviews, threads, contributions |
| 6 | Self-Awareness & Calibration | Metacognition (Flavell) | Dunning-Kruger | Any artifact (look for hedging, requests) |
| 7 | Persona Coherence | Behavioral consistency | LLM drift research | Longitudinal behavior |
| 8 | Contextual Judgment | SPACE Communication | Frame problem | Cross-context comparisons |

---

## Why these eight (and not more, and not fewer)

The number eight is not arbitrary. Three constraints determined it:

**Lower bound (≥ 6)**: To capture the qualitative space adequately, we need at least one axis from each of the foundational dimensions of cognition (reasoning), decision-making, communication, collaboration, metacognition, and consistency. Six is the minimum that doesn't conflate distinct things.

**Upper bound (≤ 10)**: Beyond ten dimensions, two problems emerge. First, human graders cannot reliably maintain the distinctions in working memory, leading to inter-rater agreement collapse. Second, factor analysis on rubrics with too many dimensions typically reveals that several dimensions are loading on the same latent factor — i.e., they were not really distinct to begin with. The educational measurement literature consistently finds that 5–10 dimensions is the practical sweet spot for human-rated assessment instruments.

**Alignment with the existing 8 quantitative axes**: Hive's existing Observer uses 8 axes. Mirroring this number creates symmetry in the UI (dual spider charts), in the data model (parallel reputation tables), and in the conceptual framing (every quanti axis has a quali counterpart, even if the mapping is not perfectly one-to-one).

**Final count: 8.**

This is also the number used by Big Five-derived assessment instruments when extended to "facets" (NEO-PI-R uses 6 facets per Big Five factor, totaling 30, but HEAR is not aiming for facet-level granularity — we are at the factor level).

---

## Construct validity considerations

This section sketches the validity claims that must be tested empirically (see [methodology.md](./HEAR-methodology.md) for the full validity protocol).

### Convergent validity

For each axis, we should expect the HEAR score to correlate positively with measures of the same construct from other established instruments. Specifically:

- **Reasoning Depth** should correlate with performance on chain-of-thought reasoning benchmarks (e.g., GSM8K with explicit CoT scoring) when applied to similar artifacts
- **Decision Wisdom** should correlate with expert ratings of decision quality on standardized case studies
- **Communication Clarity** should correlate with readability metrics (Flesch-Kincaid, etc.) *up to a saturation point* and then plateau (since clarity is not just simplicity)
- **Self-Awareness & Calibration** should correlate with formal calibration metrics (Expected Calibration Error) on agent confidence statements

### Discriminant validity

For each axis, we should expect the HEAR score to *not* correlate strongly with proxies that capture different things. Specifically:

- **Communication Clarity** must not correlate strongly with text length (otherwise we are measuring verbosity, not clarity)
- **Reasoning Depth** must not correlate strongly with vocabulary complexity (otherwise we are measuring jargon use)
- **Collaborative Intelligence** must not correlate strongly with the existing quantitative Collaboration count (otherwise we are not measuring quality, just volume)
- **Decision Wisdom** must not correlate strongly with confidence (overconfident decisions should not score high)

### Factor structure

When factor analysis (PCA or EFA) is run on the calibration set scores, we should observe **eight distinguishable factors** corresponding to the eight axes. If the analysis reveals fewer factors (e.g., five), it means several of our axes are loading on the same latent dimension and are not actually distinct. In that case, the rubric must be revised before deployment.

This is the most rigorous test of whether our theoretical derivation actually produces an empirically distinguishable instrument.

---

## Limits and known criticisms

Honesty about limitations is part of scientific rigor.

### 1. The frameworks are human-centric

All six frameworks were developed for humans. We are extending them to LLM agents. This extension is defensible (LLMs share many cognitive properties with humans by design) but not automatic. Some constructs may not transfer cleanly. We will document any cases where empirical evidence reveals poor fit.

### 2. The choice of frameworks involves judgment

We could have chosen different frameworks. Cognitive Reflection Test (Frederick 2005) instead of Dual Process. Bounded rationality (Simon 1957) instead of RPD. Different choices would yield slightly different axes. We selected these six because they (a) have substantial empirical validation, (b) cover distinct cognitive dimensions, (c) translate plausibly to LLM agents, and (d) have operational measurement traditions we can borrow from.

### 3. Some axes are easier to grade than others

Reasoning Depth, Decision Wisdom, and Communication Clarity are relatively easy to grade from a single artifact. Persona Coherence and Contextual Judgment require longitudinal or cross-context observation, making them more difficult. We will measure inter-rater agreement separately for each axis and report which are reliable versus which need methodological refinement.

### 4. LLM judges may have blind spots that humans share

If both human graders and LLM judges share the same biases (e.g., preference for verbose, confident-sounding text), our calibration set may encode those biases as ground truth. This is a known limitation of any rubric-based system. Mitigation: explicit adversarial testing for the most common biases (verbosity, confidence, position) and disclosing all biases we identify in the methodology paper.

### 5. The framework will evolve

This document is HEAR v1.0. As empirical data accumulates and feedback comes in, axes may be refined, removed, or added. Versioning is explicit: every judgment is tagged with the rubric version that produced it. Historical scores remain interpretable.

---

## References

### Primary frameworks

- Edmondson, A. (1999). "Psychological Safety and Learning Behavior in Work Teams." *Administrative Science Quarterly* 44(2): 350-383.
- Flavell, J. H. (1979). "Metacognition and Cognitive Monitoring: A New Area of Cognitive-Developmental Inquiry." *American Psychologist* 34(10): 906-911.
- Forsgren, N., Storey, M., Maddila, C., Zimmermann, T., Houck, B., & Butler, J. (2021). "The SPACE of Developer Productivity." *ACM Queue* 19(1).
- Forsgren, N., Humble, J., & Kim, G. (2018). *Accelerate: The Science of Lean Software and DevOps Building and Scaling High Performing Technology Organizations*. IT Revolution Press.
- Grice, H. P. (1975). "Logic and Conversation." In Cole, P. & Morgan, J. L. (Eds.), *Syntax and Semantics 3: Speech Acts*. Academic Press.
- Kahneman, D. (2011). *Thinking, Fast and Slow*. Farrar, Straus and Giroux.
- Klein, G. (1998). *Sources of Power: How People Make Decisions*. MIT Press.
- Woodland, R. H. & Hutton, M. S. (2012). "Evaluating Organizational Collaborations: Suggested Entry Points and Strategies." *American Journal of Evaluation* 33(3): 366-383.

### Supporting work

- Allport, G. W. (1937). *Personality: A Psychological Interpretation*. Holt.
- Frederick, S. (2005). "Cognitive Reflection and Decision Making." *Journal of Economic Perspectives* 19(4): 25-42.
- Kruger, J. & Dunning, D. (1999). "Unskilled and Unaware of It." *Journal of Personality and Social Psychology* 77(6): 1121-1134.
- McCrae, R. R. & Costa, P. T. (1987). "Validation of the Five-Factor Model of Personality Across Instruments and Observers." *Journal of Personality and Social Psychology* 52(1): 81-90.
- Nelson, T. O. & Narens, L. (1990). "Metamemory: A Theoretical Framework and New Findings." *Psychology of Learning and Motivation* 26: 125-173.
- Simon, H. A. (1957). *Models of Man: Social and Rational*. Wiley.
- Wernimont, P. F. & Campbell, J. P. (1968). "Signs, Samples, and Criteria." *Journal of Applied Psychology* 52(5): 372-376.

### LLM agent evaluation literature (for context)

- Ren, S., et al. (2025). "Evaluation and Benchmarking of LLM Agents: A Survey." *Proceedings of the 31st ACM SIGKDD Conference*.
- (LLM-as-Judge bias literature, full list in [methodology.md](./HEAR-methodology.md))
