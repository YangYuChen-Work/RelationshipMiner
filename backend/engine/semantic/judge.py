from __future__ import annotations

import asyncio
import base64
import json
import math
import time
from dataclasses import dataclass
from collections.abc import Iterable
from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from config import settings

from .interfaces import JsonLlmAdapter
from .models import (
    CandidateGroup,
    EntityDocument,
    JudgementBatchResult,
    JudgementGroupOutcome,
    RelationDecision,
    RelationEvidence,
)


class _EvidencePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_field: str
    source_value: object
    target_field: str
    target_value: object
    method: Literal["llm_semantic_reasoning"]
    reason: str


class _DecisionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: StrictBool
    source: str
    target: str
    relation_type: str
    direction: Literal[
        "source_to_target",
        "target_to_source",
        "undirected",
    ]
    strength: Literal["weak"]
    confidence: float = Field(ge=0, le=1)
    explanation: str
    evidence: list[_EvidencePayload] = Field(min_length=1)


class _JudgementEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decisions: list[_DecisionPayload]


@dataclass(frozen=True)
class _GroupOutcome:
    status: Literal["completed", "failed", "pending"]
    decisions: list[RelationDecision]


class SemanticJudge:
    def __init__(
        self,
        llm: JsonLlmAdapter,
        concurrency: int | None = None,
    ) -> None:
        limit = (
            settings.LLM_CONCURRENCY
            if concurrency is None
            else concurrency
        )
        if limit < 1:
            raise ValueError("LLM concurrency must be at least 1")
        self._llm = llm
        self._concurrency = limit
        self._semaphore = asyncio.Semaphore(limit)

    async def judge_groups(
        self,
        groups: Iterable[CandidateGroup],
        deadline: float,
    ) -> JudgementBatchResult:
        iterator = iter(groups)
        outcomes: list[tuple[CandidateGroup, _GroupOutcome]] = []

        async def worker() -> None:
            while True:
                try:
                    group = next(iterator)
                except StopIteration:
                    return
                if time.monotonic() >= deadline:
                    outcomes.append((group, _GroupOutcome("pending", [])))
                    outcomes.extend((left, _GroupOutcome("pending", [])) for left in iterator)
                    return
                outcome = await self._judge_group(group, deadline)
                outcomes.append((group, outcome))
                if time.monotonic() >= deadline:
                    outcomes.extend((left, _GroupOutcome("pending", [])) for left in iterator)
                    return

        # Exactly this many tasks are created, independent of group count.
        workers = [asyncio.create_task(worker()) for _ in range(self._concurrency)]
        try:
            await asyncio.gather(*workers)
        except asyncio.CancelledError:
            for task in workers:
                task.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            raise

        return JudgementBatchResult(
            decisions=[
                decision
                for _, outcome in outcomes
                for decision in outcome.decisions
            ],
            completed_groups=sum(
                outcome.status == "completed" for _, outcome in outcomes
            ),
            failed_groups=sum(
                outcome.status == "failed" for _, outcome in outcomes
            ),
            pending_groups=sum(
                outcome.status == "pending" for _, outcome in outcomes
            ),
            outcomes=[
                JudgementGroupOutcome(
                    source_id=group.source.entity_id,
                    candidate_count=len(group.candidates),
                    status=outcome.status,
                )
                for group, outcome in outcomes
            ],
            peak_live_tasks=len(workers),
        )

    async def _judge_group(
        self,
        group: CandidateGroup,
        deadline: float,
    ) -> _GroupOutcome:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return _GroupOutcome("pending", [])

        try:
            async with asyncio.timeout_at(deadline):
                await self._semaphore.acquire()
        except TimeoutError:
            return _GroupOutcome("pending", [])

        try:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return _GroupOutcome("pending", [])
            if not _is_valid_group(group):
                return _GroupOutcome("failed", [])

            try:
                async with asyncio.timeout_at(deadline):
                    payload = await self._llm.complete_json(
                        _build_messages(group),
                        max_tokens=4096,
                        response_model=_JudgementEnvelope,
                    )
            except TimeoutError:
                return _GroupOutcome("failed", [])
            except Exception:
                return _GroupOutcome("failed", [])

            try:
                envelope = _JudgementEnvelope.model_validate(payload)
                decisions = _validated_decisions(group, envelope)
            except (TypeError, ValueError):
                return _GroupOutcome("failed", [])
            return _GroupOutcome("completed", decisions)
        finally:
            self._semaphore.release()


def _build_messages(
    group: CandidateGroup,
) -> list[dict[str, object]]:
    request = {
        "plan": group.plan.model_dump(),
        "source": _entity_payload(
            group.source,
            group.plan.source_dimensions,
        ),
        "candidates": [
            _entity_payload(
                candidate,
                group.plan.target_dimensions,
            )
            for candidate in group.candidates
        ],
        "response_schema": {
            "root": "object containing a decisions array",
            "decision_fields": {
                "approved": "strict boolean true",
                "source": "exact supplied source entity_id",
                "target": "one exact supplied candidate entity_id",
                "relation_type": "exact planned relation_type",
                "direction": "exact planned direction",
                "strength": "weak",
                "confidence": "number from 0 through 1",
                "explanation": "non-empty relation explanation",
                "evidence": (
                    "non-empty array of selected source/target field "
                    "values, method llm_semantic_reasoning, and reason"
                ),
            },
        },
    }
    return [
        {
            "role": "system",
            "content": (
                "Judge only the proposed source-to-candidate "
                "relationships. Vector or keyword retrieval is not "
                "evidence of a relationship. Return only relationships "
                "whose selected fields explicitly support the planned "
                "relation, and mark every returned relationship with "
                "approved=true. Omit rejected candidates. Use only the "
                "supplied entity IDs, relation type, direction, and "
                "selected fields. Approved relationships are weak and "
                "must include field evidence. Return one JSON object "
                "with a decisions array and no prose."
            ),
        },
        {
            "role": "user",
            "content": json.dumps(
                request,
                ensure_ascii=False,
            ),
        },
    ]


def _entity_payload(
    entity: EntityDocument,
    dimensions: list[str],
) -> dict[str, object]:
    return {
        "entity_id": entity.entity_id,
        "table_name": entity.table_name,
        "dimensions": {
            name: _canonical_json_value(entity.dimensions[name])
            for name in dimensions
            if name in entity.dimensions
        },
    }


def _canonical_json_value(value: object) -> object:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if math.isfinite(value):
            return value
        return {"$type": "float", "value": repr(value)}
    if isinstance(value, Decimal):
        return {"$type": "decimal", "value": str(value)}
    if isinstance(value, datetime):
        return {"$type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"$type": "date", "value": value.isoformat()}
    if isinstance(value, UUID):
        return {"$type": "uuid", "value": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {
            "$type": "bytes",
            "encoding": "base64",
            "value": base64.b64encode(bytes(value)).decode("ascii"),
        }
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("JSON object keys must be strings")
        return {
            "$type": "json_object",
            "value": {
                key: _canonical_json_value(item)
                for key, item in value.items()
            },
        }
    if isinstance(value, list):
        return {
            "$type": "json_array",
            "value": [_canonical_json_value(item) for item in value],
        }
    if isinstance(value, tuple):
        return {
            "$type": "tuple",
            "value": [_canonical_json_value(item) for item in value],
        }
    raise TypeError(
        f"unsupported evidence value type: {type(value).__name__}"
    )


def _same_canonical_value(left: object, right: object) -> bool:
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return (
            left.keys() == right.keys()
            and all(
                _same_canonical_value(left[key], right[key])
                for key in left
            )
        )
    if isinstance(left, list):
        return (
            len(left) == len(right)
            and all(
                _same_canonical_value(left_item, right_item)
                for left_item, right_item in zip(left, right)
            )
        )
    return left == right


def _is_valid_group(group: CandidateGroup) -> bool:
    if group.source.table_name != group.plan.source_table:
        return False
    if any(
        name not in group.source.dimensions
        for name in group.plan.source_dimensions
    ):
        return False
    return all(
        candidate.table_name == group.plan.target_table
        and all(
            name in candidate.dimensions
            for name in group.plan.target_dimensions
        )
        for candidate in group.candidates
    )


def _validated_decisions(
    group: CandidateGroup,
    envelope: _JudgementEnvelope,
) -> list[RelationDecision]:
    candidates = {
        candidate.entity_id: candidate
        for candidate in group.candidates
    }
    decisions: list[RelationDecision] = []
    seen: dict[
        tuple[str, str, str, str],
        _DecisionPayload,
    ] = {}

    for payload in envelope.decisions:
        if (
            payload.source != group.source.entity_id
            or payload.target not in candidates
            or payload.relation_type != group.plan.relation_type
            or payload.direction != group.plan.direction
        ):
            raise ValueError("judgement is outside its candidate group")

        target = candidates[payload.target]
        for evidence in payload.evidence:
            if (
                evidence.source_field
                not in group.plan.source_dimensions
                or evidence.target_field
                not in group.plan.target_dimensions
                or not _same_canonical_value(
                    evidence.source_value,
                    _canonical_json_value(
                        group.source.dimensions[evidence.source_field]
                    ),
                )
                or not _same_canonical_value(
                    evidence.target_value,
                    _canonical_json_value(
                        target.dimensions[evidence.target_field]
                    ),
                )
            ):
                raise ValueError("judgement evidence is outside its plan")

        key = (
            payload.source,
            payload.target,
            payload.relation_type,
            payload.direction,
        )
        previous = seen.get(key)
        if previous is not None:
            if previous != payload:
                raise ValueError("conflicting duplicate judgement")
            continue
        seen[key] = payload

        if not payload.approved:
            continue
        decisions.append(
            RelationDecision(
                source=payload.source,
                target=payload.target,
                relation_type=payload.relation_type,
                direction=payload.direction,
                strength=payload.strength,
                confidence=payload.confidence,
                explanation=payload.explanation,
                evidence=[
                    RelationEvidence.model_validate(
                        evidence.model_dump()
                    )
                    for evidence in payload.evidence
                ],
            )
        )

    return decisions
