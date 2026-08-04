from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable
from types import SimpleNamespace

import pytest
from pydantic import BaseModel
from sqlalchemy import text

from engine.semantic.deadline import DeadlineExceeded
from engine.semantic.judge import SemanticJudge
from engine.semantic.models import (
    AnalysisScope,
    AnalysisStatus,
    CandidateGroup,
    JudgementGroupOutcome,
    JudgementBatchResult,
    RelationDecision,
    RelationEvidence,
    RelationshipPlan,
    TableScope,
)


@pytest.mark.asyncio
async def test_analyzer_redacts_retrieval_exception_from_public_warning(
    engine, monkeypatch
):
    from engine.semantic import analyzer

    def leaking_retrieval(*args, **kwargs):
        raise RuntimeError("database password=secret-value")

    monkeypatch.setattr(analyzer, "iter_candidate_groups", leaking_retrieval)
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([_product_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert result.warnings == [
        "Candidate retrieval failed (internal_error)."
    ]
    assert "secret" not in str(result.model_dump())


@pytest.mark.asyncio
async def test_schema_deadline_keeps_event_loop_responsive(engine, monkeypatch):
    import time as blocking_time

    from engine.semantic import analyzer
    from engine.schema_analyzer import analyze_schema as real_analyze_schema

    def slow_schema(*args, **kwargs):
        blocking_time.sleep(0.1)
        return real_analyze_schema(*args, **kwargs)

    monkeypatch.setattr(analyzer, "analyze_schema", slow_schema)
    loop_tick = asyncio.Event()

    async def tick() -> None:
        await asyncio.sleep(0.01)
        loop_tick.set()

    analysis = asyncio.create_task(
        analyzer.RelationshipAnalyzer(
            planner=_StaticPlanner([]),
            embedding_adapter=_ConstantEmbeddings(),
            judge=_ApprovingJudge(),
        ).analyze(
            engine,
            AnalysisScope(
                tables=[TableScope(name="users", dimensions=["email"])],
                time_budget_seconds=0.03,
            ),
        )
    )
    tick_task = asyncio.create_task(tick())
    await asyncio.wait_for(loop_tick.wait(), timeout=0.05)
    result = await analysis
    await tick_task

    assert result.status == AnalysisStatus.PARTIAL
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_embedding_deadline_keeps_event_loop_responsive(engine):
    import time as blocking_time

    from engine.semantic.analyzer import RelationshipAnalyzer

    class SlowEmbeddings:
        def encode_documents(self, texts: list[str]) -> list[list[float]]:
            blocking_time.sleep(0.1)
            return [[1.0, 0.0] for _ in texts]

        def encode_queries(self, texts: list[str]) -> list[list[float]]:
            blocking_time.sleep(0.1)
            return [[1.0, 0.0] for _ in texts]

    loop_tick = asyncio.Event()

    async def tick() -> None:
        await asyncio.sleep(0.01)
        loop_tick.set()

    analysis = asyncio.create_task(
        RelationshipAnalyzer(
            planner=_StaticPlanner([_product_plan()]),
            embedding_adapter=SlowEmbeddings(),
            judge=_ApprovingJudge(),
        ).analyze(
            engine,
            AnalysisScope(
                tables=[
                    TableScope(name="users", dimensions=["email"]),
                    TableScope(name="products", dimensions=["title"]),
                ],
                time_budget_seconds=0.03,
            ),
        )
    )
    tick_task = asyncio.create_task(tick())
    await asyncio.wait_for(loop_tick.wait(), timeout=0.05)
    result = await analysis
    await tick_task

    assert result.status == AnalysisStatus.PARTIAL
    assert result.warnings == ["Analysis timed out."]


class _StaticPlanner:
    def __init__(self, plans: list[RelationshipPlan] | Exception) -> None:
        self._plans = plans

    async def plan(self, *args: object, **kwargs: object) -> list[RelationshipPlan]:
        if isinstance(self._plans, Exception):
            raise self._plans
        return self._plans


@pytest.mark.asyncio
async def test_missing_required_business_roles_return_safe_warnings(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE missing_roles (id INTEGER PRIMARY KEY, title TEXT)"
        ))
        connection.execute(text(
            "INSERT INTO missing_roles VALUES (1, 'Widget')"
        ))

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[TableScope(name="missing_roles", dimensions=["title"])]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert result.warnings == [
        "缺少业务名称字段。",
        "缺少对象类型信息，无法进行主要关系判断。",
    ]


@pytest.mark.asyncio
async def test_blank_business_names_emit_one_fixed_warning(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET name = ' '"))
    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[TableScope(name="users", dimensions=["email"])]
        ),
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert result.warnings.count("部分对象缺少业务名称。") == 1
    assert {node.display_name for node in result.entity_nodes} == {"未命名对象"}


@pytest.mark.asyncio
async def test_literal_fallback_text_is_not_miscounted_as_a_blank_name(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET name = '未命名对象'"))
    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[TableScope(name="users", dimensions=["email"])]
        ),
    )

    assert "部分对象缺少业务名称。" not in result.warnings


async def _materialize_groups(groups: object) -> list[object]:
    if hasattr(groups, "__aiter__"):
        return [group async for group in groups]
    return list(groups)


class _ConstantEmbeddings:
    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]


class _ApprovingJudge:
    async def judge_groups(self, groups: list[object], deadline: float) -> JudgementBatchResult:
        groups = await _materialize_groups(groups)
        decisions = []
        for group in groups:
            if not group.candidates:
                continue
            target = group.candidates[0]
            decisions.append(
                RelationDecision(
                    source=group.source.entity_id,
                    target=target.entity_id,
                    relation_type=group.plan.relation_type,
                    direction=group.plan.direction,
                    strength="weak",
                    confidence=0.9,
                    explanation="Selected values support this relationship.",
                    evidence=[
                        RelationEvidence(
                            source_field=group.plan.source_dimensions[0],
                            source_value=group.source.dimensions[
                                group.plan.source_dimensions[0]
                            ],
                            target_field=group.plan.target_dimensions[0],
                            target_value=target.dimensions[
                                group.plan.target_dimensions[0]
                            ],
                            method="llm_semantic_reasoning",
                            reason="The selected values match.",
                        )
                    ],
                )
            )
        return JudgementBatchResult(
            decisions=decisions,
            completed_groups=len(groups),
            outcomes=[JudgementGroupOutcome(
                source_id=group.source.entity_id,
                candidate_count=len(group.candidates),
                status="completed",
            ) for group in groups],
        )


class _FailedJudge:
    async def judge_groups(self, groups: list[object], deadline: float) -> JudgementBatchResult:
        groups = await _materialize_groups(groups)
        return JudgementBatchResult(
            decisions=[],
            failed_groups=len(groups),
            outcomes=[JudgementGroupOutcome(
                source_id=group.source.entity_id,
                candidate_count=len(group.candidates),
                status="failed",
            ) for group in groups],
        )


class _SlowPlanner:
    async def plan(self, *args: object, **kwargs: object) -> list[RelationshipPlan]:
        await asyncio.sleep(0.2)
        return [_product_plan()]


def _plan() -> RelationshipPlan:
    return RelationshipPlan(
        source_table="users",
        target_table="orders",
        relation_type="user_places_order",
        direction="source_to_target",
        source_dimensions=["email"],
        target_dimensions=["amount"],
        retrieval_modes=["semantic"],
        candidate_limit_per_source=2,
        reason="The selected values can describe an order owner.",
    )


def _product_plan() -> RelationshipPlan:
    return RelationshipPlan(
        source_table="users",
        target_table="products",
        relation_type="user_discusses_product",
        direction="source_to_target",
        source_dimensions=["email"],
        target_dimensions=["title"],
        retrieval_modes=["semantic"],
        candidate_limit_per_source=2,
        reason="Selected values can identify a product discussion.",
    )


@pytest.mark.asyncio
async def test_analyzer_completes_and_emits_structured_progress(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    events: list[dict[str, object]] = []
    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
        events.append,
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert result.entity_edges
    graph_event = events[-1]
    assert graph_event["phase"] == "graph"
    assert graph_event["entity_edges_created"] == 4
    assert graph_event["entities_read"] == 4


@pytest.mark.asyncio
async def test_analyzer_marks_failed_judgement_partial_without_losing_fk_edges(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_FailedJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.PARTIAL
    assert result.diagnostics.candidates_pending > 0
    assert any(
        relation.strength == "strong"
        for edge in result.entity_edges
        for relation in edge.relations
    )


@pytest.mark.asyncio
async def test_analyzer_keeps_completed_weak_edge_when_candidate_stream_deadlines(
    engine,
    monkeypatch,
):
    from engine.semantic import analyzer

    class ApprovingLlm:
        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            request = json.loads(str(messages[-1]["content"]))
            source = request["source"]
            target = request["candidates"][0]
            plan = request["plan"]
            payload = {
                "decisions": [{
                    "approved": True,
                    "source": source["entity_id"],
                    "target": target["entity_id"],
                    "relation_type": plan["relation_type"],
                    "display_label": plan["display_label"],
                    "direction": plan["direction"],
                    "strength": "weak",
                    "confidence": 0.91,
                    "explanation": "The selected values support the relation.",
                    "evidence": [{
                        "source_field": "email",
                        "target_field": "title",
                        "method": "llm_semantic_reasoning",
                        "reason": "The selected values match.",
                    }],
                }],
            }
            return response_model.model_validate(payload).model_dump()

    def one_group_then_deadline(
        documents,
        plans,
        _embedding_adapter,
        check_deadline=None,
    ):
        source = next(
            document for document in documents
            if document.table_name == "users"
        )
        target = next(
            document for document in documents
            if document.table_name == "products"
        )
        yield CandidateGroup(
            plan=plans[0],
            source=source,
            candidates=[target],
        )
        raise DeadlineExceeded("candidate retrieval stream")

    monkeypatch.setattr(
        analyzer,
        "iter_candidate_groups",
        one_group_then_deadline,
    )
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([_product_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=SemanticJudge(ApprovingLlm(), concurrency=1),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ],
        ),
    )

    weak_relations = [
        relation
        for edge in result.entity_edges
        for relation in edge.relations
        if relation.strength == "weak"
    ]
    assert result.status == AnalysisStatus.PARTIAL
    assert len(weak_relations) == 1
    assert weak_relations[0].relation_type == "user_discusses_product"
    assert result.diagnostics.candidates_completed == 1
    assert result.warnings == [
        "Candidate judgement did not complete for all groups."
    ]


@pytest.mark.asyncio
async def test_analyzer_fails_when_planner_fails_without_trustworthy_output(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner(RuntimeError("malformed LLM output")),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert not result.entity_edges
    assert result.warnings


@pytest.mark.asyncio
async def test_planner_exception_keeps_fk_edges_as_partial_result(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner(RuntimeError("planner unavailable")),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.PARTIAL
    assert len(result.entity_edges) == 2
    assert all(
        relation.strength == "strong"
        for edge in result.entity_edges
        for relation in edge.relations
    )
    assert result.warnings == ["Relationship planning failed (internal_error)."]


@pytest.mark.asyncio
async def test_schema_overrun_does_not_start_record_loading(engine, monkeypatch):
    from engine.semantic import analyzer
    from engine.schema_analyzer import analyze_schema as real_analyze_schema

    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            return self.now

    clock = Clock()
    loaded = False

    def slow_schema(engine, table_names):
        clock.now = 2.0
        return real_analyze_schema(engine, table_names)

    def record_loading_must_not_start(*args, **kwargs):
        nonlocal loaded
        loaded = True
        raise AssertionError("record loading must not start after schema timeout")

    monkeypatch.setattr(analyzer, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(analyzer, "analyze_schema", slow_schema)
    monkeypatch.setattr(analyzer, "load_scoped_records", record_loading_must_not_start)
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[TableScope(name="users", dimensions=["email"])],
            time_budget_seconds=1,
        ),
    )

    assert loaded is False
    assert result.status == AnalysisStatus.PARTIAL
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_malformed_judgement_cannot_be_complete_with_zero_edges(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([_product_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_FailedJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert result.diagnostics.candidates_pending > 0
    assert result.entity_edges == []


@pytest.mark.asyncio
async def test_analyzer_judges_equal_auxiliary_values_per_primary_context(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    with engine.begin() as connection:
        connection.execute(text(
            "UPDATE users SET email = 'shared@test.com' WHERE id IN (1, 2)"
        ))
        connection.execute(text(
            "UPDATE products SET title = 'shared evidence' WHERE id IN (1, 2)"
        ))
        connection.execute(text(
            "UPDATE products SET class_name = 'com.example.SpecialProduct' "
            "WHERE id = 2"
        ))

    class PrimaryContextJudge:
        def __init__(self) -> None:
            self.payload_contexts: list[tuple[tuple[str, str | None], tuple[str, str | None]]] = []

        async def judge_groups(
            self,
            groups: list[object],
            deadline: float,
        ) -> JudgementBatchResult:
            materialized = await _materialize_groups(groups)
            decisions: list[RelationDecision] = []
            outcomes: list[JudgementGroupOutcome] = []
            for group in materialized:
                suffix = group.source.entity_id.rsplit(":", 1)[-1]
                target = next(
                    candidate
                    for candidate in group.candidates
                    if candidate.entity_id.endswith(f":{suffix}")
                )
                self.payload_contexts.append((
                    (group.source.display_name, group.source.class_name),
                    (target.display_name, target.class_name),
                ))
                decisions.append(RelationDecision(
                    source=group.source.entity_id,
                    target=target.entity_id,
                    relation_type=group.plan.relation_type,
                    direction=group.plan.direction,
                    strength="weak",
                    confidence=0.9,
                    explanation="Primary contexts were judged independently.",
                    evidence=[RelationEvidence(
                        source_field="email",
                        source_value=group.source.dimensions["email"],
                        target_field="title",
                        target_value=target.dimensions["title"],
                        method="llm_semantic_reasoning",
                        reason="Shared auxiliary evidence.",
                    )],
                ))
                outcomes.append(JudgementGroupOutcome(
                    source_id=group.source.entity_id,
                    candidate_count=len(group.candidates),
                    status="completed",
                ))
            return JudgementBatchResult(
                decisions=decisions,
                completed_groups=len(materialized),
                outcomes=outcomes,
            )

    judge = PrimaryContextJudge()

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([_product_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=judge,
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert judge.payload_contexts == [
        (
            ("Alice", "com.example.User"),
            ("Widget", "com.example.Product"),
        ),
        (
            ("Bob", "com.example.Admin"),
            ("Gadget", "com.example.SpecialProduct"),
        ),
    ]
    assert {
        (edge.source, edge.target)
        for edge in result.entity_edges
    } == {
        ("products:1", "users:1"),
        ("products:2", "users:2"),
    }


@pytest.mark.asyncio
async def test_deadline_stops_before_next_table_and_returns_chinese_partial(
    engine, monkeypatch
):
    from engine import semantic
    from engine.semantic import analyzer
    from engine.semantic.corpus import load_scoped_records as real_load

    class Clock:
        now = 0.0

        def monotonic(self) -> float:
            return self.now

    clock = Clock()
    reads: list[str] = []
    planner = _StaticPlanner([_plan()])

    def slow_first_read(engine, scope, schema_result, *, check_deadline=None):
        reads.append(scope.tables[0].name)
        loaded = real_load(engine, scope, schema_result)
        clock.now = 2.0
        return loaded

    monkeypatch.setattr(analyzer, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(analyzer, "load_scoped_records", slow_first_read)
    result = await analyzer.RelationshipAnalyzer(
        planner=planner,
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ],
            time_budget_seconds=1,
        ),
    )

    assert reads == ["users"]
    assert result.status == AnalysisStatus.PARTIAL
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_planner_uses_remaining_deadline_and_returns_failed_warning(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    result = await RelationshipAnalyzer(
        planner=_SlowPlanner(),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ],
            time_budget_seconds=0.1,
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_deadline_before_graph_assembly_finalizes_strong_edges(
    engine, monkeypatch
):
    from engine.semantic import analyzer

    class Clock:
        expired = False

        def monotonic(self) -> float:
            return 2.0 if self.expired else 0.0

    clock = Clock()
    original_fk_edges = analyzer.build_fk_edges

    def expire_after_strong_edges(*args, **kwargs):
        edges = original_fk_edges(*args, **kwargs)
        clock.expired = True
        return edges

    real_build_graph = analyzer.build_graph

    def final_graph_without_deadline(*args, **kwargs):
        assert kwargs.get("check_deadline") is None
        return real_build_graph(*args, **kwargs)

    monkeypatch.setattr(analyzer, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(analyzer, "build_fk_edges", expire_after_strong_edges)
    monkeypatch.setattr(analyzer, "build_graph", final_graph_without_deadline)
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ],
            time_budget_seconds=1,
        ),
    )

    assert result.status == AnalysisStatus.PARTIAL
    assert len(result.entity_nodes) == 4
    assert len(result.entity_edges) == 2
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_empty_plan_keeps_relation_table_edge_without_selecting_class_name(
    engine,
):
    from engine.semantic.analyzer import RelationshipAnalyzer

    _install_user_order_relation_table(engine)
    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert len(result.entity_nodes) == 4
    evidence_methods = [
        relation.evidence[0].method
        for edge in result.entity_edges
        for relation in edge.relations
    ]
    assert evidence_methods.count("relation_table") == 2


@pytest.mark.asyncio
async def test_analyzer_excludes_relation_rows_within_one_selected_business_table(
    engine,
):
    from engine.semantic.analyzer import RelationshipAnalyzer

    _install_user_order_relation_table(engine)
    with engine.begin() as connection:
        connection.execute(text(
            "INSERT INTO relation_id "
            "(left_id, right_id, left_class, right_class) VALUES "
            "('1', '2', 'com.example.User', 'com.example.Admin')"
        ))

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
    )

    relation_table_pairs = {
        frozenset((relation.source, relation.target))
        for edge in result.entity_edges
        for relation in edge.relations
        if any(
            evidence.method == "relation_table"
            for evidence in relation.evidence
        )
    }
    assert frozenset(("users:1", "users:2")) not in relation_table_pairs
    assert relation_table_pairs == {
        frozenset(("users:1", "orders:1")),
        frozenset(("users:2", "orders:2")),
    }


@pytest.mark.asyncio
async def test_analyzer_exposes_known_manufacturing_relation_labels_without_class_selection(
    engine,
):
    from engine.semantic.analyzer import RelationshipAnalyzer

    _install_manufacturing_relation_tables(engine)
    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="meprocess", dimensions=["name"]),
                TableScope(name="meoperation", dimensions=["name"]),
                TableScope(name="mestep", dimensions=["name"]),
                TableScope(name="assembly", dimensions=["name"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert {node.class_name for node in result.entity_nodes} == {
        "MEProcess",
        "MEOperation",
        "MEStep",
        "Assembly",
    }
    assert {
        (relation.source, relation.target): relation.relation_type
        for edge in result.entity_edges
        for relation in edge.relations
    } == {
        ("meprocess:process-1", "meoperation:operation-1"): "包含工序",
        ("meoperation:operation-1", "mestep:step-1"): "包含工步",
        ("meprocess:process-1", "assembly:assembly-1"): "关联物料",
        ("meoperation:operation-1", "assembly:assembly-1"): "关联物料",
        ("mestep:step-1", "assembly:assembly-1"): "关联物料",
    }


@pytest.mark.asyncio
async def test_analyzer_normalizes_reversed_manufacturing_rows_and_evidence(
    engine,
):
    from engine.semantic.analyzer import RelationshipAnalyzer

    _install_manufacturing_relation_tables(engine, reverse=True)
    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="meprocess", dimensions=["name"]),
                TableScope(name="meoperation", dimensions=["name"]),
                TableScope(name="mestep", dimensions=["name"]),
                TableScope(name="assembly", dimensions=["name"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.COMPLETE
    actual = {}
    for edge in result.entity_edges:
        relation = edge.relations[0]
        evidence = relation.evidence[0]
        actual[(relation.source, relation.target)] = (
            relation.relation_type,
            relation.direction,
            evidence.source_field,
            evidence.source_value,
            evidence.target_field,
            evidence.target_value,
        )
    assert actual == {
        ("meprocess:process-1", "meoperation:operation-1"): (
            "包含工序",
            "source_to_target",
            "right_id",
            "process-1",
            "left_id",
            "operation-1",
        ),
        ("meoperation:operation-1", "mestep:step-1"): (
            "包含工步",
            "source_to_target",
            "right_id",
            "operation-1",
            "left_id",
            "step-1",
        ),
        ("meprocess:process-1", "assembly:assembly-1"): (
            "关联物料",
            "source_to_target",
            "right_id",
            "process-1",
            "left_id",
            "assembly-1",
        ),
        ("meoperation:operation-1", "assembly:assembly-1"): (
            "关联物料",
            "source_to_target",
            "right_id",
            "operation-1",
            "left_id",
            "assembly-1",
        ),
        ("mestep:step-1", "assembly:assembly-1"): (
            "关联物料",
            "source_to_target",
            "right_id",
            "step-1",
            "left_id",
            "assembly-1",
        ),
    }


@pytest.mark.asyncio
async def test_deadline_after_structural_discovery_finalizes_loaded_graph(
    engine,
    monkeypatch,
):
    from engine.semantic import analyzer

    class Clock:
        expired = False

        def monotonic(self) -> float:
            return 2.0 if self.expired else 0.0

    clock = Clock()
    _install_user_order_relation_table(engine)
    real_relation_edges = analyzer.build_relation_table_edges

    def discover_then_expire(*args, **kwargs):
        edges = real_relation_edges(*args, **kwargs)
        clock.expired = True
        return edges

    monkeypatch.setattr(analyzer, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(
        analyzer,
        "build_relation_table_edges",
        discover_then_expire,
    )
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ],
            time_budget_seconds=1,
        ),
    )

    assert result.status == AnalysisStatus.PARTIAL
    assert len(result.entity_nodes) == 4
    assert len(result.entity_edges) == 2
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_structural_discovery_redacts_internal_error(engine, monkeypatch):
    from engine.semantic import analyzer

    def leaking_discovery(*args, **kwargs):
        raise RuntimeError("relation database password=secret-value")

    monkeypatch.setattr(
        analyzer,
        "build_relation_table_edges",
        leaking_discovery,
    )
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.PARTIAL
    assert result.warnings == [
        "Structural relation discovery failed (internal_error)."
    ]
    assert "secret" not in str(result.model_dump())


@pytest.mark.asyncio
async def test_internal_structural_deadline_keeps_already_resolved_edges(
    engine,
    monkeypatch,
):
    from engine.semantic import analyzer, structural_relations

    class Clock:
        expired = False

        def monotonic(self) -> float:
            return 2.0 if self.expired else 0.0

    clock = Clock()
    _install_user_order_relation_table(engine)
    real_resolve_endpoint = structural_relations._resolve_endpoint
    resolved_endpoints = 0

    def expire_after_first_resolved_pair(*args, **kwargs):
        nonlocal resolved_endpoints
        endpoint = real_resolve_endpoint(*args, **kwargs)
        resolved_endpoints += 1
        if resolved_endpoints == 2:
            clock.expired = True
        return endpoint

    monkeypatch.setattr(analyzer, "time", SimpleNamespace(monotonic=clock.monotonic))
    monkeypatch.setattr(
        structural_relations,
        "_resolve_endpoint",
        expire_after_first_resolved_pair,
    )
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="orders", dimensions=["amount"]),
            ],
            time_budget_seconds=1,
        ),
    )

    assert result.status == AnalysisStatus.PARTIAL
    assert sum(
        evidence.method == "relation_table"
        for edge in result.entity_edges
        for relation in edge.relations
        for evidence in relation.evidence
    ) == 1
    assert result.warnings == ["Analysis timed out."]


@pytest.mark.asyncio
async def test_structural_failure_without_trustworthy_edges_is_failed(
    engine,
    monkeypatch,
):
    from engine.semantic import analyzer

    def failing_discovery(*args, **kwargs):
        raise RuntimeError("relation discovery unavailable")

    monkeypatch.setattr(
        analyzer,
        "build_relation_table_edges",
        failing_discovery,
    )
    result = await analyzer.RelationshipAnalyzer(
        planner=_StaticPlanner([]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["email"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert result.entity_edges == []
    assert result.warnings == [
        "Structural relation discovery failed (internal_error)."
    ]


def _install_user_order_relation_table(engine) -> None:
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE relation_id ("
            "left_id TEXT, right_id TEXT, left_class TEXT, right_class TEXT)"
        ))
        connection.execute(text(
            "INSERT INTO relation_id "
            "(left_id, right_id, left_class, right_class) VALUES "
            "('1', '1', 'com.example.User', 'com.example.Order'), "
            "('2', '2', 'com.example.Admin', 'com.example.Order')"
        ))


def _install_manufacturing_relation_tables(
    engine,
    *,
    reverse: bool = False,
) -> None:
    with engine.begin() as connection:
        for table_name in ("meprocess", "meoperation", "mestep", "assembly"):
            connection.execute(text(
                f"CREATE TABLE {table_name} ("
                "id TEXT PRIMARY KEY, name TEXT, class_name TEXT)"
            ))
        connection.execute(text(
            "INSERT INTO meprocess VALUES ('process-1', 'Process', 'MEProcess')"
        ))
        connection.execute(text(
            "INSERT INTO meoperation VALUES "
            "('operation-1', 'Operation', 'MEOperation')"
        ))
        connection.execute(text(
            "INSERT INTO mestep VALUES ('step-1', 'Step', 'MEStep')"
        ))
        connection.execute(text(
            "INSERT INTO assembly VALUES ('assembly-1', 'Material', 'Assembly')"
        ))
        connection.execute(text(
            "CREATE TABLE relation_id ("
            "left_id TEXT, right_id TEXT, left_class TEXT, right_class TEXT)"
        ))
        relation_rows = [
            ("process-1", "operation-1", "MEProcess", "MEOperation"),
            ("operation-1", "step-1", "MEOperation", "MEStep"),
            ("process-1", "assembly-1", "MEProcess", "Assembly"),
            ("operation-1", "assembly-1", "MEOperation", "Assembly"),
            ("step-1", "assembly-1", "MEStep", "Assembly"),
        ]
        if reverse:
            relation_rows = [
                (right_id, left_id, right_class, left_class)
                for left_id, right_id, left_class, right_class in relation_rows
            ]
        connection.execute(
            text(
                "INSERT INTO relation_id "
                "(left_id, right_id, left_class, right_class) VALUES "
                "(:left_id, :right_id, :left_class, :right_class)"
            ),
            [
                {
                    "left_id": left_id,
                    "right_id": right_id,
                    "left_class": left_class,
                    "right_class": right_class,
                }
                for left_id, right_id, left_class, right_class in relation_rows
            ],
        )
