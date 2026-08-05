import json
from types import SimpleNamespace
from typing import Any

import pytest

from engine.natural_selection.catalog import build_catalog_snapshot
from engine.deepseek_client import DeepSeekJsonAdapter, LlmBatchError
from engine.natural_selection.glossary import Glossary
from engine.natural_selection.models import GlossaryMapping
from engine.natural_selection.service import (
    NaturalSelectionService,
    SelectionUnavailable,
)


class RecordingModel:
    """A model boundary fake which retains its structured requests."""

    def __init__(self, response: dict[str, object]) -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[object],
    ) -> dict[str, object]:
        self.calls.append(
            {
                "messages": messages,
                "max_tokens": max_tokens,
                "response_model": response_model,
            }
        )
        return self.response


class FailingModel:
    async def complete_json(self, **_: object) -> dict[str, object]:
        raise RuntimeError("provider unavailable")


class InvalidJsonModel:
    async def complete_json(self, **_: object) -> dict[str, object]:
        raise json.JSONDecodeError("invalid JSON", "{", 1)


class InvalidJsonCompletions:
    """Minimal provider fake that returns malformed JSON on each adapter retry."""

    def __init__(self, content: str) -> None:
        self.calls = 0
        self.content = content

    async def create(self, **_: object) -> object:
        self.calls += 1
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    finish_reason="stop",
                    message=SimpleNamespace(content=self.content),
                )
            ],
            usage=SimpleNamespace(total_tokens=1),
        )


class InvalidJsonAdapterClient:
    """Minimal OpenAI-compatible client tree consumed by DeepSeekJsonAdapter."""

    def __init__(self, content: str) -> None:
        self.completions = InvalidJsonCompletions(content)
        self.chat = SimpleNamespace(completions=self.completions)


class AdapterUnavailableModel:
    """Matches an adapter transport or configuration failure."""

    async def complete_json(self, **_: object) -> dict[str, object]:
        raise LlmBatchError("DeepSeek API key is not configured")


@pytest.fixture
def snapshot(engine):
    return build_catalog_snapshot(engine)


@pytest.fixture
def empty_glossary() -> Glossary:
    return Glossary(version="test", mappings=())


def selector(glossary: Glossary, model: object) -> NaturalSelectionService:
    return NaturalSelectionService(glossary=glossary, model=model)


@pytest.mark.asyncio
async def test_unmatched_glossary_still_allows_semantic_selection_from_catalog(
    snapshot, empty_glossary
) -> None:
    """Dropping catalog tables when YAML misses would make semantic fallback fail."""

    model = RecordingModel(
        {
            "status": "selected",
            "tables": [
                {
                    "table_name": "orders",
                    "field_selection": "all",
                    "auxiliary_fields": [],
                    "reason": "订单交易信息",
                }
            ],
        }
    )

    result = await selector(empty_glossary, model).select("查看交易链路", snapshot)

    assert result.status == "selected"
    assert result.tables[0].name == "orders"
    assert result.tables[0].auxiliary_fields == ["amount"]
    prompt_payload = json.loads(model.calls[0]["messages"][1]["content"])
    assert {item["name"] for item in prompt_payload["tables"]} == {
        "users",
        "orders",
        "products",
    }
    assert "Alice" not in json.dumps(model.calls[0]["messages"], ensure_ascii=False)


@pytest.mark.asyncio
async def test_model_failure_is_unavailable_not_user_clarification(
    snapshot, empty_glossary
) -> None:
    """Provider errors must not tell the user to alter an otherwise valid request."""

    with pytest.raises(SelectionUnavailable, match="MODEL_UNAVAILABLE"):
        await selector(empty_glossary, FailingModel()).select("分析订单", snapshot)


@pytest.mark.asyncio
async def test_invalid_json_is_invalid_model_output_not_provider_unavailable(
    snapshot, empty_glossary
) -> None:
    """Misclassifying malformed model JSON would make recovery guidance incorrect."""

    with pytest.raises(SelectionUnavailable, match="INVALID_MODEL_OUTPUT"):
        await selector(empty_glossary, InvalidJsonModel()).select("分析订单", snapshot)


@pytest.mark.asyncio
async def test_adapter_malformed_output_category_remains_invalid_model_output(
    snapshot, empty_glossary
) -> None:
    """Discarding the adapter's parse category would misclassify production JSON failures."""

    client = InvalidJsonAdapterClient("{not valid JSON")
    model = DeepSeekJsonAdapter(api_key="test-key", client=client)

    with pytest.raises(SelectionUnavailable, match="INVALID_MODEL_OUTPUT"):
        await selector(empty_glossary, model).select("分析订单", snapshot)

    assert client.completions.calls == 2


@pytest.mark.asyncio
async def test_adapter_contract_failure_remains_invalid_model_output(
    snapshot, empty_glossary
) -> None:
    """Discarding the adapter's schema category would hide provider contract failures."""

    client = InvalidJsonAdapterClient('{"status":"not-a-selection-status"}')
    model = DeepSeekJsonAdapter(api_key="test-key", client=client)

    with pytest.raises(SelectionUnavailable, match="INVALID_MODEL_OUTPUT"):
        await selector(empty_glossary, model).select("分析订单", snapshot)

    assert client.completions.calls == 2


@pytest.mark.asyncio
async def test_adapter_transport_category_remains_model_unavailable(
    snapshot, empty_glossary
) -> None:
    """Adapter configuration and transport failures must not masquerade as bad JSON."""

    with pytest.raises(SelectionUnavailable, match="MODEL_UNAVAILABLE"):
        await selector(empty_glossary, AdapterUnavailableModel()).select(
            "分析订单", snapshot
        )


@pytest.mark.asyncio
async def test_multi_table_glossary_alias_is_sent_as_non_filtering_evidence(
    snapshot,
) -> None:
    """Discarding one alias target would hide configured ambiguity from the model."""

    glossary = Glossary(
        version="test",
        mappings=(
            GlossaryMapping(aliases=("订单",), tables=("users", "orders")),
        ),
    )
    model = RecordingModel(
        {
            "status": "selected",
            "tables": [
                {
                    "table_name": "orders",
                    "field_selection": "all",
                    "auxiliary_fields": [],
                    "reason": "订单数据",
                }
            ],
        }
    )

    await selector(glossary, model).select("分析订单", snapshot)

    prompt_payload = json.loads(model.calls[0]["messages"][1]["content"])
    assert prompt_payload["glossary_hits"] == [
        {"alias": "订单", "table_name": "users"},
        {"alias": "订单", "table_name": "orders"},
    ]
    assert {item["name"] for item in prompt_payload["tables"]} == {
        "users",
        "orders",
        "products",
    }


@pytest.mark.asyncio
async def test_specified_field_selection_remains_exact(snapshot, empty_glossary) -> None:
    """Expanding an explicitly constrained field set would override user intent."""

    model = RecordingModel(
        {
            "status": "selected",
            "tables": [
                {
                    "table_name": "products",
                    "field_selection": "specified",
                    "auxiliary_fields": ["title"],
                    "reason": "商品标题",
                }
            ],
        }
    )

    result = await selector(empty_glossary, model).select("查看商品标题", snapshot)

    assert result.tables[0].auxiliary_fields == ["title"]


@pytest.mark.asyncio
async def test_model_declared_clarification_preserves_safe_guidance(
    snapshot, empty_glossary
) -> None:
    """Replacing model clarification guidance would remove the user-safe next step."""

    model = RecordingModel(
        {
            "status": "needs_clarification",
            "reason_code": "AMBIGUOUS_SCOPE",
            "guidance": "请说明要分析销售订单还是采购订单。",
            "suggested_questions": ["需要哪类订单？"],
        }
    )

    result = await selector(empty_glossary, model).select("分析订单", snapshot)

    assert result.status == "needs_clarification"
    assert result.reason_code == "AMBIGUOUS_SCOPE"
    assert result.guidance == "请说明要分析销售订单还是采购订单。"
    assert result.suggested_questions == ["需要哪类订单？"]


@pytest.mark.asyncio
async def test_invented_table_is_invalid_model_output(snapshot, empty_glossary) -> None:
    """Treating invented tables as clarification would blame the user for bad output."""

    model = RecordingModel(
        {
            "status": "selected",
            "tables": [
                {
                    "table_name": "invented",
                    "field_selection": "all",
                    "auxiliary_fields": [],
                    "reason": "不存在的表",
                }
            ],
        }
    )

    with pytest.raises(SelectionUnavailable, match="INVALID_MODEL_OUTPUT"):
        await selector(empty_glossary, model).select("分析订单", snapshot)


@pytest.mark.asyncio
async def test_malformed_model_contract_is_invalid_model_output(
    snapshot, empty_glossary
) -> None:
    """Accepting extra model fields would let an untrusted contract escape validation."""

    model = RecordingModel({"status": "selected", "unexpected": "value"})

    with pytest.raises(SelectionUnavailable, match="INVALID_MODEL_OUTPUT"):
        await selector(empty_glossary, model).select("分析订单", snapshot)


@pytest.mark.asyncio
async def test_more_than_ten_model_tables_becomes_scope_clarification(
    snapshot, empty_glossary
) -> None:
    """A broad result needs user scope rather than being reported as provider failure."""

    model = RecordingModel(
        {
            "status": "selected",
            "tables": [
                {
                    "table_name": "orders",
                    "field_selection": "all",
                    "auxiliary_fields": [],
                    "reason": "范围过宽",
                }
                for _ in range(11)
            ],
        }
    )

    result = await selector(empty_glossary, model).select("分析全部数据", snapshot)

    assert result.status == "needs_clarification"
    assert result.reason_code == "SCOPE_TOO_BROAD"
