from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable

import pytest
from pydantic import BaseModel

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


def _verdict(
    *,
    source: str = "process:1",
    target: str = "part:1",
    approved: bool = True,
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
