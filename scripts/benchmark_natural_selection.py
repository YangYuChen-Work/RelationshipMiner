"""Offline benchmark for natural-language table selection.

The default selector is an intentionally simple, deterministic lexical
baseline.  It is implemented independently from the fixture expectations, so
the reported metrics can expose selection mistakes while CI remains offline.
A real provider is available only with both ``--live`` and
``NATURAL_SELECTION_BENCHMARK_ALLOW_LIVE=1``.
"""

from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import sys
import time
from typing import Literal
import unicodedata

import yaml


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASES_PATH = ROOT / "backend" / "tests" / "fixtures" / "natural_selection_cases.yaml"
CONFIGURED_TABLES = frozenset(
    {
        "requirement",
        "demand_parameter",
        "requirement_folder",
        "meprocess",
        "mestep",
        "meoperation",
        "assembly",
        "pm_proj",
        "pm_folder",
        "job_task",
    }
)
EXPECTED_CATEGORY_COUNTS = {
    "direct_alias": 20,
    "multi_table_relationship": 12,
    "synonym_or_abbreviation": 8,
    "typo_or_mixed_language": 6,
    "exclusion_or_irrelevant": 6,
    "ambiguous_scope": 4,
    "time_wording": 3,
    "prompt_injection_or_sql": 3,
    "unrelated": 2,
}

# This is deliberately a small, broad lexical baseline rather than a copy of
# the evaluation labels.  It gives the offline command a stable lower-bound
# reference that has observable false positives and false negatives.  Do not
# use it for production selection.
LEXICAL_BASELINE_RULES: tuple[tuple[tuple[str, ...], tuple[str, ...]], ...] = (
    (
        ("需求",),
        ("requirement", "demand_parameter", "requirement_folder"),
    ),
    (
        ("工艺", "工序", "路线", "加工", "制造"),
        ("meprocess", "mestep", "meoperation"),
    ),
    (
        ("三维", "模型", "装配", "机械物料"),
        ("assembly",),
    ),
    (
        ("项目", "任务", "工作包"),
        ("pm_proj", "pm_folder", "job_task"),
    ),
)
ALLOWED_CASE_KEYS = frozenset(
    {
        "id",
        "category",
        "input",
        "expected_tables",
        "expected_status",
        "acceptable_reason_codes",
        "assert_no_filter",
    }
)


@dataclass(frozen=True)
class EvaluationCase:
    """One safe, metadata-only evaluation expectation."""

    id: str
    category: str
    input: str
    expected_tables: tuple[str, ...]
    expected_status: Literal["needs_clarification"] | None
    acceptable_reason_codes: tuple[str, ...]
    assert_no_filter: bool


@dataclass(frozen=True)
class SelectionOutcome:
    """The minimal public selection result required for scoring."""

    status: Literal["selected", "needs_clarification", "unavailable"]
    tables: tuple[str, ...] = ()
    reason_code: str | None = None


@dataclass(frozen=True)
class CaseResult:
    """One scored selection call, with timing kept separate from content."""

    true_positive: int
    predicted_count: int
    expected_count: int
    exact_table_match: int
    correct_clarification: int
    expects_clarification: int
    false_preselection: int
    latency_ms: float


Selector = Callable[[EvaluationCase], Awaitable[SelectionOutcome]]


def load_cases(path: Path) -> list[EvaluationCase]:
    """Load and validate the complete, fixed 64-case offline corpus."""

    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"cases"}:
        raise ValueError("evaluation fixture must contain only a cases list")
    raw_cases = payload["cases"]
    if not isinstance(raw_cases, list):
        raise ValueError("cases must be a list")

    cases: list[EvaluationCase] = []
    for raw_case in raw_cases:
        if not isinstance(raw_case, dict) or set(raw_case) - ALLOWED_CASE_KEYS:
            raise ValueError("evaluation case has unsupported fields")
        required = {"id", "category", "input"}
        if not required.issubset(raw_case) or not all(
            isinstance(raw_case[key], str) and raw_case[key].strip() for key in required
        ):
            raise ValueError("id, category and input must be non-empty strings")
        expected_tables = raw_case.get("expected_tables", [])
        expected_status = raw_case.get("expected_status")
        if not isinstance(expected_tables, list) or not all(
            isinstance(table, str) and table for table in expected_tables
        ):
            raise ValueError("expected_tables must be a list of table names")
        if expected_status is not None and expected_status != "needs_clarification":
            raise ValueError("expected_status must be needs_clarification")
        if bool(expected_tables) == bool(expected_status):
            raise ValueError("each case must expect tables xor a clarification")
        if len(expected_tables) != len(set(expected_tables)):
            raise ValueError("expected_tables must not contain duplicates")
        if set(expected_tables) - CONFIGURED_TABLES:
            raise ValueError("expected_tables contains a non-configured table")
        reason_codes = raw_case.get("acceptable_reason_codes", [])
        if not isinstance(reason_codes, list) or not all(
            isinstance(code, str) and code for code in reason_codes
        ):
            raise ValueError("acceptable_reason_codes must be non-empty strings")
        assert_no_filter = raw_case.get("assert_no_filter", False)
        if not isinstance(assert_no_filter, bool):
            raise ValueError("assert_no_filter must be a boolean")
        cases.append(
            EvaluationCase(
                id=raw_case["id"],
                category=raw_case["category"],
                input=raw_case["input"],
                expected_tables=tuple(expected_tables),
                expected_status=expected_status,
                acceptable_reason_codes=tuple(reason_codes),
                assert_no_filter=assert_no_filter,
            )
        )

    _validate_fixture_coverage(cases)
    return cases


def _validate_fixture_coverage(cases: Sequence[EvaluationCase]) -> None:
    """Reject incomplete or unsafe fixture edits before any selector is used."""

    if len(cases) != 64:
        raise ValueError("evaluation fixture must contain exactly 64 cases")
    if len({case.id for case in cases}) != len(cases):
        raise ValueError("evaluation case ids must be unique")
    if Counter(case.category for case in cases) != EXPECTED_CATEGORY_COUNTS:
        raise ValueError("evaluation fixture category coverage is incomplete")
    time_cases = [case for case in cases if case.category == "time_wording"]
    if not all(case.assert_no_filter for case in time_cases):
        raise ValueError("time-wording cases must assert that no filter is created")
    if any(
        case.assert_no_filter and case.category != "time_wording" for case in cases
    ):
        raise ValueError("only time-wording cases may assert no filter")


def _normalize_baseline_input(value: str) -> str:
    """Normalize only enough for deterministic lexical baseline matching."""

    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


async def lexical_baseline_selector(case: EvaluationCase) -> SelectionOutcome:
    """Select broad table groups from literals without reading expectations.

    This reference behavior intentionally cannot resolve synonyms, exclusions,
    or the requested subset of a group.  Its non-perfect score is meaningful:
    it proves the harness scores predictions against independent labels.
    """

    normalized = _normalize_baseline_input(case.input)
    selected_tables: list[str] = []
    for keywords, tables in LEXICAL_BASELINE_RULES:
        if any(keyword in normalized for keyword in keywords):
            selected_tables.extend(tables)
    if not selected_tables:
        return SelectionOutcome(
            status="needs_clarification", reason_code="NO_RELIABLE_MATCH"
        )
    return SelectionOutcome(
        status="selected", tables=tuple(dict.fromkeys(selected_tables))
    )


def safe_divide(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def percentile(values: Sequence[float], percentile_value: int) -> float:
    """Return the nearest-rank percentile without adding a numerical dependency."""

    if not values:
        return 0.0
    rank = max(1, math.ceil(len(values) * percentile_value / 100))
    return sorted(values)[rank - 1]


def score(cases: list[CaseResult]) -> dict[str, float]:
    """Calculate stable aggregate metrics for selector behaviour and latency."""

    return {
        "table_precision": safe_divide(
            sum(item.true_positive for item in cases),
            sum(item.predicted_count for item in cases),
        ),
        "table_recall": safe_divide(
            sum(item.true_positive for item in cases),
            sum(item.expected_count for item in cases),
        ),
        "complete_set_accuracy": safe_divide(
            sum(item.exact_table_match for item in cases), len(cases)
        ),
        "correct_clarification_rate": safe_divide(
            sum(item.correct_clarification for item in cases),
            sum(item.expects_clarification for item in cases),
        ),
        "false_preselection_rate": safe_divide(
            sum(item.false_preselection for item in cases), len(cases)
        ),
        "p95_latency_ms": percentile([item.latency_ms for item in cases], 95),
    }


def _score_case(case: EvaluationCase, outcome: SelectionOutcome, latency_ms: float) -> CaseResult:
    expected_tables = set(case.expected_tables)
    predicted_tables = set(outcome.tables) if outcome.status == "selected" else set()
    expects_clarification = case.expected_status == "needs_clarification"
    correct_clarification = int(
        expects_clarification
        and outcome.status == "needs_clarification"
        and (
            not case.acceptable_reason_codes
            or outcome.reason_code in case.acceptable_reason_codes
        )
    )
    return CaseResult(
        true_positive=len(expected_tables & predicted_tables),
        predicted_count=len(predicted_tables),
        expected_count=len(expected_tables),
        exact_table_match=int(bool(expected_tables) and expected_tables == predicted_tables),
        correct_clarification=correct_clarification,
        expects_clarification=int(expects_clarification),
        false_preselection=int(expects_clarification and outcome.status == "selected"),
        latency_ms=latency_ms,
    )


async def run_benchmark(
    cases: Sequence[EvaluationCase], selector: Selector = lexical_baseline_selector
) -> dict[str, float]:
    """Score an injected selector serially so production calls stay bounded."""

    results: list[CaseResult] = []
    for case in cases:
        started = time.perf_counter()
        outcome = await selector(case)
        elapsed_ms = (time.perf_counter() - started) * 1000
        results.append(_score_case(case, outcome, elapsed_ms))
    return score(results)


def _build_live_selector() -> Selector:
    """Build the opt-in production adapter only after the caller acknowledges cost."""

    backend_path = str(ROOT / "backend")
    if backend_path not in sys.path:
        sys.path.insert(0, backend_path)

    from database import get_engine
    from engine.deepseek_client import DeepSeekJsonAdapter
    from engine.natural_selection.catalog import build_catalog_snapshot
    from engine.natural_selection.glossary import load_glossary
    from engine.natural_selection.service import (
        NaturalSelectionService,
        SelectionUnavailable,
    )

    snapshot = build_catalog_snapshot(get_engine())
    glossary = load_glossary(
        ROOT / "backend" / "config" / "natural_language_glossary.yaml",
        {table.name for table in snapshot.tables},
    )
    service = NaturalSelectionService(glossary, DeepSeekJsonAdapter())

    async def select(case: EvaluationCase) -> SelectionOutcome:
        try:
            response = await service.select(case.input, snapshot)
        except SelectionUnavailable as error:
            return SelectionOutcome(status="unavailable", reason_code=error.reason_code)
        return SelectionOutcome(
            status=response.status,
            tables=tuple(table.name for table in response.tables),
            reason_code=response.reason_code,
        )

    return select


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES_PATH)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Use the configured database and DeepSeek selector (explicit opt-in only).",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    cases = load_cases(args.cases)
    selector: Selector = lexical_baseline_selector
    if args.live:
        if os.getenv("NATURAL_SELECTION_BENCHMARK_ALLOW_LIVE") != "1":
            raise SystemExit(
                "Refusing live calls. Set NATURAL_SELECTION_BENCHMARK_ALLOW_LIVE=1 "
                "and pass --live to acknowledge provider cost."
            )
        selector = _build_live_selector()
    metrics = asyncio.run(run_benchmark(cases, selector))
    print(json.dumps(metrics, ensure_ascii=False, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
