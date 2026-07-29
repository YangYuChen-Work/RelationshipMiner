from engine.semantic.models import (
    AnalysisDiagnostics,
    AnalysisResult,
    AnalysisScope,
    AnalysisStatus,
    TableScope,
)


def test_scope_keeps_dimensions_separate_from_system_fields():
    scope = AnalysisScope(
        tables=[TableScope(name="process", dimensions=["name"])],
        time_budget_seconds=180,
    )

    assert scope.tables[0].dimensions == ["name"]
    assert not hasattr(scope.tables[0], "primary_keys")


def test_result_serializes_partial_status_and_diagnostics():
    result = AnalysisResult(
        status=AnalysisStatus.PARTIAL,
        table_nodes=[],
        entity_nodes=[],
        table_edges=[],
        entity_edges=[],
        diagnostics=AnalysisDiagnostics(candidates_pending=12),
        warnings=["12 \u4e2a\u5019\u9009\u672a\u5b8c\u6210\u63a8\u7406"],
    )

    assert result.model_dump()["status"] == "partial"
