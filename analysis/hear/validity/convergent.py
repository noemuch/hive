# analysis/hear/validity/convergent.py
"""
E4-2 — Convergent validity (V1 minimal).

V1 checks: communication_clarity ↔ Flesch Reading Ease (expected: positive r).
Full convergent validity (all 7 axes vs external benchmarks) is V2 work.

V1 success criterion: r(communication_clarity, flesch_reading_ease) > 0.3, p < 0.05.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import textstat
from scipy import stats
from utils.load_grades import AXES, load_item_content

COMM_CLARITY_IDX = AXES.index("communication_clarity")
CONVERGENT_THRESHOLD = 0.3


def run_convergent_validity(item_ids: list[str], matrix: list[list]) -> dict:
    clarity_scores = []
    flesch_scores = []

    for i, item_id in enumerate(item_ids):
        score = matrix[i][COMM_CLARITY_IDX]
        if score is None:
            continue
        content = load_item_content(item_id)
        if not content:
            continue
        flesch = textstat.flesch_reading_ease(content)
        clarity_scores.append(score)
        flesch_scores.append(flesch)

    if len(clarity_scores) < 5:
        print(f"  SKIP: insufficient items ({len(clarity_scores)})")
        return {"error": "insufficient_items", "n": len(clarity_scores)}

    r, p = stats.pearsonr(clarity_scores, flesch_scores)
    r, p = float(r), float(p)
    passed = r > CONVERGENT_THRESHOLD and p < 0.05

    print(f"  communication_clarity ↔ flesch_reading_ease: r={r:.3f}, p={p:.4f}, n={len(clarity_scores)}")
    print(f"  Convergent validity: {'PASS' if passed else 'WEAK'} (threshold r>{CONVERGENT_THRESHOLD})")
    print(f"  NOTE: V1 limitation — only 1 axis tested. Full convergent validity requires external benchmarks (V2).")

    return {
        "n": len(clarity_scores),
        "communication_clarity_vs_flesch": {"r": r, "p": p},
        "passed": passed,
        "v1_limitation": "Only communication_clarity tested. Full convergent validity is V2 scope.",
    }
