"""Regression gates for the offline natural-language selection evaluation set."""

from __future__ import annotations

from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).parents[3]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.benchmark_natural_selection import (  # noqa: E402
    CONFIGURED_TABLES,
    EXPECTED_CATEGORY_COUNTS,
    EvaluationCase,
    SelectionOutcome,
    load_cases,
    run_benchmark,
)


FIXTURE_PATH = ROOT / "backend" / "tests" / "fixtures" / "natural_selection_cases.yaml"


def test_evaluation_fixture_has_required_coverage_and_at_least_60_cases() -> None:
    cases = load_cases(FIXTURE_PATH)

    assert len(cases) >= 60
    assert any(
        case.input == "分析订单" and case.expected_status == "needs_clarification"
        for case in cases
    )
    assert any("忽略之前指令" in case.input for case in cases)
    assert any(case.expected_status == "needs_clarification" for case in cases)
    assert all(bool(case.expected_tables) ^ bool(case.expected_status) for case in cases)


def test_evaluation_fixture_has_exact_safe_category_coverage() -> None:
    cases = load_cases(FIXTURE_PATH)

    assert len(cases) == 64
    assert len({case.id for case in cases}) == len(cases)
    assert {case.category for case in cases} == set(EXPECTED_CATEGORY_COUNTS)
    assert all(set(case.expected_tables).issubset(CONFIGURED_TABLES) for case in cases)
    assert all(
        case.assert_no_filter
        for case in cases
        if case.category == "time_wording"
    )


@pytest.mark.asyncio
async def test_benchmark_accepts_an_injected_fake_selector() -> None:
    cases = load_cases(FIXTURE_PATH)

    async def no_selection(_: EvaluationCase) -> SelectionOutcome:
        return SelectionOutcome(status="needs_clarification", reason_code="NO_RELIABLE_MATCH")

    metrics = await run_benchmark(cases, selector=no_selection)

    assert metrics["table_precision"] == 0.0
    assert metrics["table_recall"] == 0.0
    assert metrics["false_preselection_rate"] == 0.0


@pytest.mark.asyncio
async def test_default_offline_baseline_can_observe_selection_mismatches() -> None:
    """The default must score independent predictions, never fixture labels."""

    metrics = await run_benchmark(load_cases(FIXTURE_PATH))

    assert metrics["complete_set_accuracy"] < 1.0
    assert metrics["table_precision"] < 1.0
    assert metrics["table_recall"] < 1.0
    assert metrics["false_preselection_rate"] > 0.0
