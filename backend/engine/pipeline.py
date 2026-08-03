"""Compatibility entry point for the semantic relationship analyzer."""

from __future__ import annotations

import inspect
from collections.abc import Callable

from sqlalchemy.engine import Engine

from engine.semantic.analyzer import RelationshipAnalyzer
from engine.semantic.models import AnalysisResult, AnalysisScope, TableScope

_shared_analyzer: RelationshipAnalyzer | None = None


def _application_analyzer() -> RelationshipAnalyzer:
    """Keep the lazily loaded embedding adapter alive across requests."""
    global _shared_analyzer
    if _shared_analyzer is None:
        _shared_analyzer = RelationshipAnalyzer()
    return _shared_analyzer

async def run_analysis_pipeline(
    engine: Engine,
    tables: list[dict[str, object]],
    on_progress: Callable[[dict[str, object]], object] | None = None,
    timeout_seconds: float = 600.0,
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

    import sys
    print(f"[Pipeline] Starting analysis for {len(scope.tables)} table(s)...", file=sys.stderr, flush=True)
    try:
        result = await _application_analyzer().analyze(engine, scope, relay)
        print(f"[Pipeline] Analysis completed: status={result.status.value}", file=sys.stderr, flush=True)
        return result
    except Exception as exc:
        import traceback
        print(f"[Pipeline] Analysis exception: {exc}", file=sys.stderr, flush=True)
        traceback.print_exc(file=sys.stderr)
        raise
