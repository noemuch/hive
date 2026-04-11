# analysis/hear/validity/irt.py
"""
E4-5 — Item Response Theory (IRT) model fitting.

Fits a 2-parameter logistic (2PL) model per axis using the girth library.
With only 50 items, IRT estimates are noisy — documented as V1 limitation.
Results are written to the irt_parameters table by generate_reports.py.

Outputs per axis:
  - difficulty (b): high = axis is hard to score well on
  - discrimination (a): high = axis cleanly separates good from bad artifacts
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import numpy as np
from girth import twopl_mml
from utils.load_grades import AXES


def _binarize(scores: list, threshold: float = 6.5) -> list[int]:
    """Convert 1-10 scores to binary (0/1) for IRT. 7+ = pass."""
    return [1 if (s is not None and s >= threshold) else 0 for s in scores]


def run_irt(item_ids: list[str], matrix: list[list]) -> dict:
    """
    Args:
        item_ids: list of item IDs
        matrix: n_items × 7 averaged scores (None = not graded)
    Returns:
        dict with IRT parameters per axis
    """
    results: dict = {"axes": {}, "n_items_fitted": 0, "warning": None}

    if len(item_ids) < 20:
        results["warning"] = "fewer than 20 items — IRT unreliable"
        print(f"  WARNING: {results['warning']}")
        return results

    total_fitted = 0

    for axis_idx, axis in enumerate(AXES):
        axis_scores = [matrix[i][axis_idx] for i in range(len(item_ids))]
        binary = _binarize(axis_scores)

        n_pass = sum(binary)
        n_fail = len(binary) - n_pass

        if n_pass < 5 or n_fail < 5:
            print(f"  SKIP {axis}: insufficient variance ({n_pass} pass, {n_fail} fail)")
            results["axes"][axis] = {"error": "insufficient_variance", "n_pass": n_pass}
            continue

        # girth twopl_mml expects (n_items, n_respondents) matrix of 0/1
        # Here we have 1 "respondent" (averaged judge) × n items
        # We treat each item as a "test question" and the judge as the "test taker"
        data = np.array(binary, dtype=float).reshape(1, -1)  # shape: (1, n_items)

        try:
            params = twopl_mml(data)
            # params[0] = discrimination (a), params[1] = difficulty (b)
            difficulty = float(np.mean(params[1]))
            discrimination = float(np.mean(params[0]))

            results["axes"][axis] = {
                "difficulty": round(difficulty, 3),
                "discrimination": round(discrimination, 3),
                "n_pass": n_pass,
                "n_fail": n_fail,
            }
            total_fitted += 1
            print(f"  {axis}: difficulty={difficulty:.3f}, discrimination={discrimination:.3f} ({n_pass} pass, {n_fail} fail)")

        except Exception as e:
            print(f"  ERROR {axis}: {e}")
            results["axes"][axis] = {"error": str(e)}

    results["n_items_fitted"] = total_fitted
    results["note"] = "V1 limitation: 50 items is below recommended minimum of 200 for stable IRT estimates. Use results directionally only."
    print(f"\n  IRT fitted {total_fitted}/7 axes")
    print(f"  NOTE: {results['note']}")

    return results
