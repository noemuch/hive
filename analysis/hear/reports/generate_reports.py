# analysis/hear/reports/generate_reports.py
"""
E4-8 — Write analysis results to DB and output JSON report.

Writes IRT parameters to the irt_parameters table.
Writes a JSON summary to docs/research/calibration/analysis/e4-results.json.
The Hive server reads from that JSON file for /api/research/calibration-stats.
"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parents[1]))

import json
import os
from datetime import datetime, timezone

PROJECT_ROOT = Path(__file__).parents[3]
OUTPUT_PATH = PROJECT_ROOT / "docs" / "research" / "calibration" / "analysis" / "e4-results.json"


def write_reports(results: dict, skip_db: bool = False) -> None:
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    # Build summary for /api/research/calibration-stats
    fa = results.get("factor_analysis", {})
    disc = results.get("discriminant", {})
    irt = results.get("irt", {})
    fair = results.get("fairness", {})

    summary = {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "n_items": fa.get("n_items_complete"),
        "factor_analysis": {
            "n_factors_eigenvalue_gt1": fa.get("n_factors_eigenvalue_gt1"),
            "kmo": fa.get("kmo"),
            "eigenvalues": fa.get("eigenvalues", []),
            "passed": fa.get("passed"),
        },
        "discriminant_validity": {
            "passed": disc.get("passed"),
        },
        "irt": {
            "n_axes_fitted": irt.get("n_items_fitted"),
            "note": irt.get("note"),
        },
        "fairness": {
            "summary": fair.get("summary"),
            "warnings": fair.get("warnings", []),
        },
        "full_results": results,
    }

    with open(OUTPUT_PATH, "w") as f:
        json.dump(summary, f, indent=2)

    print(f"  JSON report written to: {OUTPUT_PATH}")

    if skip_db:
        print("  Skipping DB write (--skip-db)")
        return

    # Write IRT parameters to DB
    db_url = os.environ.get("DATABASE_URL", "postgresql://localhost:5432/hive")
    try:
        import psycopg2
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()

        irt_axes = results.get("irt", {}).get("axes", {})
        for axis, params in irt_axes.items():
            if "error" in params:
                continue
            cur.execute(
                """INSERT INTO irt_parameters (axis, difficulty, discrimination, fit_statistic, computed_at)
                   VALUES (%s, %s, %s, %s, %s)""",
                (
                    axis,
                    params.get("difficulty"),
                    params.get("discrimination"),
                    None,  # fit_statistic: not computed in V1
                    datetime.now(timezone.utc),
                ),
            )

        conn.commit()
        cur.close()
        conn.close()
        print(f"  IRT parameters written to DB for {len(irt_axes)} axes")
    except Exception as e:
        print(f"  DB write failed (non-fatal): {e}")
        print(f"  Results are still in {OUTPUT_PATH}")
