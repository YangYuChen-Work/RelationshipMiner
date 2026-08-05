"""Single structured-model selection over the complete metadata catalog."""

from __future__ import annotations

import json
from typing import Protocol

from pydantic import BaseModel, ValidationError

from .glossary import Glossary
from .models import (
    CatalogSnapshot,
    GlossaryHit,
    ModelSelection,
    SelectionResponse,
    ValidatedSelection,
)
from .validator import (
    ClarificationRequired,
    InvalidModelOutput,
    validate_model_selection,
)


SELECTION_SYSTEM_PROMPT = (
    "你是分析表与辅助字段选择器。只能从 tables 中选择；不得编造表或字段。"
    "name、class_name、主键和外键不是辅助字段，绝对不得返回。"
    "若用户没有明确限定字段，field_selection 必须为 all 且 auxiliary_fields 必须为空数组。"
    "若用户明确限定字段，field_selection 必须为 specified，auxiliary_fields 只能含 "
    "tables 中存在的合法辅助字段。"
    "不生成任何数据过滤条件。选表不得超过十张。无法可靠判断时返回 "
    "needs_clarification 和中文 guidance。仅返回符合 ModelSelection 的一个 JSON 对象。"
)


class SelectionModelClient(Protocol):
    """The structured JSON completion capability used by selection."""

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel],
    ) -> dict[str, object]: ...


class SelectionUnavailable(RuntimeError):
    """The model could not provide a usable structured selection."""

    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


def _messages(
    description: str,
    snapshot: CatalogSnapshot,
    hits: list[GlossaryHit],
) -> list[dict[str, object]]:
    """Build the model context from metadata and literal glossary evidence only."""

    return [
        {"role": "system", "content": SELECTION_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "description": description,
                    "tables": [
                        table.model_dump(mode="json") for table in snapshot.tables
                    ],
                    "glossary_hits": [hit.model_dump(mode="json") for hit in hits],
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
        },
    ]


def clarification_response(decision: ModelSelection) -> SelectionResponse:
    """Return the model's safe clarification data without any proposed tables."""

    return SelectionResponse(
        status="needs_clarification",
        reason_code=decision.reason_code,
        guidance=decision.guidance,
        suggested_questions=decision.suggested_questions,
    )


def selected_response(validated: ValidatedSelection) -> SelectionResponse:
    """Return only the deterministic, expanded selected-table result."""

    return SelectionResponse(status="selected", tables=validated.tables)


class NaturalSelectionService:
    """Use glossary evidence without ever restricting semantic catalog selection."""

    def __init__(self, glossary: Glossary, model: SelectionModelClient) -> None:
        self.glossary = glossary
        self.model = model

    async def select(
        self,
        description: str,
        snapshot: CatalogSnapshot,
    ) -> SelectionResponse:
        hits = self.glossary.match(description)
        try:
            payload = await self.model.complete_json(
                messages=_messages(description, snapshot, hits),
                max_tokens=2048,
                response_model=ModelSelection,
            )
        except (json.JSONDecodeError, ValidationError) as error:
            raise SelectionUnavailable("INVALID_MODEL_OUTPUT") from error
        except Exception as error:
            raise SelectionUnavailable("MODEL_UNAVAILABLE") from error

        try:
            decision = ModelSelection.model_validate(payload)
        except (TypeError, ValidationError) as error:
            raise SelectionUnavailable("INVALID_MODEL_OUTPUT") from error

        if decision.status == "needs_clarification":
            return clarification_response(decision)

        try:
            validated = validate_model_selection(decision, snapshot)
        except ClarificationRequired as error:
            return SelectionResponse(status="needs_clarification", reason_code=error.reason_code)
        except InvalidModelOutput as error:
            raise SelectionUnavailable("INVALID_MODEL_OUTPUT") from error
        return selected_response(validated)


__all__ = [
    "NaturalSelectionService",
    "SELECTION_SYSTEM_PROMPT",
    "SelectionModelClient",
    "SelectionUnavailable",
    "clarification_response",
    "selected_response",
]
