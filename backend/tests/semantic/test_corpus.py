import asyncio

import pytest

from engine.schema_analyzer import analyze_schema
from engine.pipeline import AnalysisTimeoutError, run_analysis_pipeline
from engine.semantic.corpus import (
    build_entity_documents,
    group_documents_by_signature,
    load_scoped_records,
)
from engine.semantic.models import AnalysisScope, EntityDocument, TableScope


def test_load_scoped_records_reads_only_selected_tables_and_required_fields(
    engine,
):
    scope = AnalysisScope(
        tables=[
            TableScope(name="users", dimensions=["name"]),
            TableScope(name="orders", dimensions=["amount"]),
        ]
    )
    schema_result = analyze_schema(engine, ["users", "orders"])

    records = load_scoped_records(engine, scope, schema_result)

    assert set(records) == {"users", "orders"}
    assert set(records["users"][0]) == {"id", "name", "class_name"}
    assert set(records["orders"][0]) == {
        "id",
        "user_id",
        "amount",
        "className",
    }


def test_document_contains_only_selected_dimensions():
    scope = AnalysisScope(
        tables=[TableScope(name="users", dimensions=["name"])]
    )

    docs = build_entity_documents(
        records={
            "users": [
                {
                    "id": 1,
                    "name": "张三",
                    "secret": "x",
                    "class_name": "User",
                }
            ]
        },
        scope=scope,
        pk_metadata={"users": ["id"]},
        class_name_fields={"users": "class_name"},
    )

    assert docs[0].dimensions == {"name": "张三"}
    assert "secret" not in docs[0].search_text
    assert docs[0].class_name == "User"


def test_normalization_preserves_original_evidence_value():
    docs = build_entity_documents(
        {"parts": [{"id": 1, "model": "  AB-c 01 "}]},
        AnalysisScope(
            tables=[TableScope(name="parts", dimensions=["model"])]
        ),
        {"parts": ["id"]},
        {"parts": None},
    )

    assert docs[0].dimensions["model"] == "  AB-c 01 "
    assert docs[0].normalized_dimensions["model"] == "ab-c01"


def test_composite_primary_key_delimiters_do_not_collide():
    docs = build_entity_documents(
        {
            "links": [
                {"left": "a|b", "right": "c"},
                {"left": "a", "right": "b|c"},
            ]
        },
        AnalysisScope(
            tables=[TableScope(name="links", dimensions=[])]
        ),
        {"links": ["left", "right"]},
        {"links": None},
    )

    assert [document.entity_id for document in docs] == [
        "links:a%7Cb|c",
        "links:a|b%7Cc",
    ]


def test_table_name_delimiters_do_not_collide_with_primary_key():
    docs = build_entity_documents(
        {
            "catalog:archive": [{"id": "42"}],
            "catalog": [{"id": "archive:42"}],
        },
        AnalysisScope(
            tables=[
                TableScope(name="catalog:archive", dimensions=[]),
                TableScope(name="catalog", dimensions=[]),
            ]
        ),
        {
            "catalog:archive": ["id"],
            "catalog": ["id"],
        },
        {
            "catalog:archive": None,
            "catalog": None,
        },
    )

    assert [document.entity_id for document in docs] == [
        "catalog%3Aarchive:42",
        "catalog:archive%3A42",
    ]


def test_identical_normalized_signatures_share_one_inference_group():
    groups = group_documents_by_signature(
        [
            EntityDocument(
                entity_id="operation:1",
                table_name="operation",
                display_name=" 张三 ",
                dimensions={"operator": " 张三 "},
                normalized_dimensions={"operator": "张三"},
                search_text="操作人：张三",
            ),
            EntityDocument(
                entity_id="operation:2",
                table_name="operation",
                display_name="张三",
                dimensions={"operator": "张三"},
                normalized_dimensions={"operator": "张三"},
                search_text="操作人：张三",
            ),
        ]
    )

    assert len(groups) == 1
    assert groups[0].entity_ids == ["operation:1", "operation:2"]


def test_pipeline_does_not_send_system_fields_to_ai(
    engine,
    monkeypatch,
):
    captured: dict[str, object] = {}

    def capture_ai_input(table_schemas, sample_values):
        captured["table_schemas"] = table_schemas
        captured["sample_values"] = sample_values
        return []

    monkeypatch.setattr(
        "engine.pipeline.decide_matches",
        capture_ai_input,
    )

    asyncio.run(
        run_analysis_pipeline(
            engine,
            [
                {
                    "name": "users",
                    "fields": ["id", "name", "class_name"],
                }
            ],
        )
    )

    columns = captured["table_schemas"][0]["columns"]
    assert [column["name"] for column in columns] == ["name"]
    assert set(captured["sample_values"]["users"][0]) == {"name"}


def test_schema_failure_is_attributed_to_schema_progress_phase(
    engine,
    monkeypatch,
):
    progress_events: list[tuple[int, str]] = []

    def fail_schema_analysis(engine, selected_names):
        raise RuntimeError("schema unavailable")

    monkeypatch.setattr(
        "engine.pipeline.analyze_schema",
        fail_schema_analysis,
    )

    with pytest.raises(RuntimeError, match="schema unavailable"):
        asyncio.run(
            run_analysis_pipeline(
                engine,
                [{"name": "users", "fields": ["name"]}],
                on_progress=lambda phase, message, progress: (
                    progress_events.append((phase, message))
                ),
            )
        )

    assert progress_events[-1][0] == 1
    assert "Schema" in progress_events[-1][1]


def test_schema_timeout_is_reported_before_schema_completion(
    engine,
    monkeypatch,
):
    progress_events: list[tuple[int, str]] = []
    clock_values = iter([0.0, 181.0])

    class FakeEventLoop:
        def time(self):
            return next(clock_values)

    async def run_with_fake_clock():
        monkeypatch.setattr(
            "engine.pipeline.asyncio.get_event_loop",
            lambda: FakeEventLoop(),
        )
        await run_analysis_pipeline(
            engine,
            [{"name": "users", "fields": ["name"]}],
            timeout_seconds=180.0,
            on_progress=lambda phase, message, progress: (
                progress_events.append((phase, message))
            ),
        )

    with pytest.raises(AnalysisTimeoutError):
        asyncio.run(run_with_fake_clock())

    assert progress_events == [(1, "正在分析 Schema...")]
