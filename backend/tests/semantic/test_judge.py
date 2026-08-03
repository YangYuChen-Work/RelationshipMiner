from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID

import pytest
from pydantic import BaseModel

from engine.semantic.deadline import DeadlineExceeded
from engine.semantic.judge import SemanticJudge
from engine.semantic.models import (
    CandidateGroup,
    EntityDocument,
    RelationshipPlan,
)


def _document(
    entity_id: str,
    table_name: str,
    name: str,
) -> EntityDocument:
    return EntityDocument(
        entity_id=entity_id,
        table_name=table_name,
        display_name=name,
        class_name=f"com.example.{table_name.title()}",
        dimensions={
            "name": name,
            "private_note": f"secret-{entity_id}",
        },
        normalized_dimensions={
            "name": name.lower(),
            "private_note": f"secret-{entity_id}".lower(),
        },
        search_text=f"name:{name};private_note:secret-{entity_id}",
    )


def _candidate_group(
    source_id: str = "process:1",
) -> CandidateGroup:
    return CandidateGroup(
        plan=RelationshipPlan(
            source_table="process",
            target_table="part",
            relation_type="process_uses_part",
            direction="source_to_target",
            source_dimensions=["name"],
            target_dimensions=["name"],
            retrieval_modes=["keyword", "semantic"],
            candidate_limit_per_source=3,
            reason="The process name may identify a part.",
        ),
        source=_document(source_id, "process", f"Rotor assembly {source_id}"),
        candidates=[
            _document("part:1", "part", "Rotor"),
            _document("part:2", "part", "Bearing"),
            _document("part:3", "part", "Rotor housing"),
        ],
    )


def _candidate_group_with_database_values() -> CandidateGroup:
    source_values = {
        "amount": Decimal("12.30"),
        "produced_on": date(2026, 7, 29),
        "observed_at": datetime(
            2026,
            7,
            29,
            10,
            11,
            12,
            tzinfo=timezone(timedelta(hours=8)),
        ),
        "trace_id": UUID("12345678-1234-5678-1234-567812345678"),
        "payload": b"\x00\xff",
    }
    target_values = {
        "price": Decimal("12.30"),
        "available_on": date(2026, 7, 30),
        "observed_at": datetime(2026, 7, 30, 2, 3, 4),
        "trace_id": UUID("87654321-4321-8765-4321-876543218765"),
        "payload": b"part",
    }
    return CandidateGroup(
        plan=RelationshipPlan(
            source_table="process",
            target_table="part",
            relation_type="process_uses_part",
            direction="source_to_target",
            source_dimensions=list(source_values),
            target_dimensions=list(target_values),
            retrieval_modes=["semantic"],
            candidate_limit_per_source=1,
            reason="Selected typed values support the relation.",
        ),
        source=EntityDocument(
            entity_id="process:typed",
            table_name="process",
            display_name="Typed process",
            dimensions=source_values,
            normalized_dimensions={
                name: str(value)
                for name, value in source_values.items()
            },
            search_text="typed source",
        ),
        candidates=[
            EntityDocument(
                entity_id="part:typed",
                table_name="part",
                display_name="Typed part",
                dimensions=target_values,
                normalized_dimensions={
                    name: str(value)
                    for name, value in target_values.items()
                },
                search_text="typed target",
            )
        ],
    )


def _verdict(
    *,
    source: str = "process:1",
    target: str = "part:1",
    approved: object = True,
    relation_type: str = "process_uses_part",
    direction: str = "source_to_target",
    source_field: str = "name",
    target_field: str = "name",
    source_value: object = "Rotor assembly process:1",
    target_value: object = "Rotor",
) -> dict[str, object]:
    return {
        "approved": approved,
        "source": source,
        "target": target,
        "relation_type": relation_type,
        "direction": direction,
        "strength": "weak",
        "confidence": 0.91,
        "explanation": "The process explicitly names this part.",
        "evidence": [
            {
                "source_field": source_field,
                "source_value": source_value,
                "target_field": target_field,
                "target_value": target_value,
                "method": "llm_semantic_reasoning",
                "reason": "The selected names have the same business meaning.",
            }
        ],
    }


class _RecordingLlm:
    def __init__(
        self,
        responder: Callable[
            [list[dict[str, object]]],
            dict[str, object],
        ],
    ) -> None:
        self._responder = responder
        self.calls: list[list[dict[str, object]]] = []
        self.response_models: list[type[BaseModel] | None] = []

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]:
        self.calls.append(messages)
        self.response_models.append(response_model)
        payload = self._responder(messages)
        if response_model is None:
            return payload
        return response_model.model_validate(payload).model_dump()


def _source_id(messages: list[dict[str, object]]) -> str:
    user_payload = json.loads(str(messages[-1]["content"]))
    return str(user_payload["source"]["entity_id"])


@pytest.mark.asyncio
async def test_one_source_and_multiple_candidates_are_sent_together():
    llm = _RecordingLlm(
        lambda _messages: {
            "decisions": [
                _verdict(target="part:1"),
                _verdict(
                    target="part:2",
                    approved=False,
                    target_value="Bearing",
                ),
                _verdict(
                    target="part:3",
                    target_value="Rotor housing",
                ),
            ]
        }
    )

    result = await SemanticJudge(llm, concurrency=2).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() + 30,
    )

    assert len(llm.calls) == 1
    assert llm.response_models[0] is not None
    prompt = json.loads(str(llm.calls[0][-1]["content"]))
    assert prompt["source"]["entity_id"] == "process:1"
    assert [item["entity_id"] for item in prompt["candidates"]] == [
        "part:1",
        "part:2",
        "part:3",
    ]
    assert prompt["plan"]["relation_type"] == "process_uses_part"
    assert "private_note" not in json.dumps(prompt)
    assert [decision.target for decision in result.decisions] == [
        "part:1",
        "part:3",
    ]
    first = result.decisions[0]
    assert first.relation_type == "process_uses_part"
    assert first.direction == "source_to_target"
    assert first.strength == "weak"
    assert first.confidence == pytest.approx(0.91)
    assert first.explanation == "The process explicitly names this part."
    assert first.evidence[0].source_field == "name"
    assert first.evidence[0].target_field == "name"
    assert result.completed_groups == 1
    assert result.failed_groups == 0
    assert result.pending_groups == 0


@pytest.mark.asyncio
async def test_primary_business_context_is_separate_from_auxiliary_evidence():
    group = _candidate_group()
    group.plan.source_dimensions = ["private_note"]
    group.plan.target_dimensions = ["private_note"]
    llm = _RecordingLlm(lambda _messages: {"decisions": []})

    await SemanticJudge(llm).judge_groups(
        [group],
        deadline=time.monotonic() + 30,
    )

    prompt = json.loads(str(llm.calls[0][-1]["content"]))
    assert prompt["source"]["business_context"] == {
        "name": "Rotor assembly process:1",
        "class_name": "com.example.Process",
    }
    assert prompt["source"]["auxiliary_evidence"] == {
        "private_note": "secret-process:1"
    }
    assert "name" not in prompt["source"]["auxiliary_evidence"]
    assert "class_name" not in prompt["source"]["auxiliary_evidence"]


@pytest.mark.asyncio
@pytest.mark.parametrize("approved", ["yes", 1], ids=["string", "integer"])
async def test_only_strict_boolean_can_explicitly_approve(
    approved: object,
):
    llm = _RecordingLlm(
        lambda _messages: {
            "decisions": [_verdict(approved=approved)]
        }
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() + 30,
    )

    assert result.decisions == []
    assert result.completed_groups == 0
    assert result.failed_groups == 1


@pytest.mark.asyncio
async def test_identical_approved_verdicts_are_deduplicated():
    verdict = _verdict()
    llm = _RecordingLlm(
        lambda _messages: {
            "decisions": [verdict, _verdict()]
        }
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() + 30,
    )

    assert [decision.target for decision in result.decisions] == [
        "part:1"
    ]
    assert result.completed_groups == 1
    assert result.failed_groups == 0


@pytest.mark.asyncio
async def test_conflicting_duplicate_verdicts_fail_the_group():
    conflicting = _verdict()
    conflicting["confidence"] = 0.42
    llm = _RecordingLlm(
        lambda _messages: {
            "decisions": [_verdict(), conflicting]
        }
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() + 30,
    )

    assert result.decisions == []
    assert result.completed_groups == 0
    assert result.failed_groups == 1


@pytest.mark.asyncio
async def test_canonical_database_values_round_trip_as_evidence():
    canonical_decimal = {"$type": "decimal", "value": "12.30"}
    canonical_date = {"$type": "date", "value": "2026-07-30"}
    llm = _RecordingLlm(
        lambda _messages: {
            "decisions": [
                _verdict(
                    source="process:typed",
                    target="part:typed",
                    source_field="amount",
                    target_field="available_on",
                    source_value=canonical_decimal,
                    target_value=canonical_date,
                )
            ]
        }
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group_with_database_values()],
        deadline=time.monotonic() + 30,
    )

    prompt = json.loads(str(llm.calls[0][-1]["content"]))
    assert prompt["source"]["auxiliary_evidence"] == {
        "amount": canonical_decimal,
        "produced_on": {"$type": "date", "value": "2026-07-29"},
        "observed_at": {
            "$type": "datetime",
            "value": "2026-07-29T10:11:12+08:00",
        },
        "trace_id": {
            "$type": "uuid",
            "value": "12345678-1234-5678-1234-567812345678",
        },
        "payload": {
            "$type": "bytes",
            "encoding": "base64",
            "value": "AP8=",
        },
    }
    assert prompt["candidates"][0]["auxiliary_evidence"]["price"] == (
        canonical_decimal
    )
    assert prompt["candidates"][0]["auxiliary_evidence"]["available_on"] == (
        canonical_date
    )
    assert result.completed_groups == 1
    assert result.failed_groups == 0
    assert len(result.decisions) == 1
    assert result.decisions[0].evidence[0].source_value == (
        canonical_decimal
    )
    assert result.decisions[0].evidence[0].target_value == canonical_date


@pytest.mark.asyncio
async def test_prompt_schema_does_not_preapprove_a_real_candidate():
    llm = _RecordingLlm(
        lambda _messages: {"decisions": []},
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() + 30,
    )

    prompt_text = str(llm.calls[0][-1]["content"])
    prompt = json.loads(prompt_text)
    assert "response_example" not in prompt
    assert prompt["response_schema"]["decision_fields"]["approved"] == (
        "strict boolean true"
    )
    assert prompt_text.count('"part:1"') == 1
    assert result.completed_groups == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "source_value",
    [
        "12.30",
        {"$type": "decimal", "value": "99.99"},
    ],
    ids=["wrong-type", "forged-value"],
)
async def test_noncanonical_or_forged_evidence_value_fails_group(
    source_value: object,
):
    llm = _RecordingLlm(
        lambda _messages: {
            "decisions": [
                _verdict(
                    source="process:typed",
                    target="part:typed",
                    source_field="amount",
                    target_field="available_on",
                    source_value=source_value,
                    target_value={
                        "$type": "date",
                        "value": "2026-07-30",
                    },
                )
            ]
        }
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group_with_database_values()],
        deadline=time.monotonic() + 30,
    )

    assert result.decisions == []
    assert result.completed_groups == 0
    assert result.failed_groups == 1


@pytest.mark.asyncio
async def test_deadline_marks_unstarted_groups_pending():
    llm = _RecordingLlm(
        lambda _messages: {"decisions": []},
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() - 1,
    )

    assert result.pending_groups == 1
    assert result.completed_groups == 0
    assert result.failed_groups == 0
    assert result.decisions == []
    assert llm.calls == []


@pytest.mark.asyncio
async def test_upstream_deadline_keeps_completed_judgement_and_marks_remainder_pending():
    class CompletingLlm:
        def __init__(self) -> None:
            self.completed = asyncio.Event()
            self.active = 0

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.active += 1
            try:
                payload: dict[str, object] = {
                    "decisions": [_verdict()],
                }
                return response_model.model_validate(payload).model_dump()
            finally:
                self.active -= 1
                self.completed.set()

    llm = CompletingLlm()

    async def one_completed_group_then_deadline():
        yield _candidate_group()
        await llm.completed.wait()
        await asyncio.sleep(0.01)
        raise DeadlineExceeded("candidate retrieval stream")

    result = await asyncio.wait_for(
        SemanticJudge(llm, concurrency=1).judge_groups(
            one_completed_group_then_deadline(),
            deadline=time.monotonic() + 30,
        ),
        timeout=1,
    )

    assert llm.active == 0
    assert [decision.target for decision in result.decisions] == ["part:1"]
    assert result.completed_groups == 1
    assert result.failed_groups == 0
    assert result.pending_groups >= 1
    assert [outcome.status for outcome in result.outcomes] == [
        "completed",
        "pending",
    ]


@pytest.mark.asyncio
async def test_concurrency_is_bounded_while_all_groups_complete():
    class ConcurrencyLlm:
        def __init__(self) -> None:
            self.active = 0
            self.max_active = 0

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
            try:
                await asyncio.sleep(0.02)
                payload: dict[str, object] = {"decisions": []}
                if response_model is None:
                    return payload
                return response_model.model_validate(payload).model_dump()
            finally:
                self.active -= 1

    llm = ConcurrencyLlm()

    result = await SemanticJudge(llm, concurrency=2).judge_groups(
        [
            _candidate_group(f"process:{index}")
            for index in range(1, 6)
        ],
        deadline=time.monotonic() + 30,
    )

    assert llm.max_active == 2
    assert llm.active == 0
    assert result.completed_groups == 5
    assert result.failed_groups == 0
    assert result.pending_groups == 0


@pytest.mark.asyncio
async def test_adapter_error_fails_only_its_group_without_judge_retry():
    class SelectiveFailureLlm:
        def __init__(self) -> None:
            self.calls: list[str] = []

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            source_id = _source_id(messages)
            self.calls.append(source_id)
            if source_id == "process:1":
                raise RuntimeError("adapter exhausted its retry contract")
            payload: dict[str, object] = {"decisions": []}
            if response_model is None:
                return payload
            return response_model.model_validate(payload).model_dump()

    llm = SelectiveFailureLlm()

    result = await SemanticJudge(llm, concurrency=2).judge_groups(
        [
            _candidate_group("process:1"),
            _candidate_group("process:2"),
        ],
        deadline=time.monotonic() + 30,
    )

    assert sorted(llm.calls) == ["process:1", "process:2"]
    assert result.completed_groups == 1
    assert result.failed_groups == 1
    assert result.pending_groups == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_verdict",
    [
        _verdict(source="process:outside"),
        _verdict(target="part:outside"),
        _verdict(relation_type="unplanned_relation"),
        _verdict(direction="undirected"),
        _verdict(source_field="private_note"),
        _verdict(target_field="private_note"),
    ],
    ids=[
        "source",
        "target",
        "relation-type",
        "direction",
        "source-field",
        "target-field",
    ],
)
async def test_plan_outside_entities_and_fields_fail_the_group(
    invalid_verdict: dict[str, object],
):
    llm = _RecordingLlm(
        lambda _messages: {"decisions": [invalid_verdict]},
    )

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()],
        deadline=time.monotonic() + 30,
    )

    assert result.decisions == []
    assert result.completed_groups == 0
    assert result.failed_groups == 1
    assert result.pending_groups == 0
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_started_timeout_is_failed_and_waiting_group_is_pending():
    class BlockingLlm:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.cancelled = asyncio.Event()
            self.active = 0

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.active += 1
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
            finally:
                self.active -= 1

    llm = BlockingLlm()

    result = await SemanticJudge(llm, concurrency=1).judge_groups(
        [
            _candidate_group("process:1"),
            _candidate_group("process:2"),
        ],
        deadline=time.monotonic() + 0.05,
    )

    assert llm.started.is_set()
    assert llm.cancelled.is_set()
    assert llm.active == 0
    assert result.completed_groups == 0
    assert result.failed_groups == 1
    assert result.pending_groups == 1


@pytest.mark.asyncio
async def test_cancelling_batch_cleans_up_started_and_waiting_groups():
    class CancellableLlm:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.cancelled = asyncio.Event()
            self.active = 0

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.active += 1
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
            finally:
                self.active -= 1

    llm = CancellableLlm()
    batch = asyncio.create_task(
        SemanticJudge(llm, concurrency=1).judge_groups(
            [
                _candidate_group("process:1"),
                _candidate_group("process:2"),
            ],
            deadline=time.monotonic() + 30,
        )
    )
    await asyncio.wait_for(llm.started.wait(), timeout=1)

    batch.cancel()
    with pytest.raises(asyncio.CancelledError):
        await batch

    assert llm.cancelled.is_set()
    assert llm.active == 0


@pytest.mark.asyncio
async def test_judge_uses_fixed_workers_and_returns_group_identity():
    llm = _RecordingLlm(lambda _messages: {"decisions": []})
    result = await SemanticJudge(llm, concurrency=2).judge_groups(
        (_candidate_group(f"process:{index}") for index in range(50)),
        deadline=time.monotonic() + 30,
    )

    assert result.peak_live_tasks == 2
    assert [outcome.source_id for outcome in result.outcomes] == [
        f"process:{index}" for index in range(50)
    ]


@pytest.mark.asyncio
async def test_judge_observes_a_bounded_live_group_peak():
    class BlockingLlm:
        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            await asyncio.sleep(0.005)
            payload: dict[str, object] = {"decisions": []}
            return response_model.model_validate(payload).model_dump()

    result = await SemanticJudge(BlockingLlm(), concurrency=2).judge_groups(
        (_candidate_group(f"process:{index}") for index in range(100)),
        deadline=time.monotonic() + 30,
    )

    assert result.completed_groups == 100
    assert result.peak_live_tasks == 2
    assert result.peak_live_groups <= 5


@pytest.mark.asyncio
async def test_judge_peak_includes_a_group_held_by_the_blocked_producer():
    class BlockingLlm:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.release = asyncio.Event()

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.started.set()
            await self.release.wait()
            payload: dict[str, object] = {"decisions": []}
            return response_model.model_validate(payload).model_dump()

    llm = BlockingLlm()
    batch = asyncio.create_task(
        SemanticJudge(llm, concurrency=1).judge_groups(
            [_candidate_group(f"process:{index}") for index in range(3)],
            deadline=time.monotonic() + 30,
        )
    )
    await asyncio.wait_for(llm.started.wait(), timeout=1)
    await asyncio.sleep(0.01)
    llm.release.set()
    result = await batch

    assert result.completed_groups == 3
    assert result.peak_live_groups == 3


@pytest.mark.asyncio
async def test_deadline_does_not_drain_a_deadline_aware_generator():
    deadline = time.monotonic() + 0.03

    class DeadlineAwareGroups:
        def __init__(self) -> None:
            self.index = 0
            self.calls_after_deadline = 0

        def __iter__(self):
            return self

        def __next__(self) -> CandidateGroup:
            if time.monotonic() >= deadline:
                self.calls_after_deadline += 1
                raise AssertionError("deadline must not drain the generator")
            if self.index == 100:
                raise StopIteration
            self.index += 1
            return _candidate_group(f"process:{self.index}")

    class BlockingLlm:
        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            await asyncio.Event().wait()
            raise AssertionError("unreachable")

    groups = DeadlineAwareGroups()
    result = await SemanticJudge(BlockingLlm(), concurrency=1).judge_groups(
        groups,
        deadline=deadline,
    )

    assert groups.calls_after_deadline == 0
    assert result.failed_groups == 1
    assert result.pending_groups >= 1
    assert result.failed_groups + result.pending_groups == len(result.outcomes)


@pytest.mark.asyncio
async def test_producer_failure_cancels_and_awaits_started_llm_call():
    class CancellableLlm:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.cancelled = asyncio.Event()

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
            raise AssertionError("unreachable")

    def broken_groups():
        yield _candidate_group("process:1")
        raise RuntimeError("producer failure")

    llm = CancellableLlm()
    with pytest.raises(RuntimeError, match="producer failure"):
        await asyncio.wait_for(
            SemanticJudge(llm, concurrency=1).judge_groups(
                broken_groups(),
                deadline=time.monotonic() + 30,
            ),
            timeout=1,
        )

    assert llm.started.is_set()
    assert llm.cancelled.is_set()


@pytest.mark.asyncio
async def test_worker_failure_cancels_and_awaits_sibling(monkeypatch):
    class CancellableLlm:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.cancelled = asyncio.Event()

        async def complete_json(
            self,
            messages: list[dict[str, object]],
            max_tokens: int,
            response_model: type[BaseModel] | None = None,
        ) -> dict[str, object]:
            self.started.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                self.cancelled.set()
                raise
            raise AssertionError("unreachable")

    judge = SemanticJudge(CancellableLlm(), concurrency=2)
    original = judge._judge_group

    async def crashing_worker(group: CandidateGroup, deadline: float):
        if group.source.entity_id == "process:1":
            await asyncio.sleep(0)
            raise RuntimeError("worker failure")
        return await original(group, deadline)

    monkeypatch.setattr(judge, "_judge_group", crashing_worker)
    with pytest.raises(RuntimeError, match="worker failure"):
        await judge.judge_groups(
            [_candidate_group("process:1"), _candidate_group("process:2")],
            deadline=time.monotonic() + 30,
        )

    assert judge._llm.started.is_set()
    assert judge._llm.cancelled.is_set()
