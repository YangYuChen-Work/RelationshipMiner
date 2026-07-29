from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from config import settings

from .interfaces import JsonLlmAdapter
from .models import (
    CandidateGroup,
    EntityDocument,
    JudgementBatchResult,
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

    approved: bool
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
        self._semaphore = asyncio.Semaphore(limit)

    async def judge_groups(
        self,
        groups: list[CandidateGroup],
        deadline: float,
    ) -> JudgementBatchResult:
        if time.monotonic() >= deadline:
            return JudgementBatchResult(
                decisions=[],
                pending_groups=len(groups),
            )

        tasks = [
            asyncio.create_task(self._judge_group(group, deadline))
            for group in groups
        ]
        try:
            outcomes = await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise

        return JudgementBatchResult(
            decisions=[
                decision
                for outcome in outcomes
                for decision in outcome.decisions
            ],
            completed_groups=sum(
                outcome.status == "completed" for outcome in outcomes
            ),
            failed_groups=sum(
                outcome.status == "failed" for outcome in outcomes
            ),
            pending_groups=sum(
                outcome.status == "pending" for outcome in outcomes
            ),
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
        "response_example": {
            "decisions": [
                {
                    "approved": True,
                    "source": group.source.entity_id,
                    "target": (
                        group.candidates[0].entity_id
                        if group.candidates
                        else "candidate_entity_id"
                    ),
                    "relation_type": group.plan.relation_type,
                    "direction": group.plan.direction,
                    "strength": "weak",
                    "confidence": 0.9,
                    "explanation": (
                        "Why the selected values support the relation."
                    ),
                    "evidence": [
                        {
                            "source_field": (
                                group.plan.source_dimensions[0]
                                if group.plan.source_dimensions
                                else "selected_source_field"
                            ),
                            "source_value": (
                                group.source.dimensions.get(
                                    group.plan.source_dimensions[0]
                                )
                                if group.plan.source_dimensions
                                else None
                            ),
                            "target_field": (
                                group.plan.target_dimensions[0]
                                if group.plan.target_dimensions
                                else "selected_target_field"
                            ),
                            "target_value": (
                                group.candidates[0].dimensions.get(
                                    group.plan.target_dimensions[0]
                                )
                                if (
                                    group.candidates
                                    and group.plan.target_dimensions
                                )
                                else None
                            ),
                            "method": "llm_semantic_reasoning",
                            "reason": (
                                "Why these selected field values match."
                            ),
                        }
                    ],
                }
            ]
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
                default=str,
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
            name: entity.dimensions[name]
            for name in dimensions
            if name in entity.dimensions
        },
    }


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
                or evidence.source_value
                != group.source.dimensions[evidence.source_field]
                or evidence.target_value
                != target.dimensions[evidence.target_field]
            ):
                raise ValueError("judgement evidence is outside its plan")

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
