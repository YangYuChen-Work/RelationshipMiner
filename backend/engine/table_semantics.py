"""Bounded table metadata inference for business-facing browse summaries."""

import asyncio
import json
import re
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field, field_validator


MAX_SAMPLE_COUNT = 3
MAX_SAMPLE_LENGTH = 80
_SENSITIVE_TEXT = re.compile(
    r"(?i)(?:api[_-]?key|password|secret|access[_-]?token)\s*[:=]"
    r"|\bsk-[a-z0-9_-]{6,}"
)


def _contains_sensitive_text(value: str) -> bool:
    return _SENSITIVE_TEXT.search(value) is not None


def _bounded_samples(values: object) -> list[str]:
    if not isinstance(values, (list, tuple)):
        return []
    samples: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        cleaned = value.strip()
        if not cleaned or _contains_sensitive_text(cleaned):
            continue
        samples.append(cleaned[:MAX_SAMPLE_LENGTH])
        if len(samples) == MAX_SAMPLE_COUNT:
            break
    return samples


class TableSummaryInput(BaseModel):
    """Response-safe, bounded evidence used only for table-name inference."""

    model_config = ConfigDict(extra="forbid")

    table_name: str
    row_count: int = Field(ge=0)
    name_samples: list[str]
    class_name_samples: list[str]
    column_names: list[str]

    @field_validator("name_samples", "class_name_samples", mode="before")
    @classmethod
    def bound_samples(cls, values: object) -> list[str]:
        return _bounded_samples(values)


class TableBusinessSummary(BaseModel):
    """Business-facing summary that contains no inference diagnostics."""

    model_config = ConfigDict(extra="forbid")

    table_name: str
    semantic_name: str
    row_count: int = Field(ge=0)
    name_samples: list[str]
    status: Literal["inferred", "fallback"]

    @field_validator("name_samples", mode="before")
    @classmethod
    def bound_name_samples(cls, values: object) -> list[str]:
        return _bounded_samples(values)


class _SemanticName(BaseModel):
    model_config = ConfigDict(extra="forbid")

    table_name: str = Field(min_length=1)
    semantic_name: str = Field(min_length=1, max_length=40)

    @field_validator("table_name", "semantic_name")
    @classmethod
    def strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("value must not be blank")
        return cleaned


class _SemanticNameEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summaries: list[_SemanticName]


class JsonLlm(Protocol):
    async def complete_json(
        self,
        *,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]: ...


def fallback_semantic_name(table_name: str) -> str:
    words = (
        re.sub(r"(?<!^)(?=[A-Z])", "_", table_name)
        .replace("-", "_")
        .split("_")
    )
    readable = " ".join(word.capitalize() for word in words if word)
    return f"{readable or '业务'} 数据"


def _fallback_summary(summary_input: TableSummaryInput) -> TableBusinessSummary:
    return TableBusinessSummary(
        table_name=summary_input.table_name,
        semantic_name=fallback_semantic_name(summary_input.table_name),
        row_count=summary_input.row_count,
        name_samples=summary_input.name_samples,
        status="fallback",
    )


def _messages(inputs: list[TableSummaryInput]) -> list[dict[str, object]]:
    evidence = [summary_input.model_dump() for summary_input in inputs]
    return [
        {
            "role": "system",
            "content": (
                "你为数据库表生成简短的中文业务类别名称。综合表名、对象类型、"
                "少量业务名称示例和字段结构判断类别。semantic_name 必须是业务"
                "类别，不得是某条记录名称、Java 类路径、数据库字段类型或技术"
                "诊断。每个输入表恰好返回一项。输出形状必须是 "
                '{"summaries":[{"table_name":"输入表名",'
                '"semantic_name":"中文业务类别"}]}，不得增加其他字段。'
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                {"tables": evidence}, ensure_ascii=False, separators=(",", ":")
            ),
        },
    ]


def _validated_semantic_names(
    payload: object,
    inputs: list[TableSummaryInput],
) -> dict[str, str]:
    envelope = _SemanticNameEnvelope.model_validate(payload)
    inputs_by_name = {
        summary_input.table_name: summary_input for summary_input in inputs
    }
    inferred: dict[str, str] = {}
    for item in envelope.summaries:
        if item.table_name not in inputs_by_name:
            raise ValueError("response contains an unknown table")
        if item.table_name in inferred:
            raise ValueError("response contains a duplicate table")
        source = inputs_by_name[item.table_name]
        if item.semantic_name in source.name_samples:
            raise ValueError("response contains a record name")
        if item.semantic_name in source.class_name_samples:
            raise ValueError("response contains a class path")
        if _contains_sensitive_text(item.semantic_name):
            raise ValueError("response contains sensitive text")
        inferred[item.table_name] = item.semantic_name
    return inferred


async def infer_table_summaries(
    inputs: list[TableSummaryInput],
    llm: JsonLlm,
) -> list[TableBusinessSummary]:
    """Infer all semantic names in one request, falling back per missing item."""

    if not inputs:
        return []

    try:
        async with asyncio.timeout(8):
            payload = await llm.complete_json(
                messages=_messages(inputs),
                max_tokens=2048,
                response_model=_SemanticNameEnvelope,
            )
        inferred = _validated_semantic_names(payload, inputs)
    except Exception:
        inferred = {}

    return [
        TableBusinessSummary(
            table_name=summary_input.table_name,
            semantic_name=inferred[summary_input.table_name],
            row_count=summary_input.row_count,
            name_samples=summary_input.name_samples,
            status="inferred",
        )
        if summary_input.table_name in inferred
        else _fallback_summary(summary_input)
        for summary_input in inputs
    ]
