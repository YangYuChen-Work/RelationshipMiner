"""Representative semantic workflow through the public HTTP and WS APIs."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from tests.fixtures.semantic_business_data import (
    ANALYSIS_SELECTION,
    EXPECTED_OPERATION_IDS,
    EXPECTED_PART_IDS,
    INVALID_OPERATION_ID,
    UNRELATED_PART_ID,
    create_semantic_business_engine,
)
from tests.fixtures.semantic_llm_responses import (
    FIXTURE_MODEL_ID,
    FIXTURE_TASK_ID,
    ExactBusinessPlanner,
    FixtureEmbeddingAdapter,
    FixtureSemanticJudge,
)


def _terminal_message(
    ws: object,
) -> tuple[list[dict[str, object]], dict[str, object]]:
    messages: list[dict[str, object]] = []
    while True:
        message = ws.receive_json()
        messages.append(message)
        if message.get("phase") == "complete" and "graph" in message:
            return messages, message


@contextmanager
def _business_client(
    monkeypatch: pytest.MonkeyPatch,
) -> Iterator[
    tuple[
        TestClient,
        ExactBusinessPlanner,
        FixtureEmbeddingAdapter,
        FixtureSemanticJudge,
    ]
]:
    from database import get_engine
    from engine import pipeline
    from engine.semantic.analyzer import RelationshipAnalyzer
    from main import app
    from routers.analyze import _task_registry

    engine = create_semantic_business_engine()
    planner = ExactBusinessPlanner()
    embeddings = FixtureEmbeddingAdapter()
    judge = FixtureSemanticJudge()
    analyzer = RelationshipAnalyzer(
        planner=planner,
        embedding_adapter=embeddings,
        judge=judge,
    )

    app.dependency_overrides[get_engine] = lambda: engine
    monkeypatch.setattr(pipeline, "RelationshipAnalyzer", lambda: analyzer)
    _task_registry.clear()
    try:
        with TestClient(app) as client:
            yield client, planner, embeddings, judge
    finally:
        _task_registry.clear()
        app.dependency_overrides.clear()
        engine.dispose()


def test_selected_dimensions_produce_explainable_business_relationships(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with _business_client(monkeypatch) as (
        client,
        planner,
        embeddings,
        judge,
    ):
        response = client.post(
            "/api/analyze",
            json={"tables": ANALYSIS_SELECTION},
        )

        assert response.status_code == 200
        task_id = response.json()["task_id"]
        with client.websocket_connect(f"/api/ws/analyze/{task_id}") as ws:
            messages, result = _terminal_message(ws)

    assert result["status"] == "complete"
    assert messages[-1] is result
    assert messages[-1]["progress"] == 1.0
    assert [plan.relation_type for plan in planner.plans] == [
        "人员行为",
        "工艺涉及零件",
    ]
    assert len(planner.plans) == 2
    assert planner.calls == 1
    assert embeddings.document_batches
    assert embeddings.query_batches
    embedded_text = "\n".join(
        text
        for batch in [
            *embeddings.document_batches,
            *embeddings.query_batches,
        ]
        for text in batch
    )
    assert "private_note" not in embedded_text
    assert "未选择" not in embedded_text
    assert judge.rejected_entity_ids == {
        INVALID_OPERATION_ID,
        UNRELATED_PART_ID,
    }

    graph = result["graph"]
    assert len(graph["table_edges"]) == 2
    assert {
        relation_type
        for edge in graph["table_edges"]
        for relation_type in edge["relation_types"]
    } == {"人员行为", "工艺涉及零件"}

    relations = [
        relation
        for edge in graph["entity_edges"]
        for relation in edge["relations"]
    ]
    assert len(relations) == 6
    assert {
        relation["target"]
        for relation in relations
        if relation["relation_type"] == "人员行为"
    } == EXPECTED_OPERATION_IDS
    assert {
        relation["target"]
        for relation in relations
        if relation["relation_type"] == "工艺涉及零件"
    } == EXPECTED_PART_IDS

    linked_entity_ids = {
        entity_id
        for edge in graph["entity_edges"]
        for entity_id in (edge["source"], edge["target"])
    }
    assert INVALID_OPERATION_ID not in linked_entity_ids
    assert UNRELATED_PART_ID not in linked_entity_ids
    assert {INVALID_OPERATION_ID, UNRELATED_PART_ID} <= {
        node["id"] for node in graph["entity_nodes"]
    }

    selected_dimensions = {
        table["name"]: set(table["dimensions"])
        for table in ANALYSIS_SELECTION
    }
    for relation in relations:
        assert relation["strength"] == "weak"
        assert relation["explanation"]
        assert any(
            "\u4e00" <= character <= "\u9fff"
            for character in relation["explanation"]
        )
        assert relation["model_id"] == FIXTURE_MODEL_ID
        assert relation["task_id"] == FIXTURE_TASK_ID
        assert relation["evidence"]
        source_table = relation["source"].split(":", 1)[0]
        target_table = relation["target"].split(":", 1)[0]
        for evidence in relation["evidence"]:
            assert evidence["method"] == "llm_semantic_reasoning"
            assert evidence["reason"]
            assert evidence["source_field"] in selected_dimensions[source_table]
            assert evidence["target_field"] in selected_dimensions[target_table]

    table_edges_by_type = {
        edge["relation_types"][0]: edge for edge in graph["table_edges"]
    }
    assert table_edges_by_type["人员行为"]["weak_count"] == 3
    assert table_edges_by_type["人员行为"]["entity_edge_count"] == 3
    assert (
        len(table_edges_by_type["人员行为"]["supporting_entity_edges"])
        == 3
    )
    assert table_edges_by_type["工艺涉及零件"]["weak_count"] == 3
    assert table_edges_by_type["工艺涉及零件"]["entity_edge_count"] == 3
    assert len(
        table_edges_by_type["工艺涉及零件"]["supporting_entity_edges"]
    ) == 3
