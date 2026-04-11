# analysis/hear/validity/discriminant.py
"""
E4-3 — Discriminant validity.

Checks that no HEAR axis correlates > 0.4 (p < 0.05) with shallow text proxies
(word count, char count, Flesch-Kincaid readability). If they do, the judge is
measuring something superficial rather than the intended construct.

V1 success criterion: No axis r > 0.4 with word_count or char_count.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import textstat
from scipy import stats
from utils.load_grades import AXES, load_item_content, item_artifact_type


PROXY_NAMES = ["word_count", "char_count", "flesch_reading_ease", "flesch_kincaid_grade"]
DISCRIMINANT_THRESHOLD = 0.4


def compute_text_proxies(content: str) -> dict:
    return {
        "word_count": len(content.split()),
        "char_count": len(content),
        "flesch_reading_ease": textstat.flesch_reading_ease(content),
        "flesch_kincaid_grade": textstat.flesch_kincaid_grade(content),
    }


def run_discriminant_validity(item_ids: list[str], matrix: list[list]) -> dict:
    """
    Args:
        item_ids: list of item IDs (e.g., '001-decision-excellent-wisdom')
        matrix: n_items × 7 averaged scores (None = not graded on that axis)
    Returns:
        dict with 'correlations' per proxy per axis, and 'passed' bool
    """
    # Compute text proxies for each item
    proxies_per_item = []
    for item_id in item_ids:
        content = load_item_content(item_id)
        if content:
            proxies_per_item.append(compute_text_proxies(content))
        else:
            proxies_per_item.append(None)

    results: dict = {"correlations": {}, "passed": True}

    for proxy_name in PROXY_NAMES:
        results["correlations"][proxy_name] = {}
        for axis_idx, axis in enumerate(AXES):
            axis_scores = []
            proxy_scores = []
            for i, item_id in enumerate(item_ids):
                if proxies_per_item[i] is None:
                    continue
                score = matrix[i][axis_idx]
                if score is not None:
                    axis_scores.append(score)
                    proxy_scores.append(proxies_per_item[i][proxy_name])

            if len(axis_scores) < 5:
                results["correlations"][proxy_name][axis] = {
                    "r": None, "p": None, "n": len(axis_scores)
                }
                continue

            r, p = stats.pearsonr(axis_scores, proxy_scores)
            r, p = float(r), float(p)
            results["correlations"][proxy_name][axis] = {"r": r, "p": p, "n": len(axis_scores)}

            # V1 success criterion: no axis r > 0.4 on word/char count
            if proxy_name in ("word_count", "char_count") and abs(r) > DISCRIMINANT_THRESHOLD and p < 0.05:
                results["passed"] = False
                print(f"  FAIL {axis} × {proxy_name}: r={r:.3f}, p={p:.3f}  ← correlates with text length")
            else:
                flag = "  OK  " if abs(r) < DISCRIMINANT_THRESHOLD else "  WARN"
                print(f"  {flag} {axis} × {proxy_name}: r={r:.3f}, p={p:.3f}")

    status = "PASS" if results["passed"] else "FAIL"
    print(f"\nDiscriminant validity: {status}")
    return results
