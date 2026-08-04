from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pydantic import BaseModel

from engine.deepseek_client import DeepSeekJsonAdapter, LlmBatchError
from engine.schema_analyzer import ColumnMeta, TableSchema
from engine.semantic.models import AnalysisScope, TableScope
from engine.semantic.planner import RelationshipPlanner


class _ExpectedPayload(BaseModel):
    plans: list[dict[str, object]]


def _completion(
    content: str | None,
    *,
    finish_reason: str = "stop",
) -> SimpleNamespace:
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                finish_reason=finish_reason,
                message=SimpleNamespace(content=content),
            )
        ]
    )


def _adapter_with_responses(
    *responses: SimpleNamespace,
) -> tuple[DeepSeekJsonAdapter, AsyncMock]:
    create = AsyncMock(side_effect=responses)
    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=create),
        )
    )
    return (
        DeepSeekJsonAdapter(
            api_key="test-key",
            model="deepseek-v4-flash",
            client=client,
        ),
        create,
    )


def _messages() -> list[dict[str, object]]:
    return [
        {
            "role": "user",
            "content": (
                'Return JSON like {"plans": []}.'
            ),
        }
    ]


@pytest.mark.parametrize(
    "invalid_timeout",
    [0, -1, float("inf"), float("nan")],
    ids=["zero", "negative", "infinite", "nan"],
)
def test_json_adapter_rejects_non_positive_or_non_finite_timeout(
    invalid_timeout: float,
):
    with pytest.raises(ValueError, match="request_timeout_seconds"):
        DeepSeekJsonAdapter(
            api_key="test-key",
            request_timeout_seconds=invalid_timeout,
        )


@pytest.mark.asyncio
async def test_json_adapter_requests_json_output_with_planner_token_limit():
    adapter, create = _adapter_with_responses(
        _completion('{"plans": []}'),
    )

    result = await adapter.complete_json(_messages(), max_tokens=4096)

    assert result == {"plans": []}
    request = create.await_args.kwargs
    assert request["response_format"] == {"type": "json_object"}
    assert request["max_tokens"] == 4096
    assert request["model"] == "deepseek-v4-flash"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("first_response", "error_fragment"),
    [
        (_completion(""), "empty"),
        (
            _completion('{"plans": [', finish_reason="length"),
            "length",
        ),
        (_completion("not json"), "JSON"),
    ],
    ids=["empty", "truncated", "invalid-json"],
)
async def test_json_adapter_repairs_invalid_output_once(
    first_response: SimpleNamespace,
    error_fragment: str,
):
    adapter, create = _adapter_with_responses(
        first_response,
        _completion('{"plans": []}'),
    )

    result = await adapter.complete_json(_messages(), max_tokens=4096)

    assert result == {"plans": []}
    assert create.await_count == 2
    repair_prompt = create.await_args.kwargs["messages"][-1]["content"]
    assert error_fragment.lower() in repair_prompt.lower()


@pytest.mark.asyncio
async def test_json_adapter_repairs_pydantic_invalid_output_once():
    adapter, create = _adapter_with_responses(
        _completion('{"wrong": []}'),
        _completion('{"plans": []}'),
    )

    result = await adapter.complete_json(
        _messages(),
        max_tokens=4096,
        response_model=_ExpectedPayload,
    )

    assert result == {"plans": []}
    assert create.await_count == 2
    repair_prompt = create.await_args.kwargs["messages"][-1]["content"]
    assert "plans" in repair_prompt
    assert "validation" in repair_prompt.lower()
    assert "requested example" not in repair_prompt.lower()
    assert "requested contract" in repair_prompt.lower()


class _NeverCompletingCreate:
    def __init__(self):
        self.attempts = 0
        self.cancelled_attempts = 0

    async def __call__(self, **_: object) -> SimpleNamespace:
        self.attempts += 1
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled_attempts += 1
            raise
        raise AssertionError("unreachable")


@pytest.mark.asyncio
async def test_json_adapter_times_out_and_cancels_each_provider_attempt():
    create = _NeverCompletingCreate()
    client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=create),
        )
    )
    adapter = DeepSeekJsonAdapter(
        api_key="test-key",
        model="deepseek-v4-flash",
        client=client,
        request_timeout_seconds=0.01,
    )

    with pytest.raises(LlmBatchError, match="timed out"):
        await adapter.complete_json(_messages(), max_tokens=4096)

    assert create.attempts == 2
    assert create.cancelled_attempts == 2


@pytest.mark.asyncio
async def test_json_adapter_repairs_non_object_json_once():
    adapter, create = _adapter_with_responses(
        _completion("[]"),
        _completion('{"plans": []}'),
    )

    result = await adapter.complete_json(_messages(), max_tokens=4096)

    assert result == {"plans": []}
    assert create.await_count == 2
    repair_prompt = create.await_args.kwargs["messages"][-1]["content"]
    assert "object" in repair_prompt


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_response",
    [
        _completion(""),
        _completion('{"plans": [', finish_reason="length"),
        _completion("not json"),
        _completion("[]"),
        _completion('{"wrong": []}'),
    ],
    ids=[
        "empty",
        "truncated",
        "invalid-json",
        "non-object",
        "pydantic-invalid",
    ],
)
async def test_json_adapter_raises_after_second_invalid_output(
    bad_response: SimpleNamespace,
):
    adapter, create = _adapter_with_responses(
        bad_response,
        bad_response,
    )
    response_model = (
        _ExpectedPayload
        if bad_response.choices[0].message.content == '{"wrong": []}'
        else None
    )

    with pytest.raises(LlmBatchError):
        await adapter.complete_json(
            _messages(),
            max_tokens=4096,
            response_model=response_model,
        )

    assert create.await_count == 2


class _TransparentJsonAdapter:
    def __init__(self, delegate: DeepSeekJsonAdapter):
        self._delegate = delegate

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]:
        return await self._delegate.complete_json(
            messages,
            max_tokens,
            response_model=response_model,
        )


def _scope() -> AnalysisScope:
    return AnalysisScope(
        tables=[
            TableScope(
                name="process",
                dimensions=[
                    "process_key",
                    "process_name",
                    "description",
                ],
            ),
            TableScope(
                name="part",
                dimensions=["part_name", "class_name"],
            ),
        ]
    )


def _schemas() -> dict[str, TableSchema]:
    return {
        "process": TableSchema(
            name="process",
            columns=[
                ColumnMeta(
                    name="process_key",
                    type="INTEGER",
                    nullable=False,
                    is_class_name=False,
                    is_primary_key=True,
                ),
                ColumnMeta(
                    name="process_name",
                    type="VARCHAR(200)",
                    nullable=False,
                    is_class_name=False,
                ),
                ColumnMeta(
                    name="description",
                    type="TEXT",
                    nullable=True,
                    is_class_name=False,
                ),
                ColumnMeta(
                    name="part_fk",
                    type="INTEGER",
                    nullable=True,
                    is_class_name=False,
                ),
                ColumnMeta(
                    name="className",
                    type="VARCHAR(200)",
                    nullable=True,
                    is_class_name=True,
                ),
                ColumnMeta(
                    name="private_note",
                    type="TEXT",
                    nullable=True,
                    is_class_name=False,
                ),
            ],
            primary_keys=["process_key"],
        ),
        "part": TableSchema(
            name="part",
            columns=[
                ColumnMeta(
                    name="part_key",
                    type="INTEGER",
                    nullable=False,
                    is_class_name=False,
                    is_primary_key=True,
                ),
                ColumnMeta(
                    name="part_name",
                    type="VARCHAR(200)",
                    nullable=False,
                    is_class_name=False,
                ),
                ColumnMeta(
                    name="class_name",
                    type="VARCHAR(200)",
                    nullable=True,
                    is_class_name=True,
                ),
                ColumnMeta(
                    name="supplier_code",
                    type="VARCHAR(20)",
                    nullable=True,
                    is_class_name=False,
                ),
            ],
            primary_keys=["part_key"],
        ),
    }


def _samples() -> dict[str, list[dict[str, object]]]:
    return {
        "process": [
            {
                "process_key": 901,
                "process_name": "Rotor assembly",
                "description": "Install rotor into housing",
                "part_fk": 101,
                "className": "HiddenProcessClass",
                "private_note": "Do not expose this note",
            },
            {
                "process_name": "Ignored second sample",
            },
        ],
        "part": [
            {
                "part_key": 101,
                "part_name": "Rotor",
                "class_name": "RotorPart",
                "supplier_code": "SUP-SECRET",
            }
        ],
    }


def _valid_plan() -> dict[str, object]:
    return {
        "source_table": "process",
        "target_table": "part",
        "relation_type": "process_uses_part",
        "display_label": "使用",
        "direction": "source_to_target",
        "source_dimensions": ["process_name", "description"],
        "target_dimensions": ["part_name", "class_name"],
        "retrieval_modes": ["keyword", "semantic"],
        "candidate_limit_per_source": 20,
        "reason": "Process text can identify the related part.",
    }


@pytest.mark.asyncio
async def test_planner_preserves_internal_type_and_business_display_label():
    plan = {
        **_valid_plan(),
        "relation_type": "assembly_containment",
        "display_label": "包含",
    }

    plans = await RelationshipPlanner(
        _RecordingLlm({"plans": [plan]})
    ).plan(_scope(), _schemas(), _samples())

    assert plans[0].relation_type == "assembly_containment"
    assert plans[0].display_label == "包含"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "display_label",
    [
        "owner_id关联",
        "processUses零件",
        "关联_code",
        "使",
        "一二三四五六七八九十甲乙丙",
    ],
    ids=["snake-cjk", "camel-cjk", "cjk-snake", "too-short", "too-long"],
)
async def test_planner_rejects_malformed_business_display_labels(
    display_label: str,
):
    plan = {**_valid_plan(), "display_label": display_label}

    with pytest.raises(ValueError):
        await RelationshipPlanner(
            _RecordingLlm({"plans": [plan]})
        ).plan(_scope(), _schemas(), _samples())


class _RecordingLlm:
    def __init__(self, payload: dict[str, object]):
        self.payload = payload
        self.messages: list[dict[str, object]] | None = None
        self.max_tokens: int | None = None

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]:
        self.messages = messages
        self.max_tokens = max_tokens
        if response_model is not None:
            return response_model.model_validate(
                self.payload
            ).model_dump()
        return self.payload


@pytest.mark.asyncio
async def test_planner_prompt_contains_only_selected_semantic_fields():
    llm = _RecordingLlm({"plans": [_valid_plan()]})

    plans = await RelationshipPlanner(llm).plan(
        _scope(),
        _schemas(),
        _samples(),
    )

    assert len(plans) == 1
    assert llm.max_tokens == 8192
    prompt = json.dumps(llm.messages, ensure_ascii=False)
    for selected in (
        "process",
        "part",
        "process_name",
        "description",
        "part_name",
        "class_name",
        "VARCHAR(200)",
        "TEXT",
        "Rotor assembly",
        "Install rotor into housing",
        "Rotor",
        "RotorPart",
    ):
        assert selected in prompt
    for forbidden in (
        "process_key",
        "part_key",
        "part_fk",
        "className",
        "private_note",
        "supplier_code",
        "HiddenProcessClass",
        "Do not expose this note",
        "SUP-SECRET",
        "Ignored second sample",
    ):
        assert forbidden not in prompt


@pytest.mark.asyncio
async def test_planner_rejects_unselected_dimensions_and_tables():
    unselected_dimension = {
        **_valid_plan(),
        "source_dimensions": ["private_note"],
    }
    unselected_table = {
        **_valid_plan(),
        "target_table": "supplier",
    }
    selected_primary_key = {
        **_valid_plan(),
        "source_dimensions": ["process_key"],
    }
    llm = _RecordingLlm(
        {
            "plans": [
                _valid_plan(),
                unselected_dimension,
                unselected_table,
                selected_primary_key,
            ]
        }
    )

    with pytest.raises(ValueError):
        await RelationshipPlanner(llm).plan(
            _scope(),
            _schemas(),
            _samples(),
        )


@pytest.mark.asyncio
async def test_planner_retries_pydantic_invalid_plan_with_validation_errors():
    adapter, create = _adapter_with_responses(
        _completion(
            json.dumps(
                {
                    "plans": [
                        {
                            "source_table": "process",
                            "target_table": "part",
                            "relation_type": "process_uses_part",
                        }
                    ]
                }
            )
        ),
        _completion(json.dumps({"plans": [_valid_plan()]})),
    )

    plans = await RelationshipPlanner(adapter).plan(
        _scope(),
        _schemas(),
        _samples(),
    )

    assert len(plans) == 1
    assert create.await_count == 2
    repair_prompt = create.await_args.kwargs["messages"][-1]["content"]
    assert "source_dimensions" in repair_prompt
    assert "validation" in repair_prompt.lower()


@pytest.mark.asyncio
async def test_transparent_adapter_keeps_planner_to_two_sdk_attempts():
    invalid_plan = json.dumps(
        {
            "plans": [
                {
                    "source_table": "process",
                    "target_table": "part",
                    "relation_type": "process_uses_part",
                }
            ]
        }
    )
    adapter, create = _adapter_with_responses(
        _completion("not json"),
        _completion(invalid_plan),
        _completion("not json"),
        _completion(invalid_plan),
    )

    with pytest.raises(LlmBatchError):
        await RelationshipPlanner(
            _TransparentJsonAdapter(adapter)
        ).plan(
            _scope(),
            _schemas(),
            _samples(),
        )

    assert create.await_count == 2


@pytest.mark.asyncio
async def test_planner_deduplicates_identical_valid_plans_before_applying_cap(
    monkeypatch,
):
    from engine.semantic import planner

    monkeypatch.setattr(planner.settings, "RELATIONSHIP_PLAN_LIMIT", 1)
    llm = _RecordingLlm({"plans": [_valid_plan(), _valid_plan()]})

    plans = await RelationshipPlanner(llm).plan(
        _scope(),
        _schemas(),
        _samples(),
    )

    assert plans == [plans[0]]


@pytest.mark.asyncio
async def test_planner_rejects_invalid_or_excess_distinct_output(monkeypatch):
    from engine.semantic import planner

    monkeypatch.setattr(planner.settings, "RELATIONSHIP_PLAN_LIMIT", 1)
    second_plan = {
        **_valid_plan(),
        "source_table": "part",
        "target_table": "process",
        "source_dimensions": ["part_name"],
        "target_dimensions": ["process_name"],
    }
    for payload in (
        {"plans": [{**_valid_plan(), "source_dimensions": ["private_note"]}]},
        {"plans": [_valid_plan(), second_plan]},
    ):
        with pytest.raises(ValueError):
            await RelationshipPlanner(_RecordingLlm(payload)).plan(
                _scope(),
                _schemas(),
                _samples(),
            )
