"""Bounded, response-safe table semantic summary tests."""

import json

import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, insert

from database import get_table_summary_input
from engine.table_semantics import (
    TableSummaryInput,
    fallback_semantic_name,
    infer_table_summaries,
)


class FailingLlm:
    async def complete_json(self, **_kwargs):
        raise RuntimeError("offline; api_key=sk-do-not-leak")


class RecordingLlm:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload
        self.calls: list[dict[str, object]] = []

    async def complete_json(self, **kwargs):
        self.calls.append(kwargs)
        return self.payload


@pytest.mark.asyncio
async def test_summary_falls_back_without_blocking():
    result = await infer_table_summaries(
        [
            TableSummaryInput(
                table_name="assembly_process",
                row_count=128,
                name_samples=["通信卫星总装", "高增益天线装配"],
                class_name_samples=["com.example.AssemblyProcess"],
                column_names=["id", "name", "class_name"],
            )
        ],
        FailingLlm(),
    )

    assert result[0].semantic_name == "Assembly Process 数据"
    assert result[0].status == "fallback"
    assert "offline" not in result[0].model_dump_json()
    assert "sk-do-not-leak" not in result[0].model_dump_json()


def test_summary_inputs_keep_only_three_non_empty_bounded_samples():
    summary_input = TableSummaryInput(
        table_name="parts",
        row_count=10,
        name_samples=[" Alpha ", "", "Beta", "   ", "Gamma", "Delta"],
        class_name_samples=[
            "com.example.Alpha",
            "",
            "com.example.Beta",
            "com.example.Gamma",
            "com.example.Delta",
        ],
        column_names=["id", "name", "class_name"],
    )

    assert summary_input.name_samples == ["Alpha", "Beta", "Gamma"]
    assert summary_input.class_name_samples == [
        "com.example.Alpha",
        "com.example.Beta",
        "com.example.Gamma",
    ]


def test_summary_inputs_drop_api_keys_from_samples():
    summary_input = TableSummaryInput(
        table_name="parts",
        row_count=2,
        name_samples=["api_key=sk-private123", "Safe business name"],
        class_name_samples=["secret=sk-private456", "com.example.Part"],
        column_names=["id", "name", "class_name"],
    )

    assert summary_input.name_samples == ["Safe business name"]
    assert summary_input.class_name_samples == ["com.example.Part"]
    assert "sk-private" not in summary_input.model_dump_json()


def test_table_summary_collection_is_bounded_to_required_fields(engine):
    metadata = MetaData()
    table = Table(
        "assembly_process",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String(300)),
        Column("className", String(300)),
        Column("internal_secret", String(300)),
    )
    metadata.create_all(engine)
    long_name = "装" * 100
    with engine.begin() as connection:
        connection.execute(
            insert(table),
            [
                {
                    "id": 1,
                    "name": long_name,
                    "className": "com.example.First",
                    "internal_secret": "api_key=sk-never-return",
                },
                {
                    "id": 2,
                    "name": "卫星总装",
                    "className": "com.example.Second",
                    "internal_secret": "private-row-value",
                },
                {
                    "id": 3,
                    "name": "天线装配",
                    "className": "com.example.Third",
                    "internal_secret": "private-row-value",
                },
                {
                    "id": 4,
                    "name": "",
                    "className": "com.example.EmptyName",
                    "internal_secret": "private-row-value",
                },
            ],
        )

    result = get_table_summary_input(engine, "assembly_process", sample_limit=99)

    assert result.row_count == 4
    assert len(result.name_samples) == 3
    assert len(result.class_name_samples) == 3
    assert all(value and len(value) <= 80 for value in result.name_samples)
    assert all(value and len(value) <= 80 for value in result.class_name_samples)
    assert result.column_names == ["id", "name", "className", "internal_secret"]
    assert "private-row-value" not in result.model_dump_json()
    assert "sk-never-return" not in result.model_dump_json()


def test_table_summary_collection_requires_both_business_roles(engine):
    with pytest.raises(ValueError, match="required name and class_name fields"):
        get_table_summary_input(engine, "categories")


@pytest.mark.asyncio
async def test_summary_inference_uses_one_validated_batch():
    llm = RecordingLlm(
        {
            "summaries": [
                {
                    "table_name": "assembly_process",
                    "semantic_name": "装配工艺数据",
                }
            ]
        }
    )
    inputs = [
        TableSummaryInput(
            table_name="assembly_process",
            row_count=128,
            name_samples=["通信卫星总装"],
            class_name_samples=["com.example.AssemblyProcess"],
            column_names=["id", "name", "class_name"],
        )
    ]

    result = await infer_table_summaries(inputs, llm)

    assert len(llm.calls) == 1
    assert llm.calls[0]["response_model"] is not None
    messages = llm.calls[0]["messages"]
    assert '"summaries"' in messages[0]["content"]
    assert json.loads(messages[1]["content"])["tables"] == [
        inputs[0].model_dump()
    ]
    assert result[0].semantic_name == "装配工艺数据"
    assert result[0].status == "inferred"


@pytest.mark.asyncio
async def test_missing_inference_item_uses_fallback_without_losing_valid_item():
    llm = RecordingLlm(
        {
            "summaries": [
                {"table_name": "users", "semantic_name": "用户数据"},
            ]
        }
    )
    inputs = [
        TableSummaryInput(
            table_name="users",
            row_count=2,
            name_samples=["Alice"],
            class_name_samples=["com.example.User"],
            column_names=["id", "name", "class_name"],
        ),
        TableSummaryInput(
            table_name="orders",
            row_count=2,
            name_samples=["Order 1"],
            class_name_samples=["com.example.Order"],
            column_names=["id", "name", "className"],
        ),
    ]

    result = await infer_table_summaries(inputs, llm)

    assert [(item.table_name, item.status) for item in result] == [
        ("users", "inferred"),
        ("orders", "fallback"),
    ]
    assert result[1].semantic_name == "Orders 数据"


@pytest.mark.asyncio
async def test_unknown_inference_table_invalidates_untrusted_response():
    llm = RecordingLlm(
        {
            "summaries": [
                {"table_name": "users", "semantic_name": "用户数据"},
                {
                    "table_name": "api_key=sk-injected",
                    "semantic_name": "泄露数据",
                },
            ]
        }
    )
    inputs = [
        TableSummaryInput(
            table_name="users",
            row_count=2,
            name_samples=["Alice"],
            class_name_samples=["com.example.User"],
            column_names=["id", "name", "class_name"],
        )
    ]

    result = await infer_table_summaries(inputs, llm)

    assert result[0].status == "fallback"
    assert "sk-injected" not in result[0].model_dump_json()


@pytest.mark.asyncio
async def test_api_key_in_inferred_name_is_rejected():
    llm = RecordingLlm(
        {
            "summaries": [
                {
                    "table_name": "users",
                    "semantic_name": "api_key=sk-injected123",
                },
            ]
        }
    )
    inputs = [
        TableSummaryInput(
            table_name="users",
            row_count=2,
            name_samples=["Alice"],
            class_name_samples=["com.example.User"],
            column_names=["id", "name", "class_name"],
        )
    ]

    result = await infer_table_summaries(inputs, llm)

    assert result[0].status == "fallback"
    assert "sk-injected" not in result[0].model_dump_json()


def test_fallback_semantic_name_handles_camel_and_empty_names():
    assert fallback_semantic_name("assemblyProcess") == "Assembly Process 数据"
    assert fallback_semantic_name("---") == "业务 数据"
