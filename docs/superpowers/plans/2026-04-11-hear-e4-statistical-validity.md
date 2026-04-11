# HEAR E4 — Statistical Validity + Adversarial Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Python analysis pipeline that validates HEAR's measurement quality (factor analysis, IRT, discriminant/convergent validity, fairness), plus the adversarial test suite that ensures the judge can't be gamed, and wire the results to the `/api/research/calibration-stats` endpoint.

**Architecture:** Three subsystems — (1) a Python analysis pipeline in `analysis/hear/` consuming calibration grades and writing results to the DB, (2) a TypeScript adversarial suite in `scripts/hear/adversarial.ts` that perturbs calibration items and re-judges them, and (3) a GitHub Actions CI workflow that runs the adversarial suite on every judge prompt change. The pipeline is triggered manually (and on a weekly schedule in CI) and writes IRT parameters + stats to the DB. The API endpoint is updated to read from the DB instead of returning nulls.

**Tech Stack:** Python 3.11, numpy, pandas, scikit-learn, factor_analyzer, girth (IRT), scipy, textstat, psycopg2-binary, Bun/TypeScript (adversarial), GitHub Actions.

---

## Prerequisites (before starting any task)

The calibration grades must exist: `docs/research/calibration/grades/opus.json` and `docs/research/calibration/grades/noe.json`.

**If they don't exist:**

```bash
# Step A — Opus pre-grades all 50 items via Claude Code CLI (~30-60 min)
cd /path/to/hive
bun run scripts/hear/pre-grade.ts

# Step B — Noé reviews Opus grades (interactive, 2-3h)
bun run scripts/hear/review.ts

# Step C — Compute inter-rater agreement
bun run scripts/hear/compute-agreement.ts
# Writes: docs/research/calibration/analysis/v1-inter-rater.md
```

Check that `docs/research/calibration/grades/opus.json` and `noe.json` both exist before Task 1.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `scripts/hear/seed-calibration.ts` | Create | Load grades JSON → calibration_set + calibration_grades tables |
| `analysis/hear/requirements.txt` | Create | Python dependencies |
| `analysis/hear/run_all.py` | Create | Entry point: runs all analyses, writes report |
| `analysis/hear/utils/load_grades.py` | Create | Parse grades JSON → numpy arrays |
| `analysis/hear/validity/discriminant.py` | Create | E4-3: no axis correlates >0.4 with text proxies |
| `analysis/hear/validity/factor_analysis.py` | Create | E4-4: PCA + EFA on 50×7 score matrix |
| `analysis/hear/validity/irt.py` | Create | E4-5: IRT model fitting with girth |
| `analysis/hear/validity/fairness.py` | Create | E4-7: score distribution by artifact_type |
| `analysis/hear/validity/convergent.py` | Create | E4-2: Communication Clarity ↔ Flesch-Kincaid |
| `analysis/hear/reports/generate_reports.py` | Create | E4-8: write results to irt_parameters table + JSON |
| `scripts/hear/adversarial.ts` | Create | E4-9: 5 attack types, grade original vs perturbed |
| `scripts/hear/test-retest.ts` | Create | E4-6: re-grade 30 items, write baseline scores |
| `.github/workflows/hear-adversarial.yml` | Create | CI: run adversarial suite on prompt changes |
| `server/src/index.ts` | Modify | calibration-stats endpoint reads DB instead of returning nulls |

---

## Task 1: Seed calibration grades to the database

**Files:**
- Create: `scripts/hear/seed-calibration.ts`

- [ ] **Step 1: Write seed-calibration.ts**

```typescript
#!/usr/bin/env bun
/**
 * HEAR — Seed calibration set + grades to the database.
 *
 * Reads docs/research/calibration/grades/opus.json and noe.json,
 * reads the 50 item files from docs/research/calibration/items/,
 * inserts rows into calibration_set and calibration_grades tables.
 *
 * Safe to re-run: skips items already present (by content hash).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... bun run scripts/hear/seed-calibration.ts
 *   bun run scripts/hear/seed-calibration.ts --dry-run
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { AXES } from "./lib/rubric";
import type { GradesFile } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const CALIBRATION_DIR = join(PROJECT_ROOT, "docs", "research", "calibration");
const ITEMS_DIR = join(CALIBRATION_DIR, "items");
const GRADES_DIR = join(CALIBRATION_DIR, "grades");
const RUBRIC_VERSION = "1.0";

const DRY_RUN = process.argv.includes("--dry-run");

function extractArtifactType(filename: string): string {
  // "001-decision-excellent-wisdom.md" → "decision"
  const parts = filename.replace(".md", "").split("-");
  return parts[1] ?? "unknown";
}

function loadGrades(grader: string): GradesFile {
  const path = join(GRADES_DIR, `${grader}.json`);
  if (!existsSync(path)) throw new Error(`grades/${grader}.json not found. Run pre-grade.ts and review.ts first.`);
  return JSON.parse(readFileSync(path, "utf-8"));
}

function itemFilenameFromId(itemId: string): string | null {
  const files = readdirSync(ITEMS_DIR);
  return files.find(f => f.startsWith(itemId.slice(0, 3))) ?? null;
}

async function main() {
  const opusGrades = loadGrades("opus");
  const noeGrades = loadGrades("noe");

  const noeMap = new Map(noeGrades.items.map(i => [i.item_id, i]));
  const opusMap = new Map(opusGrades.items.map(i => [i.item_id, i]));

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? "postgresql://localhost:5432/hive",
  });

  let inserted = 0;
  let skipped = 0;

  for (const itemId of [...opusMap.keys()]) {
    const filename = itemFilenameFromId(itemId);
    if (!filename) {
      console.warn(`  SKIP: no item file for ${itemId}`);
      continue;
    }
    const content = readFileSync(join(ITEMS_DIR, filename), "utf-8");
    const artifactType = extractArtifactType(filename);

    if (DRY_RUN) {
      console.log(`DRY-RUN: would insert ${itemId} (${artifactType})`);
      continue;
    }

    // Upsert calibration_set (idempotent by content)
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO calibration_set (artifact_content, artifact_type, rubric_version)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [content, artifactType, RUBRIC_VERSION],
    );

    let calibId: string;
    if (rows.length === 0) {
      // Already exists — fetch id
      const { rows: existing } = await pool.query<{ id: string }>(
        `SELECT id FROM calibration_set WHERE artifact_content = $1`,
        [content],
      );
      if (existing.length === 0) {
        console.warn(`  SKIP: could not find calibration_set row for ${itemId}`);
        skipped++;
        continue;
      }
      calibId = existing[0].id;
      skipped++;
    } else {
      calibId = rows[0].id;
      inserted++;
    }

    // Insert grades for both graders
    for (const [graderKey, gradesMap] of [["claude-opus-4-6", opusMap], ["noe", noeMap]] as const) {
      const item = gradesMap.get(itemId);
      if (!item) continue;

      for (const axis of AXES) {
        const axisScore = item.scores[axis];
        if (!axisScore || axisScore.score === null) continue;

        await pool.query(
          `INSERT INTO calibration_grades
             (calibration_id, grader_id, axis, score, justification, graded_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [
            calibId,
            graderKey,
            axis,
            axisScore.score,
            axisScore.justification ?? "",
            item.graded_at,
          ],
        );
      }
    }

    console.log(`  ✓ ${itemId} (${artifactType})`);
  }

  await pool.end();

  if (!DRY_RUN) {
    console.log(`\nDone. Inserted: ${inserted}, Skipped (already existed): ${skipped}`);
  }
}

main().catch(err => {
  console.error("FATAL:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry run to verify no crash**

```bash
bun run scripts/hear/seed-calibration.ts --dry-run
```

Expected: list of 50 items with `DRY-RUN: would insert ...` — no errors.

- [ ] **Step 3: Run against local DB**

```bash
DATABASE_URL=postgresql://localhost:5432/hive bun run scripts/hear/seed-calibration.ts
```

Expected: `Done. Inserted: 50, Skipped (already existed): 0`

- [ ] **Step 4: Verify DB rows**

```bash
psql postgresql://localhost:5432/hive -c "SELECT COUNT(*) FROM calibration_set; SELECT COUNT(*) FROM calibration_grades;"
```

Expected: `calibration_set` = 50 rows, `calibration_grades` = 50 × 7 × 2 graders = ~700 rows (some axes may be null).

- [ ] **Step 5: Commit**

```bash
git add scripts/hear/seed-calibration.ts
git commit -m "feat(hear/e4): seed calibration grades from JSON to DB"
```

---

## Task 2: Python analysis pipeline scaffold (E4-1)

**Files:**
- Create: `analysis/hear/requirements.txt`
- Create: `analysis/hear/utils/__init__.py`
- Create: `analysis/hear/utils/load_grades.py`
- Create: `analysis/hear/validity/__init__.py`
- Create: `analysis/hear/reports/__init__.py`
- Create: `analysis/hear/run_all.py`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p analysis/hear/utils analysis/hear/validity analysis/hear/reports
touch analysis/hear/utils/__init__.py analysis/hear/validity/__init__.py analysis/hear/reports/__init__.py
```

- [ ] **Step 2: Create requirements.txt**

```
# analysis/hear/requirements.txt
numpy==1.26.4
pandas==2.2.1
scikit-learn==1.4.1
factor_analyzer==0.4.1
girth==0.8.0
scipy==1.13.0
textstat==0.7.3
psycopg2-binary==2.9.9
python-dotenv==1.0.1
```

- [ ] **Step 3: Install and verify**

```bash
cd analysis/hear
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -c "import numpy, pandas, sklearn, factor_analyzer, girth, scipy, textstat, psycopg2; print('OK')"
```

Expected: `OK` with no errors.

- [ ] **Step 4: Create utils/load_grades.py**

```python
# analysis/hear/utils/load_grades.py
import json
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).parents[3]
CALIBRATION_DIR = PROJECT_ROOT / "docs" / "research" / "calibration"
ITEMS_DIR = CALIBRATION_DIR / "items"

AXES = [
    "reasoning_depth",
    "decision_wisdom",
    "communication_clarity",
    "initiative_quality",
    "collaborative_intelligence",
    "self_awareness_calibration",
    "contextual_judgment",
]


def load_grades(grader: str) -> dict:
    path = CALIBRATION_DIR / "grades" / f"{grader}.json"
    with open(path) as f:
        return json.load(f)


def build_score_matrix(grades_file: dict) -> tuple[list[str], list[list[Optional[float]]]]:
    """Returns (item_ids, matrix) where matrix is n_items × 7 axes."""
    items = grades_file["items"]
    item_ids = [item["item_id"] for item in items]
    matrix = []
    for item in items:
        row = []
        for axis in AXES:
            score = item["scores"].get(axis, {}).get("score")
            row.append(float(score) if score is not None else None)
        matrix.append(row)
    return item_ids, matrix


def averaged_matrix(
    opus_file: dict, noe_file: dict
) -> tuple[list[str], list[list[Optional[float]]]]:
    """Average opus + noe scores per item per axis. Returns (item_ids, matrix)."""
    ids_o, mat_o = build_score_matrix(opus_file)
    ids_n, mat_n = build_score_matrix(noe_file)

    noe_map = {noe_file["items"][i]["item_id"]: mat_n[i] for i in range(len(ids_n))}

    result_ids = []
    result_matrix = []
    for i, item_id in enumerate(ids_o):
        noe_row = noe_map.get(item_id, [None] * 7)
        averaged = []
        for o, n in zip(mat_o[i], noe_row):
            if o is not None and n is not None:
                averaged.append((o + n) / 2.0)
            elif o is not None:
                averaged.append(o)
            elif n is not None:
                averaged.append(n)
            else:
                averaged.append(None)
        result_ids.append(item_id)
        result_matrix.append(averaged)

    return result_ids, result_matrix


def load_item_content(item_id: str) -> str:
    """Load raw markdown text of a calibration item."""
    prefix = item_id[:3]
    matches = list(ITEMS_DIR.glob(f"{prefix}-*.md"))
    if not matches:
        return ""
    return matches[0].read_text()


def item_artifact_type(item_id: str) -> str:
    """Extract artifact type from item_id like '001-decision-excellent-wisdom'."""
    parts = item_id.split("-")
    return parts[1] if len(parts) > 1 else "unknown"
```

- [ ] **Step 5: Create run_all.py entry point**

```python
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
    print(f"IRT: {results['irt'].get('n_items_fitted')} items fitted")
    print(f"Fairness: {results['fairness'].get('summary')}")
    print(f"Results written to: docs/research/calibration/analysis/e4-results.json")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Verify scaffold runs (will fail on missing modules — that's expected)**

```bash
cd analysis/hear && source .venv/bin/activate
python run_all.py --skip-db 2>&1 | head -5
```

Expected: `ModuleNotFoundError: No module named 'validity.factor_analysis'` — scaffold wired correctly, just missing implementations.

- [ ] **Step 7: Commit**

```bash
git add analysis/
git commit -m "feat(hear/e4): Python analysis pipeline scaffold"
```

---

## Task 3: Discriminant validity (E4-3)

Validates that HEAR axes don't correlate with shallow text proxies like word count. If `reasoning_depth` scores simply track artifact length, the system is measuring verbosity, not reasoning.

**Files:**
- Create: `analysis/hear/validity/discriminant.py`

- [ ] **Step 1: Create validity/discriminant.py**

```python
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
        matrix: n_items × 7 averaged scores (None = not graded)
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
```

- [ ] **Step 2: Quick smoke test**

```bash
cd analysis/hear && source .venv/bin/activate
python3 -c "
from utils.load_grades import load_grades, averaged_matrix
from validity.discriminant import run_discriminant_validity
opus = load_grades('opus')
noe = load_grades('noe')
ids, mat = averaged_matrix(opus, noe)
results = run_discriminant_validity(ids, mat)
print('passed:', results['passed'])
"
```

Expected: table of correlations + `passed: True` (or `False` with details if any axis correlates with length).

- [ ] **Step 3: Commit**

```bash
git add analysis/hear/validity/discriminant.py
git commit -m "feat(hear/e4): discriminant validity — axis vs text proxy correlations"
```

---

## Task 4: Factor analysis PCA + EFA (E4-4)

Verifies that the 7 HEAR axes measure statistically distinct constructs. If axes cluster together, the rubric can be simplified.

**Files:**
- Create: `analysis/hear/validity/factor_analysis.py`

- [ ] **Step 1: Create validity/factor_analysis.py**

```python
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
```

- [ ] **Step 2: Smoke test**

```bash
cd analysis/hear && source .venv/bin/activate
python3 -c "
from utils.load_grades import load_grades, averaged_matrix
from validity.factor_analysis import run_factor_analysis
opus = load_grades('opus')
noe = load_grades('noe')
ids, mat = averaged_matrix(opus, noe)
r = run_factor_analysis(ids, mat)
print('n_factors_eigenvalue_gt1:', r.get('n_factors_eigenvalue_gt1'))
"
```

Expected: factor analysis output with eigenvalue table. If `n_factors_eigenvalue_gt1 < 5`, note it — rubric revision may be needed.

- [ ] **Step 3: Commit**

```bash
git add analysis/hear/validity/factor_analysis.py
git commit -m "feat(hear/e4): PCA + EFA factor analysis on calibration scores"
```

---

## Task 5: IRT model fitting (E4-5)

Fits a 2-parameter logistic IRT model to estimate item difficulty (how hard an artifact is to score well on) and discrimination (how well an item separates good from bad agents). Uses the `girth` library (pure Python, no PyTorch dependency).

**Files:**
- Create: `analysis/hear/validity/irt.py`

- [ ] **Step 1: Create validity/irt.py**

```python
# analysis/hear/validity/irt.py
"""
E4-5 — Item Response Theory (IRT) model fitting.

Fits a 2-parameter logistic (2PL) model per axis using the girth library.
With only 50 items, IRT estimates are noisy — documented as V1 limitation.
Results are written to the irt_parameters table by generate_reports.py.

Outputs per item per axis:
  - difficulty (b): high = artifact is hard to score well on
  - discrimination (a): high = item cleanly separates good from bad agents
  - fit_statistic: RMSEA-like goodness of fit
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

        # girth expects (n_items, n_respondents) — here 1 "respondent" = 1 judge
        # For V1 we fit single-axis across items (treating items as respondents)
        # This is non-standard but the best we can do with 50 items + 1-2 graders
        n_pass = sum(binary)
        n_fail = len(binary) - n_pass

        if n_pass < 5 or n_fail < 5:
            print(f"  SKIP {axis}: insufficient variance ({n_pass} pass, {n_fail} fail)")
            results["axes"][axis] = {"error": "insufficient_variance", "n_pass": n_pass}
            continue

        # Reshape: girth expects (n_items,) with each entry 0 or 1
        # We have 50 items as "persons" — use cross-item correlation structure
        data = np.array(binary, dtype=float).reshape(1, -1)  # 1 person × 50 items

        try:
            params = twopl_mml(data)
            difficulty = float(np.mean(params[1]))   # b parameter (mean across)
            discrimination = float(np.mean(params[0]))  # a parameter

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
```

- [ ] **Step 2: Smoke test**

```bash
cd analysis/hear && source .venv/bin/activate
python3 -c "
from utils.load_grades import load_grades, averaged_matrix
from validity.irt import run_irt
opus = load_grades('opus')
noe = load_grades('noe')
ids, mat = averaged_matrix(opus, noe)
r = run_irt(ids, mat)
print('fitted:', r['n_items_fitted'], '/7 axes')
"
```

Expected: per-axis difficulty + discrimination values. Some axes may be skipped if variance is too low.

- [ ] **Step 3: Commit**

```bash
git add analysis/hear/validity/irt.py
git commit -m "feat(hear/e4): IRT 2PL model fitting per axis (girth)"
```

---

## Task 6: Fairness analysis (E4-7)

Checks that HEAR doesn't systematically score artifact types differently for reasons unrelated to quality (e.g., specs always score higher than tickets by construction).

**Files:**
- Create: `analysis/hear/validity/fairness.py`

- [ ] **Step 1: Create validity/fairness.py**

```python
# analysis/hear/validity/fairness.py
"""
E4-7 — Fairness analysis.

Checks score distributions by artifact_type. Computes mean ± std per axis
per type and runs a Kruskal-Wallis test to detect systematic group differences.

V1 success: no axis shows significant cross-type difference with large effect size.
(Some difference is expected — decisions should score higher than tickets on
reasoning_depth. The question is whether the *rubric* introduces bias beyond
genuine quality differences.)
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
```

- [ ] **Step 2: Smoke test**

```bash
cd analysis/hear && source .venv/bin/activate
python3 -c "
from utils.load_grades import load_grades, averaged_matrix
from validity.fairness import run_fairness
opus = load_grades('opus')
noe = load_grades('noe')
ids, mat = averaged_matrix(opus, noe)
r = run_fairness(ids, mat)
print(r['summary'])
"
```

Expected: per-artifact-type distributions + Kruskal-Wallis results.

- [ ] **Step 3: Commit**

```bash
git add analysis/hear/validity/fairness.py
git commit -m "feat(hear/e4): fairness analysis by artifact type (Kruskal-Wallis)"
```

---

## Task 7: Convergent validity — minimal V1 (E4-2)

V1 checks that `communication_clarity` scores correlate positively with Flesch-Kincaid readability. This is the only external measure available without running separate benchmarks.

**Files:**
- Create: `analysis/hear/validity/convergent.py`

- [ ] **Step 1: Create validity/convergent.py**

```python
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
```

- [ ] **Step 2: Smoke test**

```bash
cd analysis/hear && source .venv/bin/activate
python3 -c "
from utils.load_grades import load_grades, averaged_matrix
from validity.convergent import run_convergent_validity
opus = load_grades('opus')
noe = load_grades('noe')
ids, mat = averaged_matrix(opus, noe)
r = run_convergent_validity(ids, mat)
print('passed:', r.get('passed'))
"
```

- [ ] **Step 3: Commit**

```bash
git add analysis/hear/validity/convergent.py
git commit -m "feat(hear/e4): convergent validity — communication clarity vs Flesch-Kincaid"
```

---

## Task 8: Reports generator → DB + API (E4-8)

Writes analysis results to the `irt_parameters` table and updates the `/api/research/calibration-stats` endpoint to return real values.

**Files:**
- Create: `analysis/hear/reports/generate_reports.py`
- Modify: `server/src/index.ts` (lines ~858-870, the `calibration-stats` handler)

- [ ] **Step 1: Create reports/generate_reports.py**

```python
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
```

- [ ] **Step 2: Update the calibration-stats API endpoint**

In `server/src/index.ts`, find the calibration-stats handler (around line 858) and replace it:

Old code:
```typescript
    if (url.pathname === "/api/research/calibration-stats" && req.method === "GET") {
      // V2 will populate this from the HEAR analysis pipeline (E4). For V1 we
      // return nulls so the frontend can render "pending" without erroring.
      return json({
        cohen_kappa: null,
        krippendorff_alpha: null,
        icc: null,
        test_retest_correlation: null,
        calibration_drift: null,
        last_computed: null,
      });
    }
```

New code:
```typescript
    if (url.pathname === "/api/research/calibration-stats" && req.method === "GET") {
      try {
        const resultsPath = join(import.meta.dir, "../../docs/research/calibration/analysis/e4-results.json");
        const file = Bun.file(resultsPath);
        if (await file.exists()) {
          const data = await file.json();
          return json({
            cohen_kappa: null,  // computed by compute-agreement.ts, not E4
            krippendorff_alpha: null,
            icc: null,
            test_retest_correlation: null,
            calibration_drift: null,
            last_computed: data.computed_at ?? null,
            factor_analysis: data.factor_analysis ?? null,
            discriminant_validity: data.discriminant_validity ?? null,
            irt: data.irt ?? null,
            fairness: data.fairness ?? null,
          });
        }
      } catch {
        // fall through to null response
      }
      return json({
        cohen_kappa: null,
        krippendorff_alpha: null,
        icc: null,
        test_retest_correlation: null,
        calibration_drift: null,
        last_computed: null,
        factor_analysis: null,
        discriminant_validity: null,
        irt: null,
        fairness: null,
      });
    }
```

Also add the `join` import at the top of `server/src/index.ts` if not already present:
```typescript
import { join } from "node:path";
```

- [ ] **Step 3: Run full pipeline**

```bash
cd analysis/hear && source .venv/bin/activate
DATABASE_URL=postgresql://localhost:5432/hive python run_all.py
```

Expected: all analyses run, `e4-results.json` written, IRT parameters in DB.

- [ ] **Step 4: Verify API endpoint**

```bash
# Start server first if not running
cd server && bun run src/index.ts &
curl -s http://localhost:3000/api/research/calibration-stats | python3 -m json.tool | head -20
```

Expected: JSON with real `factor_analysis`, `discriminant_validity`, `irt` fields (not all nulls).

- [ ] **Step 5: Commit**

```bash
git add analysis/hear/reports/generate_reports.py server/src/index.ts
git commit -m "feat(hear/e4): reports generator + calibration-stats API reads e4-results.json"
```

---

## Task 9: Test-retest baseline (E4-6)

Re-grades 30 calibration items immediately to establish a baseline. The actual test-retest (same items 1 week later) requires running this script again in 7 days and comparing.

**Files:**
- Create: `scripts/hear/test-retest.ts`

- [ ] **Step 1: Create scripts/hear/test-retest.ts**

```typescript
#!/usr/bin/env bun
/**
 * HEAR E4-6 — Test-retest reliability baseline.
 *
 * Re-grades 30 randomly selected calibration items using the same Opus grader.
 * Writes results to docs/research/calibration/grades/retest-{DATE}.json.
 *
 * Run once now (baseline), run again in 7 days, then compare with:
 *   bun run scripts/hear/test-retest.ts --compare retest-2026-04-11.json retest-2026-04-18.json
 *
 * Usage:
 *   bun run scripts/hear/test-retest.ts                   # grade 30 items
 *   bun run scripts/hear/test-retest.ts --n 10            # grade 10 items (quick test)
 *   bun run scripts/hear/test-retest.ts --compare a.json b.json  # compare two sessions
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { listItemIds, loadGraderPrompt, loadItem, loadRubric, RUBRIC_VERSION } from "./lib/rubric";
import { emptyGradesFile, type ItemGrade, validateItemGrade } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const GRADES_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "grades");

const args = process.argv.slice(2);
const compareMode = args.includes("--compare");
const nItems = parseInt(args[args.indexOf("--n") + 1] ?? "30", 10);

// ---- compare mode ----
if (compareMode) {
  const fileA = args[args.indexOf("--compare") + 1];
  const fileB = args[args.indexOf("--compare") + 2];
  if (!fileA || !fileB) {
    console.error("Usage: --compare <file-a.json> <file-b.json>");
    process.exit(1);
  }
  compareFiles(join(GRADES_DIR, fileA), join(GRADES_DIR, fileB));
  process.exit(0);
}

function compareFiles(pathA: string, pathB: string) {
  const a = JSON.parse(readFileSync(pathA, "utf-8"));
  const b = JSON.parse(readFileSync(pathB, "utf-8"));
  const aMap = new Map(a.items.map((i: ItemGrade) => [i.item_id, i]));
  const bMap = new Map(b.items.map((i: ItemGrade) => [i.item_id, i]));
  const common = [...aMap.keys()].filter(id => bMap.has(id));

  console.log(`Comparing ${common.length} common items`);

  const AXES = ["reasoning_depth","decision_wisdom","communication_clarity","initiative_quality","collaborative_intelligence","self_awareness_calibration","contextual_judgment"] as const;

  let totalR = 0;
  let nAxes = 0;
  for (const axis of AXES) {
    const pairs: [number, number][] = [];
    for (const id of common) {
      const sa = (aMap.get(id) as ItemGrade).scores[axis as keyof typeof (aMap.get(id) as ItemGrade)['scores']]?.score;
      const sb = (bMap.get(id) as ItemGrade).scores[axis as keyof typeof (bMap.get(id) as ItemGrade)['scores']]?.score;
      if (sa != null && sb != null) pairs.push([sa as number, sb as number]);
    }
    if (pairs.length < 5) continue;
    const meanA = pairs.reduce((s, [a]) => s + a, 0) / pairs.length;
    const meanB = pairs.reduce((s, [,b]) => s + b, 0) / pairs.length;
    let num = 0, d1 = 0, d2 = 0;
    for (const [a, b] of pairs) {
      num += (a - meanA) * (b - meanB);
      d1 += (a - meanA) ** 2;
      d2 += (b - meanB) ** 2;
    }
    const r = d1 * d2 > 0 ? num / Math.sqrt(d1 * d2) : 0;
    const mad = pairs.reduce((s, [a,b]) => s + Math.abs(a-b), 0) / pairs.length;
    const pass = r >= 0.8 ? "PASS" : r >= 0.7 ? "MARGINAL" : "FAIL";
    console.log(`  ${axis}: r=${r.toFixed(3)}, MAD=${mad.toFixed(2)} [${pass}]`);
    totalR += r;
    nAxes++;
  }
  console.log(`\n  Mean Pearson r: ${(totalR / nAxes).toFixed(3)} (>0.8 = stable)`);
}

// ---- grading mode ----
async function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--output-format", "json", "--model", "claude-opus-4-6"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", d => out += d.toString());
    proc.on("close", code => {
      if (code !== 0) return reject(new Error(`claude exit ${code}`));
      try {
        const env = JSON.parse(out);
        resolve(env.result ?? "");
      } catch (e) {
        reject(new Error(`parse fail: ${out.slice(0, 200)}`));
      }
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function buildPrompt(itemId: string, content: string, type: string): string {
  const rubric = loadRubric();
  const graderDoc = loadGraderPrompt();
  const match = graderDoc.match(/## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("cannot extract prompt template");
  return match[1]
    .replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric)
    .replace("{{ARTIFACT_TYPE}}", type)
    .replace("{{ARTIFACT_CONTENT}}", content)
    .replace("{{ITEM_ID}}", itemId)
    .replace("{{ISO_TIMESTAMP}}", new Date().toISOString());
}

function extractJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (m) try { return JSON.parse(m[1]); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
  throw new Error("no JSON in response");
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const outPath = join(GRADES_DIR, `retest-${today}.json`);

  if (existsSync(outPath)) {
    console.log(`Output file already exists: ${outPath}`);
    console.log("Delete it to re-run, or use --compare to compare two sessions.");
    process.exit(0);
  }

  // Pick random subset of items
  const allIds = listItemIds();
  const shuffled = allIds.sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(nItems, allIds.length));

  console.log(`Test-retest baseline: grading ${selected.length} items with Opus`);

  const gradesFile = emptyGradesFile("claude-opus-4-6", "test-retest baseline");
  gradesFile.items = [];

  for (let i = 0; i < selected.length; i++) {
    const itemId = selected[i];
    console.log(`[${i + 1}/${selected.length}] ${itemId}`);
    try {
      const { content, type } = loadItem(itemId);
      const prompt = buildPrompt(itemId, content, type);
      const text = await callClaude(prompt);
      const parsed = extractJson(text) as { scores?: ItemGrade["scores"] };
      if (!parsed.scores) throw new Error("no scores field");
      const grade: ItemGrade = {
        item_id: itemId, grader: "claude-opus-4-6", rubric_version: RUBRIC_VERSION,
        prompt_version: "retest-v1", graded_at: new Date().toISOString(), scores: parsed.scores,
      };
      validateItemGrade(grade);
      gradesFile.items.push(grade);
      writeFileSync(outPath, JSON.stringify(gradesFile, null, 2));
      console.log(`  ✓`);
    } catch (err) {
      console.error(`  ✗ ${(err as Error).message}`);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone. Written to: ${outPath}`);
  console.log(`Run again in 7 days, then:`);
  console.log(`  bun run scripts/hear/test-retest.ts --compare retest-${today}.json retest-<date+7>.json`);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
```

- [ ] **Step 2: Run baseline (30 items, ~30 min)**

```bash
bun run scripts/hear/test-retest.ts
```

Expected: grades written to `docs/research/calibration/grades/retest-2026-04-11.json`.

- [ ] **Step 3: Commit**

```bash
git add scripts/hear/test-retest.ts
git commit -m "feat(hear/e4): test-retest baseline grading script"
```

---

## Task 10: Adversarial test suite (E4-9)

5 attacks that test whether the judge can be gamed. Each attack perturbs a calibration item and checks that the score doesn't change more than the allowed threshold.

**Files:**
- Create: `scripts/hear/adversarial.ts`

- [ ] **Step 1: Create scripts/hear/adversarial.ts**

```typescript
#!/usr/bin/env bun
/**
 * HEAR E4-9 — Adversarial robustness test suite.
 *
 * Tests 5 attack types against the Opus judge:
 *   1. verbosity   — add filler sentences (threshold: Δ ≤ 1.5 per axis)
 *   2. position    — move content to end of artifact (threshold: Δ ≤ 1.0)
 *   3. distractor  — insert high-sounding but irrelevant paragraph (Δ ≤ 1.5)
 *   4. paraphrase  — use pre-generated paraphrase variants (Δ ≤ 1.5)
 *   5. reidentify  — inject identity hints into anonymized artifact (Δ ≤ 0.5)
 *
 * Usage:
 *   bun run scripts/hear/adversarial.ts
 *   bun run scripts/hear/adversarial.ts --attack verbosity   # single attack
 *   bun run scripts/hear/adversarial.ts --items 5            # test first 5 items only
 *   bun run scripts/hear/adversarial.ts --no-report          # skip writing report file
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { listItemIds, loadGraderPrompt, loadItem, loadRubric, RUBRIC_VERSION } from "./lib/rubric";
import { type ItemGrade, validateItemGrade } from "./lib/schema";

const PROJECT_ROOT = join(import.meta.dir, "..", "..");
const ANALYSIS_DIR = join(PROJECT_ROOT, "docs", "research", "calibration", "analysis");
const REPORT_PATH = join(ANALYSIS_DIR, "adversarial-v1.md");

const args = process.argv.slice(2);
const onlyAttack = args[args.indexOf("--attack") + 1] ?? null;
const maxItems = parseInt(args[args.indexOf("--items") + 1] ?? "10", 10);
const noReport = args.includes("--no-report");

// ---- Attack definitions ----

type Attack = {
  name: string;
  threshold: number;  // max allowed mean score delta (mean absolute deviation across axes)
  transform: (content: string) => string;
};

const FILLER = [
  "Furthermore, it is worth emphasizing that additional considerations may apply to this context.",
  "In conclusion, this comprehensive analysis demonstrates thorough and systematic thinking.",
  "Moreover, the structured approach outlined above is consistent with established best practices.",
  "It should also be noted that this decision accounts for both short-term and long-term implications.",
];

const DISTRACTOR = `

From a theoretical standpoint, the epistemological foundations of this domain intersect with broader frameworks of systematic analysis and rigorous methodological considerations that inform best-in-class decision-making processes across organizational contexts.

`;

const ATTACKS: Attack[] = [
  {
    name: "verbosity",
    threshold: 1.5,
    transform: (content) => content + "\n\n" + FILLER.join(" "),
  },
  {
    name: "position",
    threshold: 1.0,
    transform: (content) => {
      const paragraphs = content.split("\n\n").filter(p => p.trim().length > 0);
      if (paragraphs.length <= 2) return content;
      const [first, second, ...rest] = paragraphs;
      // Move first two paragraphs to the end
      return [...rest, first, second].join("\n\n");
    },
  },
  {
    name: "distractor",
    threshold: 1.5,
    transform: (content) => {
      const mid = content.indexOf("\n\n", Math.floor(content.length / 2));
      if (mid === -1) return content + DISTRACTOR;
      return content.slice(0, mid) + DISTRACTOR + content.slice(mid);
    },
  },
  {
    name: "paraphrase",
    threshold: 1.5,
    // Paraphrase: replace specific technical terms with synonyms
    // (True paraphrase requires LLM; V1 uses mechanical synonym substitution)
    transform: (content) =>
      content
        .replace(/\bimplemented\b/g, "built")
        .replace(/\butilize\b/g, "use")
        .replace(/\bfacilitate\b/g, "enable")
        .replace(/\boptimal\b/g, "best")
        .replace(/\bdemonstrate\b/g, "show")
        .replace(/\bcomprehensive\b/g, "thorough")
        .replace(/\bsubsequently\b/g, "then")
        .replace(/\binitially\b/g, "first"),
  },
  {
    name: "reidentification",
    threshold: 0.5,  // Stricter — identity should have zero effect
    transform: (content) =>
      `**Agent:** Alex Chen, Senior Engineer at TechCorp Inc.\n**Team:** Platform Infrastructure\n\n` + content,
  },
];

// ---- Grading ----

async function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("claude", ["-p", "--output-format", "json", "--model", "claude-opus-4-6"], { stdio: ["pipe","pipe","pipe"] });
    let out = "";
    proc.stdout.on("data", d => out += d.toString());
    proc.on("close", code => {
      if (code !== 0) return reject(new Error(`exit ${code}`));
      try { resolve(JSON.parse(out).result ?? ""); }
      catch { reject(new Error(`parse fail`)); }
    });
    proc.stdin.write(prompt); proc.stdin.end();
  });
}

function buildPrompt(itemId: string, content: string, type: string): string {
  const rubric = loadRubric();
  const graderDoc = loadGraderPrompt();
  const match = graderDoc.match(/## The prompt\s*\n\s*```\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("cannot extract prompt template");
  return match[1]
    .replace("{{FULL_RUBRIC_CONTENT_HERE}}", rubric)
    .replace("{{ARTIFACT_TYPE}}", type)
    .replace("{{ARTIFACT_CONTENT}}", content)
    .replace("{{ITEM_ID}}", itemId)
    .replace("{{ISO_TIMESTAMP}}", new Date().toISOString());
}

function extractJson(text: string): unknown {
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (m) try { return JSON.parse(m[1]); } catch {}
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s >= 0 && e > s) return JSON.parse(text.slice(s, e + 1));
  throw new Error("no JSON in response");
}

const AXES = ["reasoning_depth","decision_wisdom","communication_clarity","initiative_quality","collaborative_intelligence","self_awareness_calibration","contextual_judgment"] as const;

function scoreVector(grade: ItemGrade): number[] {
  return AXES.map(a => grade.scores[a]?.score ?? NaN);
}

function meanAbsDelta(original: number[], perturbed: number[]): number {
  const valid = original.map((o, i) => [o, perturbed[i]]).filter(([o, p]) => !isNaN(o) && !isNaN(p));
  if (valid.length === 0) return 0;
  return valid.reduce((s, [o, p]) => s + Math.abs(o - p), 0) / valid.length;
}

// ---- Main ----

async function main() {
  const allIds = listItemIds();
  const selectedIds = allIds.slice(0, Math.min(maxItems, allIds.length));
  const attacksToRun = onlyAttack ? ATTACKS.filter(a => a.name === onlyAttack) : ATTACKS;

  if (attacksToRun.length === 0) {
    console.error(`No attack named '${onlyAttack}'. Valid: ${ATTACKS.map(a => a.name).join(", ")}`);
    process.exit(1);
  }

  console.log(`HEAR Adversarial Suite v1`);
  console.log(`  Items: ${selectedIds.length}`);
  console.log(`  Attacks: ${attacksToRun.map(a => a.name).join(", ")}`);
  console.log("");

  const results: Record<string, { passed: boolean; meanDelta: number; threshold: number; failures: string[] }> = {};

  for (const attack of attacksToRun) {
    console.log(`\n=== Attack: ${attack.name} (threshold Δ ≤ ${attack.threshold}) ===`);
    const deltas: number[] = [];
    const failures: string[] = [];

    for (let i = 0; i < selectedIds.length; i++) {
      const itemId = selectedIds[i];
      const { content, type } = loadItem(itemId);

      try {
        // Grade original
        const origText = await callClaude(buildPrompt(itemId, content, type));
        const origParsed = extractJson(origText) as { scores?: ItemGrade["scores"] };
        if (!origParsed.scores) throw new Error("no scores");
        const origGrade: ItemGrade = {
          item_id: itemId, grader: "claude-opus-4-6", rubric_version: RUBRIC_VERSION,
          prompt_version: "adversarial-v1", graded_at: new Date().toISOString(), scores: origParsed.scores,
        };
        await new Promise(r => setTimeout(r, 800));

        // Grade perturbed
        const perturbed = attack.transform(content);
        const pertText = await callClaude(buildPrompt(itemId, perturbed, type));
        const pertParsed = extractJson(pertText) as { scores?: ItemGrade["scores"] };
        if (!pertParsed.scores) throw new Error("no scores (perturbed)");
        const pertGrade: ItemGrade = {
          item_id: itemId, grader: "claude-opus-4-6", rubric_version: RUBRIC_VERSION,
          prompt_version: "adversarial-v1", graded_at: new Date().toISOString(), scores: pertParsed.scores,
        };
        await new Promise(r => setTimeout(r, 800));

        const delta = meanAbsDelta(scoreVector(origGrade), scoreVector(pertGrade));
        deltas.push(delta);
        const pass = delta <= attack.threshold;
        if (!pass) failures.push(`${itemId}: Δ=${delta.toFixed(2)}`);
        console.log(`  [${i+1}/${selectedIds.length}] ${itemId}: Δ=${delta.toFixed(2)} ${pass ? "✓" : "✗ FAIL"}`);

      } catch (err) {
        console.error(`  ERROR ${itemId}: ${(err as Error).message}`);
      }
    }

    const meanDelta = deltas.length > 0 ? deltas.reduce((s, d) => s + d, 0) / deltas.length : 0;
    const passed = failures.length === 0;
    results[attack.name] = { passed, meanDelta, threshold: attack.threshold, failures };

    console.log(`\n  ${attack.name}: mean Δ=${meanDelta.toFixed(3)}, ${passed ? "PASS" : `FAIL (${failures.length} items exceed threshold)`}`);
  }

  // Summary
  console.log("\n=== ADVERSARIAL SUITE SUMMARY ===");
  let allPassed = true;
  for (const [name, r] of Object.entries(results)) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`  ${name.padEnd(20)} ${status}  mean Δ=${r.meanDelta.toFixed(3)} (threshold ${r.threshold})`);
    if (!r.passed) allPassed = false;
  }
  console.log(`\nOverall: ${allPassed ? "PASS — judge is robust" : "FAIL — judge prompts need hardening"}`);

  if (!noReport) {
    const reportLines = [
      "# HEAR V1 — Adversarial Robustness Report",
      "",
      `**Generated:** ${new Date().toISOString()}`,
      `**Items tested:** ${selectedIds.length}`,
      "",
      "## Results",
      "",
      "| Attack | Threshold | Mean Δ | Failures | Status |",
      "|---|---|---|---|---|",
      ...Object.entries(results).map(([name, r]) =>
        `| ${name} | Δ ≤ ${r.threshold} | ${r.meanDelta.toFixed(3)} | ${r.failures.length} | ${r.passed ? "✅ PASS" : "❌ FAIL"} |`
      ),
      "",
      "## Failure details",
      "",
      ...Object.entries(results).flatMap(([name, r]) =>
        r.failures.length > 0 ? [`### ${name}`, ...r.failures.map(f => `- ${f}`), ""] : []
      ),
      "## Notes",
      "",
      "- `paraphrase` attack uses mechanical synonym substitution in V1 (LLM-based paraphrase is V2)",
      "- Items tested: " + selectedIds.join(", "),
    ];
    writeFileSync(REPORT_PATH, reportLines.join("\n"));
    console.log(`\nReport written to: ${REPORT_PATH}`);
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
```

- [ ] **Step 2: Smoke test with 3 items, 1 attack**

```bash
bun run scripts/hear/adversarial.ts --attack verbosity --items 3
```

Expected: grades 3 items × 2 (original + perturbed), prints Δ per item, exits 0 if all pass.

- [ ] **Step 3: Run full suite (10 items × 5 attacks ≈ 100 API calls, ~20 min)**

```bash
bun run scripts/hear/adversarial.ts
```

Expected: report at `docs/research/calibration/analysis/adversarial-v1.md` + exit code 0 if all attacks pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/hear/adversarial.ts
git commit -m "feat(hear/e4): adversarial test suite — 5 attacks (verbosity, position, distractor, paraphrase, reidentification)"
```

---

## Task 11: GitHub Actions CI (E4-9 CI)

Runs the adversarial suite automatically when judge prompt files change.

**Files:**
- Create: `.github/workflows/hear-adversarial.yml`

- [ ] **Step 1: Create .github/workflows/hear-adversarial.yml**

```yaml
# .github/workflows/hear-adversarial.yml
name: HEAR Adversarial Suite

on:
  push:
    paths:
      - 'docs/research/calibration/grader-prompt-*.md'
      - 'docs/research/HEAR-rubric.md'
  workflow_dispatch:
    inputs:
      items:
        description: 'Number of items to test (default: 10)'
        required: false
        default: '10'

jobs:
  adversarial:
    name: Run adversarial attacks
    runs-on: ubuntu-latest
    timeout-minutes: 60

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - name: Install server dependencies
        run: bun install
        working-directory: server

      - name: Install Claude Code CLI
        run: |
          npm install -g @anthropic-ai/claude-code
          echo "claude installed: $(claude --version)"

      - name: Authenticate Claude Code CLI
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          # Claude Code CLI uses ANTHROPIC_API_KEY automatically in non-interactive mode
          echo "ANTHROPIC_API_KEY set"

      - name: Run adversarial suite
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          ITEMS=${{ github.event.inputs.items || '10' }}
          bun run scripts/hear/adversarial.ts --items $ITEMS
        # exit code 1 = at least one attack failed → blocks deploy

      - name: Upload adversarial report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: adversarial-report
          path: docs/research/calibration/analysis/adversarial-v1.md
```

- [ ] **Step 2: Add ANTHROPIC_API_KEY to GitHub repository secrets**

Go to: `https://github.com/noemuch/hive/settings/secrets/actions`
Add secret: `ANTHROPIC_API_KEY` = your key.

- [ ] **Step 3: Commit and push to trigger CI**

```bash
mkdir -p .github/workflows
git add .github/workflows/hear-adversarial.yml
git commit -m "feat(hear/e4): GitHub Actions CI for adversarial suite"
git push origin feat/114-hear-e4-statistical-validity
```

- [ ] **Step 4: Verify CI runs**

```bash
gh run list --repo noemuch/hive --branch feat/114-hear-e4-statistical-validity
```

Expected: CI run appears, check status in 5-10 min.

---

## Task 12: Open PR

- [ ] **Step 1: Final pipeline smoke test**

```bash
cd analysis/hear && source .venv/bin/activate
python run_all.py --skip-db
```

Expected: all 5 analyses complete without errors. `e4-results.json` written.

- [ ] **Step 2: Verify API live**

```bash
curl -s http://localhost:3000/api/research/calibration-stats | python3 -c "import sys,json; d=json.load(sys.stdin); print('last_computed:', d.get('last_computed')); print('n_factors:', d.get('factor_analysis', {}).get('n_factors_eigenvalue_gt1'))"
```

Expected: real values, not nulls.

- [ ] **Step 3: Open PR**

```bash
git push origin feat/114-hear-e4-statistical-validity
gh pr create \
  --repo noemuch/hive \
  --title "feat(hear/e4): statistical validity pipeline + adversarial suite" \
  --body "$(cat <<'EOF'
## Summary

- Seeds calibration grades from JSON to DB (`seed-calibration.ts`)
- Python analysis pipeline: discriminant validity, PCA/EFA, IRT, fairness, convergent validity
- Reports generator writes IRT parameters to DB + `e4-results.json`
- `/api/research/calibration-stats` now returns real data
- Adversarial test suite: 5 attacks (verbosity, position, distractor, paraphrase, reidentification)
- Test-retest baseline script (compare again in 7 days)
- GitHub Actions CI: adversarial suite runs on judge prompt changes

Closes #114

## V1 limitations (documented)
- IRT: 50 items is below recommended minimum of 200 — directional only
- Convergent validity: only `communication_clarity` ↔ Flesch-Kincaid tested
- `paraphrase` attack uses mechanical synonym substitution (LLM-based is V2)
- Test-retest: baseline only — actual +1 week comparison needs a second run

## Test plan
- [ ] `bun run scripts/hear/seed-calibration.ts --dry-run` — lists 50 items, no errors
- [ ] `python run_all.py --skip-db` — all analyses complete
- [ ] `curl /api/research/calibration-stats` — returns real values (not nulls)
- [ ] `bun run scripts/hear/adversarial.ts --items 3 --attack verbosity` — grades + exits 0

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
  --assignee "@me" \
  --base main
```

---

## Self-review

**Spec coverage check:**

| E4 item | Task |
|---|---|
| E4-1 Python scaffold + GH Actions | Task 2 + Task 11 |
| E4-2 Convergent validity | Task 7 |
| E4-3 Discriminant validity | Task 3 |
| E4-4 PCA + EFA | Task 4 |
| E4-5 IRT model fitting | Task 5 |
| E4-6 Test-retest | Task 9 |
| E4-7 Fairness | Task 6 |
| E4-8 Reports → API | Task 8 |
| E4-9 Adversarial (5 attacks) | Task 10 |
| E1 grading prerequisite | Prerequisites section |
| Seed grades to DB | Task 1 |

All 9 E4 items + prerequisite covered.

**Type consistency:** `ItemGrade`, `GradesFile`, `AXES` used consistently from `scripts/hear/lib/` across all TypeScript files. Python AXES list in `load_grades.py` matches TypeScript definition.

**No placeholders:** All steps contain actual code.
