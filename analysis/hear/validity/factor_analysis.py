# analysis/hear/validity/factor_analysis.py
"""
E4-4 — PCA + Exploratory Factor Analysis.

Tests whether the 7 HEAR axes measure distinct constructs.
V1 success criterion: at least 5 factors with eigenvalue > 1 (Kaiser criterion).
Full 7 factors expected; fewer indicates rubric overlap.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler
from sklearn.decomposition import PCA
from factor_analyzer import FactorAnalyzer
from factor_analyzer.factor_analyzer import calculate_kmo, calculate_bartlett_sphericity
from utils.load_grades import AXES


def run_factor_analysis(item_ids: list[str], matrix: list[list]) -> dict:
    """
    Args:
        item_ids: list of item IDs
        matrix: n_items × 7 averaged scores (None = not graded on that axis)
    Returns:
        dict with PCA + EFA results
    """
    df = pd.DataFrame(matrix, columns=AXES, index=item_ids)
    df_complete = df.dropna()

    print(f"  Items with complete scores (all 7 axes): {len(df_complete)} / {len(df)}")

    if len(df_complete) < 20:
        print("  WARNING: fewer than 20 complete items — factor analysis unreliable")
        return {
            "error": "insufficient_complete_items",
            "n_complete": len(df_complete),
        }

    # KMO + Bartlett's sphericity (prerequisite checks)
    kmo_all, kmo_model = calculate_kmo(df_complete)
    chi2, p = calculate_bartlett_sphericity(df_complete)
    print(f"  KMO adequacy: {kmo_model:.3f}  (>0.6 acceptable, >0.8 good)")
    print(f"  Bartlett sphericity: χ²={chi2:.1f}, p={p:.4f}  (<0.05 required)")

    # PCA — how many components explain variance
    scaler = StandardScaler()
    X = scaler.fit_transform(df_complete)
    pca = PCA()
    pca.fit(X)
    explained = pca.explained_variance_ratio_
    cumulative = np.cumsum(explained)

    print(f"\n  PCA explained variance:")
    for i, (v, c) in enumerate(zip(explained, cumulative)):
        marker = " ←" if i == 6 else ""
        print(f"    PC{i+1}: {v*100:.1f}%  (cumulative {c*100:.1f}%){marker}")

    # EFA — varimax rotation, 7 factors
    fa = FactorAnalyzer(n_factors=min(7, len(df_complete) - 1), rotation="varimax")
    fa.fit(df_complete)
    # get_eigenvalues() returns initial eigenvalues from the correlation matrix
    # (pre-rotation) — this is the correct source for the Kaiser criterion (eigenvalue > 1)
    eigenvalues, _ = fa.get_eigenvalues()
    n_factors_gt1 = sum(1 for e in eigenvalues if e > 1)
    loadings = fa.loadings_

    print(f"\n  EFA eigenvalues (Kaiser criterion > 1): {n_factors_gt1} factors")
    for i, e in enumerate(eigenvalues[:8]):
        marker = "  >" if e > 1 else "   "
        print(f"  {marker} Factor {i+1}: {e:.3f}")

    print(f"\n  Factor loadings (varimax rotation):")
    print(f"  {'Axis':<35} " + " ".join(f"F{j+1:>5}" for j in range(min(7, len(eigenvalues)))))
    for i, axis in enumerate(AXES):
        row = "  " + axis.ljust(35) + " ".join(f"{loadings[i][j]:>6.3f}" for j in range(min(7, loadings.shape[1])))
        print(row)

    # Success criterion
    passed = n_factors_gt1 >= 5
    print(f"\n  Factor analysis {'PASS' if passed else 'NEEDS RUBRIC REVIEW'}: {n_factors_gt1} factors with eigenvalue > 1")

    return {
        "n_items_complete": int(len(df_complete)),
        "kmo": float(kmo_model),
        "bartlett_chi2": float(chi2),
        "bartlett_p": float(p),
        "pca_explained_variance": [float(v) for v in explained],
        "n_factors_eigenvalue_gt1": int(n_factors_gt1),
        "eigenvalues": [float(e) for e in eigenvalues],
        "efa_loadings": {
            axis: [float(loadings[i][j]) for j in range(min(7, loadings.shape[1]))]
            for i, axis in enumerate(AXES)
        },
        "passed": passed,
    }
