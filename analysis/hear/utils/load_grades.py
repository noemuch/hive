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
