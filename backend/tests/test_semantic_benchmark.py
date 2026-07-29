from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_semantic_benchmark_exercises_bounded_judge_without_entity_values():
    root = Path(__file__).resolve().parents[2]
    completed = subprocess.run(
        [sys.executable, "scripts/benchmark_semantic_backend.py"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
        timeout=180,
    )

    payload = json.loads(completed.stdout)

    assert payload["judge_completed_groups"] == payload["groups"]
    assert payload["judge_peak_live_groups"] <= (
        payload["judge_live_group_upper_bound"]
    )
    assert payload["judge_pending_groups"] == 0
    assert payload["judge_failed_groups"] == 0
    assert "table_0" not in completed.stdout
