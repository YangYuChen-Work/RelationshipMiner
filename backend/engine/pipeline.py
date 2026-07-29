"""Compatibility entry point for the semantic relationship analyzer."""

from __future__ import annotations

import inspect
from collections.abc import Callable

from sqlalchemy.engine import Engine

from engine.semantic.analyzer import RelationshipAnalyzer
from engine.semantic.models import AnalysisResult, AnalysisScope, TableScope

async def run_analysis_pipeline(
    engine: Engine,
    tables: list[dict[str, object]],
    on_progress: Callable[[dict[str, object]], object] | None = None,
    timeout_seconds: float = 180.0,
) -> AnalysisResult:
    """Map legacy ``fields`` selections to semantic ``dimensions``."""
    scope = AnalysisScope(
        tables=[
            TableScope(
                name=str(table["name"]),
                dimensions=list(
                    table.get("dimensions", table.get("fields", []))
                ),
            )
            for table in tables
        ],
        time_budget_seconds=timeout_seconds,
    )
    async def relay(event: dict[str, object]) -> None:
        if on_progress is None:
            return
        try:
            response = on_progress(event)
        except TypeError:
            response = on_progress(
                1,
                str(event.get("message", "Schema analysis")),
                float(event.get("progress", 0.02)),
            )
        if inspect.isawaitable(response):
            await response

    return await RelationshipAnalyzer().analyze(engine, scope, relay)
