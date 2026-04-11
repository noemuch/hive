# analysis/hear/validity/fairness.py
"""
E4-7 — Fairness analysis.

Checks score distributions by artifact_type. Computes mean ± std per axis
per type and runs a Kruskal-Wallis test to detect systematic group differences.

V1 success: no axis shows significant cross-type difference with large effect size.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

from collections import defaultdict
import numpy as np
from scipy import stats
from utils.load_grades import AXES, item_artifact_type


def run_fairness(item_ids: list[str], matrix: list[list]) -> dict:
    """
    Args:
        item_ids: list of item IDs
        matrix: n_items × 7 averaged scores (None = not graded)
    """
    # Group items by artifact type
    groups: dict[str, list[int]] = defaultdict(list)
    for idx, item_id in enumerate(item_ids):
        artifact_type = item_artifact_type(item_id)
        groups[artifact_type].append(idx)

    print(f"  Artifact types: { {k: len(v) for k, v in groups.items()} }")

    results: dict = {"by_type": {}, "kruskal_wallis": {}, "summary": ""}
    warnings = []

    for axis_idx, axis in enumerate(AXES):
        # Mean ± std per group
        axis_by_type: dict[str, list[float]] = {}
        for artifact_type, indices in groups.items():
            scores = [matrix[i][axis_idx] for i in indices if matrix[i][axis_idx] is not None]
            if scores:
                axis_by_type[artifact_type] = scores

        results["by_type"][axis] = {
            t: {"mean": round(float(np.mean(s)), 3), "std": round(float(np.std(s)), 3), "n": len(s)}
            for t, s in axis_by_type.items()
        }

        # Kruskal-Wallis test (non-parametric, works on small samples)
        groups_scores = [s for s in axis_by_type.values() if len(s) >= 2]
        if len(groups_scores) >= 2:
            h, p = stats.kruskal(*groups_scores)
            results["kruskal_wallis"][axis] = {"H": round(float(h), 3), "p": round(float(p), 4)}
            flag = " ⚠️ significant group diff" if p < 0.05 else ""
            print(f"  {axis}: H={h:.2f}, p={p:.4f}{flag}")
            if p < 0.05:
                warnings.append(f"{axis} shows significant cross-type difference (may be genuine quality signal)")
        else:
            results["kruskal_wallis"][axis] = {"error": "insufficient_groups"}

    results["summary"] = f"{len(warnings)} axes with cross-type differences" if warnings else "No systematic bias detected"
    results["warnings"] = warnings
    print(f"\n  Fairness: {results['summary']}")

    return results
