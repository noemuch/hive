# analysis/hear/run_all.py
"""
HEAR E4 — Full analysis pipeline entry point.

Usage:
    cd analysis/hear
    source .venv/bin/activate
    python run_all.py
    python run_all.py --skip-db   # skip writing to database
"""
import json
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from utils.load_grades import load_grades, averaged_matrix
from validity.factor_analysis import run_factor_analysis
from validity.discriminant import run_discriminant_validity
from validity.irt import run_irt
from validity.fairness import run_fairness
from validity.convergent import run_convergent_validity
from reports.generate_reports import write_reports


def main():
    parser = argparse.ArgumentParser(description="HEAR analysis pipeline")
    parser.add_argument("--skip-db", action="store_true", help="Skip writing to database")
    args = parser.parse_args()

    opus = load_grades("opus")
    noe = load_grades("noe")
    item_ids, matrix = averaged_matrix(opus, noe)

    print(f"\n{'='*60}")
    print(f"HEAR E4 — Statistical Validity Pipeline")
    print(f"  Items: {len(item_ids)}")
    print(f"  Graders: opus ({len(opus['items'])}), noe ({len(noe['items'])})")
    print(f"{'='*60}\n")

    results = {}

    print("--- E4-4: Factor Analysis (PCA + EFA) ---")
    results["factor_analysis"] = run_factor_analysis(item_ids, matrix)

    print("\n--- E4-3: Discriminant Validity ---")
    results["discriminant"] = run_discriminant_validity(item_ids, matrix)

    print("\n--- E4-5: IRT Model Fitting ---")
    results["irt"] = run_irt(item_ids, matrix)

    print("\n--- E4-7: Fairness Analysis ---")
    results["fairness"] = run_fairness(item_ids, matrix)

    print("\n--- E4-2: Convergent Validity (minimal) ---")
    results["convergent"] = run_convergent_validity(item_ids, matrix)

    print("\n--- E4-8: Reports ---")
    write_reports(results, skip_db=args.skip_db)

    print("\n=== SUMMARY ===")
    fa = results["factor_analysis"]
    disc = results["discriminant"]
    print(f"Factor analysis: {fa.get('n_factors_eigenvalue_gt1')} factors with eigenvalue > 1 (expected: ~7)")
    print(f"Discriminant validity: {'PASS' if disc.get('passed') else 'FAIL'}")
    print(f"IRT: {results['irt'].get('n_items_fitted')} axes fitted")
    print(f"Fairness: {results['fairness'].get('summary')}")
    print(f"Results written to: docs/research/calibration/analysis/e4-results.json")


if __name__ == "__main__":
    main()
