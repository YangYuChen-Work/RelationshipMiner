from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest
from sqlalchemy import text

from engine.semantic.models import (
    AnalysisScope,
    AnalysisStatus,
    JudgementBatchResult,
    RelationDecision,
    RelationEvidence,
    RelationshipPlan,
    TableScope,
)


class _StaticPlanner:
    def __init__(self, plans: list[RelationshipPlan] | Exception) -> None:
        self._plans = plans

    async def plan(self, *args: object, **kwargs: object) -> list[RelationshipPlan]:
        if isinstance(self._plans, Exception):
            raise self._plans
        return self._plans


class _ConstantEmbeddings:
    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0] for _ in texts]


class _ApprovingJudge:
    async def judge_groups(self, groups: list[object], deadline: float) -> JudgementBatchResult:
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
        )


class _FailedJudge:
    async def judge_groups(self, groups: list[object], deadline: float) -> JudgementBatchResult:
        return JudgementBatchResult(
            decisions=[],
            failed_groups=len(groups),
        )


def _plan() -> RelationshipPlan:
    return RelationshipPlan(
        source_table="users",
        target_table="orders",
        relation_type="user_places_order",
        direction="source_to_target",
        source_dimensions=["name"],
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
        source_dimensions=["name"],
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
                TableScope(name="users", dimensions=["name"]),
                TableScope(name="orders", dimensions=["amount"]),
            ]
        ),
        events.append,
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert result.entity_edges
    assert all(
        {"entities_read", "plans_created", "candidates_retrieved", "entity_edges_created"}
        <= event.keys()
        for event in events
    )


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
                TableScope(name="users", dimensions=["name"]),
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
                TableScope(name="users", dimensions=["name"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert not result.entity_edges
    assert result.warnings


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
                TableScope(name="users", dimensions=["name"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.FAILED
    assert result.diagnostics.candidates_pending > 0
    assert result.entity_edges == []


@pytest.mark.asyncio
async def test_analyzer_expands_representative_verdicts_to_all_signature_members(engine):
    from engine.semantic.analyzer import RelationshipAnalyzer

    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET name = 'Alice' WHERE id = 2"))
        connection.execute(text("UPDATE products SET title = 'Widget' WHERE id = 2"))

    result = await RelationshipAnalyzer(
        planner=_StaticPlanner([_product_plan()]),
        embedding_adapter=_ConstantEmbeddings(),
        judge=_ApprovingJudge(),
    ).analyze(
        engine,
        AnalysisScope(
            tables=[
                TableScope(name="users", dimensions=["name"]),
                TableScope(name="products", dimensions=["title"]),
            ]
        ),
    )

    assert result.status == AnalysisStatus.COMPLETE
    assert {
        (edge.source, edge.target)
        for edge in result.entity_edges
    } == {
        ("products:1", "users:1"),
        ("products:1", "users:2"),
        ("products:2", "users:1"),
        ("products:2", "users:2"),
    }
