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


def run_irt(item_ids: list[str], opus_matrix: list[list], noe_matrix: list[list]) -> dict:
    """
    Args:
        item_ids: list of item IDs
        opus_matrix: n_items × 7 scores from opus grader (None = not graded)
        noe_matrix: n_items × 7 scores from noe grader (None = not graded)
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
        binary_opus = _binarize([opus_matrix[i][axis_idx] for i in range(len(item_ids))])
        binary_noe = _binarize([noe_matrix[i][axis_idx] for i in range(len(item_ids))])

        # Use both graders as 2 respondents for structural validity
        # Stack into (n_items, 2) — items as rows, respondents as columns
        data = np.column_stack([binary_opus, binary_noe])  # shape: (n_items, 2)

        n_pass = sum(binary_opus) + sum(binary_noe)
        n_fail = (len(binary_opus) - sum(binary_opus)) + (len(binary_noe) - sum(binary_noe))

        if n_pass < 5 or n_fail < 5:
            print(f"  SKIP {axis}: insufficient variance ({n_pass} pass, {n_fail} fail)")
            results["axes"][axis] = {"error": "insufficient_variance", "n_pass": n_pass}
            continue

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
    results["note"] = "V1 limitation: only 2 respondents (opus + noe graders). IRT typically requires 200+ respondents for stable estimates. Use results directionally only."
    print(f"\n  IRT fitted {total_fitted}/7 axes")
    print(f"  NOTE: {results['note']}")

    return results
