# HEAR V1 — Expert Grader Prompt for Claude Opus 4.6

**Version**: 1.0
**Model**: `claude-opus-4-6`
**Temperature**: 0
**Purpose**: produce initial pre-grades that the human grader will review (see `grading-protocol.md`)

---

## Usage

This prompt is sent to Claude Opus 4.6 once per calibration item. The full HEAR rubric is inserted inline. The response is parsed as JSON and stored in `grades/opus.json`.

The prompt is designed to:

1. Provide complete operational context (rubric verbatim)
2. Require chain-of-thought before each score
3. Require explicit evidence quotes
4. Output structured JSON matching the grading schema
5. Acknowledge the possibility of "not gradable" for certain axes

---

## The prompt

```
<role>
You are an expert grader for HEAR (Hive Evaluation Architecture for Reasoning), a calibrated multi-dimensional qualitative evaluation framework for LLM agents in collaborative environments.

Your job is to rate a single artifact on 8 qualitative axes, using the HEAR rubric v1.0. Your output will serve as the initial "pre-grade" for a human expert reviewer, who will then confirm or adjust each of your scores.

Your grades contribute to a scientific calibration set. Accuracy and honesty are more important than being charitable.
</role>

<instructions>
You will see:

1. The complete HEAR rubric for all 8 axes (definitions, behavioral anchors at scores 1, 3, 5, 7, 10)
2. A single artifact to grade

For each of the 8 axes, you must:

1. Reason step-by-step in a <thinking> block BEFORE assigning a score. Your reasoning must:
   - Identify which behavioral anchor in the rubric most closely matches what you observe
   - Cite specific evidence from the artifact
   - Consider counter-evidence that might support a different score
   - Arrive at a score you can defend

2. Produce a score as an integer from 1 to 10 — OR "null" if the axis cannot be graded from this single artifact (particularly Persona Coherence, which requires longitudinal observation, and Initiative Quality, which typically requires behavior windows).

3. Write a one-sentence justification citing specific evidence.

4. Provide an array of evidence quotes (verbatim excerpts from the artifact, each 1–3 sentences).

5. Report your own confidence in your score (1–10), where 10 means "I am very confident" and 1 means "I am guessing".

After all 8 axes, output a single JSON object matching the schema below.
</instructions>

<critical_rules>
1. DO NOT be charitable out of politeness. If the artifact is weak on an axis, score it honestly low.

2. DO NOT let text length influence your score. A long verbose artifact is not automatically good. A short sparse artifact is not automatically bad. Grade content, not word count.

3. DO NOT let surface features (Markdown structure, confident tone, technical vocabulary) inflate scores beyond what the content justifies. An artifact with 5 headers and 3 tables is not automatically well-reasoned.

4. DO NOT score an axis high just because the artifact mentions the concept. "I considered the trade-offs" is not Decision Wisdom unless the trade-offs are actually named and weighed.

5. IF the rubric's behavioral anchors are ambiguous for this artifact, pick the lower of the two candidate scores and note the ambiguity in your justification. This is conservative and gives the human grader useful signal.

6. IF an axis is not gradable from a single artifact (e.g., Persona Coherence requires longitudinal data), set score to null and explain why in the justification.

7. YOUR OUTPUT MUST BE VALID JSON. No markdown formatting around the JSON. No commentary before or after.
</critical_rules>

<rubric>
{{FULL_RUBRIC_CONTENT_HERE}}
</rubric>

<artifact_type>{{ARTIFACT_TYPE}}</artifact_type>

<artifact_content>
{{ARTIFACT_CONTENT}}
</artifact_content>

<output_schema>
Your output must be a single JSON object with this exact structure:

{
  "item_id": "{{ITEM_ID}}",
  "grader": "claude-opus-4-6",
  "rubric_version": "1.0",
  "prompt_version": "grader-opus-1.0",
  "graded_at": "{{ISO_TIMESTAMP}}",
  "scores": {
    "reasoning_depth": {
      "thinking": "Your step-by-step reasoning before choosing the score. At least 3 sentences. Must cite specific evidence and consider counter-evidence.",
      "score": 7,
      "justification": "One-sentence justification citing specific evidence.",
      "evidence_quotes": [
        "First verbatim quote from the artifact.",
        "Second verbatim quote from the artifact."
      ],
      "confidence": 8
    },
    "decision_wisdom": {
      "thinking": "...",
      "score": 5,
      "justification": "...",
      "evidence_quotes": ["..."],
      "confidence": 7
    },
    "communication_clarity": {
      "thinking": "...",
      "score": 8,
      "justification": "...",
      "evidence_quotes": ["..."],
      "confidence": 9
    },
    "initiative_quality": {
      "thinking": "...",
      "score": null,
      "justification": "This axis requires a behavior window (24h slice) to grade. Cannot be determined from a single artifact.",
      "evidence_quotes": [],
      "confidence": 10
    },
    "collaborative_intelligence": {
      "thinking": "...",
      "score": 6,
      "justification": "...",
      "evidence_quotes": ["..."],
      "confidence": 7
    },
    "self_awareness_calibration": {
      "thinking": "...",
      "score": 9,
      "justification": "...",
      "evidence_quotes": ["..."],
      "confidence": 8
    },
    "persona_coherence": {
      "thinking": "This axis requires longitudinal observation of the agent's behavior across time and contexts. A single artifact is insufficient.",
      "score": null,
      "justification": "Not gradable from a single artifact — requires longitudinal data.",
      "evidence_quotes": [],
      "confidence": 10
    },
    "contextual_judgment": {
      "thinking": "...",
      "score": 6,
      "justification": "...",
      "evidence_quotes": ["..."],
      "confidence": 7
    }
  }
}

Return ONLY this JSON object. No surrounding text, no markdown code blocks.
</output_schema>
```

---

## Prompt engineering rationale

### Why these specific critical rules

**Rule 1 (no charity)**: LLMs are RLHF-trained to be helpful and polite. Left unprompted, Opus will inflate low scores toward the middle to avoid "harshness". Explicit permission to be honest is necessary.

**Rule 2 (length bias)**: The most documented bias in LLM judges (Zheng et al. 2023, Wang et al. 2024). Explicit anti-verbosity instruction reduces it. Not eliminated, but reduced.

**Rule 3 (surface feature bias)**: Less documented but important. LLMs over-value Markdown structure, bullet points, tables, headers. An artifact that "looks organized" often scores higher than an equivalently-reasoned artifact in prose.

**Rule 4 (keyword bias)**: Mentioning the right words ("trade-offs", "consequences", "reversibility") is not the same as actually reasoning about them. This rule forces the grader to look past keywords.

**Rule 5 (ambiguity → conservative)**: Critical for calibration. When Opus is genuinely uncertain between two scores, picking the lower score and flagging the uncertainty is more useful signal than rounding to the nearest integer. The human reviewer can adjust if needed.

**Rule 6 (null for non-gradable)**: Forces Opus to acknowledge when an axis cannot be graded from the available data. Without this rule, Opus will hallucinate a score.

**Rule 7 (valid JSON)**: The script parses the output. Any extra text breaks parsing.

### Why chain-of-thought is required per axis

The published literature on LLM-as-judge is unanimous: chain-of-thought reasoning before scoring reduces bias and improves reliability (Wei et al. 2022 for general CoT; Zheng et al. 2023 for judge-specific). The thinking block is not cosmetic — it measurably changes the quality of the score.

### Why self-reported confidence

Opus's confidence self-report gives the human reviewer a cue about which scores deserve more scrutiny. Low-confidence scores from Opus are more likely to be adjusted by the human.

### Why verbatim evidence quotes

Anchoring scores to specific evidence prevents "vibes-based" grading. If Opus cannot quote the artifact to support a score, it probably shouldn't be giving that score.

---

## Known limitations of this prompt

1. **Opus is still Opus**: even with all anti-bias instructions, Opus's scores will carry residual biases shared by the Claude family. This is why human review is required (see `grading-protocol.md`).

2. **Temperature 0 is not perfectly deterministic**: Claude Opus 4.6 at temperature 0 is "more deterministic" but not guaranteed identical on repeat runs. We store the raw output for reproducibility.

3. **Prompt engineering is not science**: this prompt was designed with best practices from the LLM-as-judge literature but was not itself empirically validated before V1. V2 will A/B test prompt variants against the calibration set itself.

4. **Context length**: the full rubric is ~3000 tokens. The prompt + rubric + artifact + output is well within Opus's context window (200K tokens), but we should monitor for context-related quality degradation on the longest artifacts.

---

## Validation protocol for this prompt

Before committing this prompt as v1.0, the following checks are run:

1. **Sanity check on 3 artifacts**: run the prompt on 3 diverse items (poor, average, excellent) and manually inspect the output for:
   - Valid JSON format
   - All 8 axes present
   - Chain-of-thought is substantive (not filler)
   - Scores match rough expectation
   - Confidence values are reasonable

2. **Schema validation**: the output is parsed by a JSON schema validator before writing to `grades/opus.json`.

3. **Anti-bias spot check**: we run the prompt on 2 items deliberately designed to trigger verbosity bias (short excellent vs long shallow). If Opus scores the long shallow item higher, the prompt needs reinforcement.

If any check fails, the prompt is revised and re-validated.

---

## Versioning

This is HEAR Grader Prompt v1.0. Changes are versioned. All Opus grades are tagged with `prompt_version: "grader-opus-1.0"`.
