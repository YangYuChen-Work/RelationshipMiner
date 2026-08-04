# Semantic Judge Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make semantic judgement tolerate omitted evidence values by deriving them from trusted documents, while reducing avoidable LLM latency and preserving public results.

**Architecture:** The internal LLM evidence DTO becomes field-selection-only. SemanticJudge verifies each field against the plan and hydrates canonical values from the source and selected candidate before constructing the unchanged public RelationEvidence. The adapter retains one repair attempt but bounds each provider call with a configurable 45-second timeout; the judge uses a 4,096-token batch budget.

**Tech Stack:** Python 3.12+, Pydantic v2, asyncio, OpenAI-compatible AsyncOpenAI, pytest, pytest-asyncio.

## Global Constraints

- Preserve public RelationEvidence, RelationDecision, API, graph snapshot, and frontend schemas exactly.
- Retain strict validation of IDs, planned metadata, confidence, direction, duplicate decisions, and evidence field membership.
- Canonical evidence values continue to use _canonical_json_value.
- Completion remains limited to two total provider attempts.
- Default LLM_REQUEST_TIMEOUT_SECONDS is 45.0; cancellation and global deadlines propagate.
- Judge batches use max_tokens=4096.

---

## File Structure

- backend/engine/semantic/judge.py — internal DTO, prompt, validation, trusted evidence hydration, budget, concise failure logging.
- backend/engine/deepseek_client.py — per-attempt provider timeout and repair instruction.
- backend/config.py — LLM_REQUEST_TIMEOUT_SECONDS default.
- backend/tests/semantic/test_judge.py — Judge regression coverage.
- backend/tests/semantic/test_planner.py — adapter retry and timeout coverage.

### Task 1: Hydrate evidence values in SemanticJudge

**Files:**

- Modify: backend/engine/semantic/judge.py lines 29-64 and 492-575.
- Modify: backend/tests/semantic/test_judge.py helpers and evidence validation tests.

**Interfaces:**

- Consumes: _EvidencePayload(source_field, target_field, method, reason) and CandidateGroup.
- Produces: unchanged RelationEvidence containing canonical values from trusted source and target documents.

- [ ] **Step 1: Write a failing missing-values regression**

Add this test after the first successful judge test:

~~~python
@pytest.mark.asyncio
async def test_omitted_evidence_values_are_hydrated_from_trusted_documents():
    verdict = _verdict()
    evidence = verdict["evidence"][0]
    evidence.pop("source_value")
    evidence.pop("target_value")
    llm = _RecordingLlm(lambda _messages: {"decisions": [verdict]})

    result = await SemanticJudge(llm).judge_groups(
        [_candidate_group()], deadline=time.monotonic() + 30
    )

    assert result.completed_groups == 1
    assert result.failed_groups == 0
    assert result.decisions[0].evidence[0].source_value == "Rotor assembly process:1"
    assert result.decisions[0].evidence[0].target_value == "Rotor"
~~~

- [ ] **Step 2: Verify the test is red**

Run: python -m pytest backend/tests/semantic/test_judge.py::test_omitted_evidence_values_are_hydrated_from_trusted_documents -q

Expected: fail because _EvidencePayload currently requires the two values.

- [ ] **Step 3: Remove only redundant values from the internal DTO**

Delete source_value: object and target_value: object from _EvidencePayload. Keep ConfigDict(extra="forbid"), the field names, the method literal, and reason unchanged. Do not change public RelationEvidence in models.py.

- [ ] **Step 4: Construct trusted evidence after field authorization**

In _validated_decisions, keep the entity and relationship checks. Replace evidence-value comparison with the following field check and hydration:

~~~python
if (
    evidence.source_field not in group.plan.source_dimensions
    or evidence.target_field not in group.plan.target_dimensions
):
    raise ValueError("judgement evidence is outside its plan")

RelationEvidence(
    source_field=evidence.source_field,
    source_value=_canonical_json_value(
        group.source.dimensions[evidence.source_field]
    ),
    target_field=evidence.target_field,
    target_value=_canonical_json_value(
        target.dimensions[evidence.target_field]
    ),
    method=evidence.method,
    reason=evidence.reason,
)
~~~

Build a hydrated list per approved decision and pass it to RelationDecision.

- [ ] **Step 5: Verify the regression is green**

Run: python -m pytest backend/tests/semantic/test_judge.py::test_omitted_evidence_values_are_hydrated_from_trusted_documents -q

Expected: pass with one completed group and trusted source/target values.

- [ ] **Step 6: Convert typed-value coverage to hydration coverage**

In test_canonical_database_values_round_trip_as_evidence, omit values from _verdict() but retain source_field="amount", target_field="available_on", and the existing canonical value assertions.

- [ ] **Step 7: Verify focused judge tests**

Run: python -m pytest backend/tests/semantic/test_judge.py -q

Expected: pass. Replace the old forged-value test with an out-of-plan field test, because model-provided values no longer exist in the internal contract.

- [ ] **Step 8: Commit Task 1**

Run git add backend/engine/semantic/judge.py backend/tests/semantic/test_judge.py, then git commit -m "fix: hydrate semantic evidence from trusted documents".

### Task 2: Make the prompt explicit and bound Judge output

**Files:**

- Modify: backend/engine/semantic/judge.py lines 299-385.
- Modify: backend/tests/semantic/test_judge.py RecordingLlm and prompt-contract test.

**Interfaces:**

- Consumes: Task 1 field-only evidence contract.
- Produces: prompt messages requiring field names, method, and reason, never values.

- [ ] **Step 1: Write a failing prompt and token-budget test**

Extend _RecordingLlm with self.max_tokens: list[int] and append its max_tokens argument. In the prompt test assert:

~~~python
assert prompt["response_schema"]["evidence_fields"] == {
    "source_field": "one supplied source auxiliary-evidence field name",
    "target_field": "one supplied target auxiliary-evidence field name",
    "method": "llm_semantic_reasoning",
    "reason": "non-empty explanation of how those fields support the relation",
}
assert "source_value" not in prompt_text
assert "target_value" not in prompt_text
assert llm.max_tokens == [4096]
~~~

- [ ] **Step 2: Verify the test is red**

Run: python -m pytest backend/tests/semantic/test_judge.py::test_prompt_schema_does_not_preapprove_a_real_candidate -q

Expected: fail because evidence is vague and the budget is 16,384.

- [ ] **Step 3: Make the request contract unambiguous**

Add evidence_fields with the mapping asserted above. Add a response_shape_example using only opaque placeholders such as "<supplied-source-id>" and "<selected-source-field>"; it must not contain real IDs, names, or values from group. Add this exact system instruction: “Evidence contains field names, method, and reason only. Do not return source_value or target_value; the server derives them from supplied records.”

- [ ] **Step 4: Restore the bounded output budget**

Change the complete_json call in _judge_group to max_tokens=4096.

- [ ] **Step 5: Verify Task 2**

Run: python -m pytest backend/tests/semantic/test_judge.py -q

Expected: pass.

- [ ] **Step 6: Commit Task 2**

Run git add backend/engine/semantic/judge.py backend/tests/semantic/test_judge.py, then git commit -m "fix: clarify semantic judgement evidence contract".

### Task 3: Bound DeepSeek provider attempts and repair wording

**Files:**

- Modify: backend/config.py lines 19-34.
- Modify: backend/engine/deepseek_client.py lines 6-134.
- Modify: backend/tests/semantic/test_planner.py lines 35-183.

**Interfaces:**

- Consumes: settings.LLM_REQUEST_TIMEOUT_SECONDS: float, default 45.0.
- Produces: DeepSeekJsonAdapter.complete_json() that bounds each chat.completions.create() call before applying the existing validation/retry loop.

- [ ] **Step 1: Write a failing repair-wording test**

Add to test_json_adapter_repairs_pydantic_invalid_output_once:

~~~python
assert "requested example" not in repair_prompt.lower()
assert "requested contract" in repair_prompt.lower()
~~~

- [ ] **Step 2: Verify wording test is red**

Run: python -m pytest backend/tests/semantic/test_planner.py::test_json_adapter_repairs_pydantic_invalid_output_once -q

Expected: fail because the prompt says “requested example and schema”.

- [ ] **Step 3: Write a failing provider-timeout test**

Create a fake async create that waits forever and records CancelledError. Construct the adapter with a test-only request_timeout_seconds=0.01. Assert:

~~~python
with pytest.raises(LlmBatchError, match="timed out"):
    await adapter.complete_json(_messages(), max_tokens=4096)
assert create.await_count == 2
assert cancelled.is_set()
~~~

- [ ] **Step 4: Verify timeout test is red**

Run: python -m pytest backend/tests/semantic/test_planner.py::test_json_adapter_retries_a_timed_out_provider_attempt -q

Expected: fail because provider calls are unbounded and the constructor has no override.

- [ ] **Step 5: Implement configurable per-attempt timeout**

Import asyncio. Add this setting:

~~~python
LLM_REQUEST_TIMEOUT_SECONDS: float = float(
    os.getenv("LLM_REQUEST_TIMEOUT_SECONDS", "45")
)
~~~

Add request_timeout_seconds: float | None = None to the adapter constructor, resolve it from settings, and reject values less than or equal to zero. Wrap only the provider call:

~~~python
async with asyncio.timeout(self.request_timeout_seconds):
    response = await self._client.chat.completions.create(...)
~~~

Let TimeoutError("LLM provider attempt timed out") enter the existing retry loop. Do not catch asyncio.CancelledError.

- [ ] **Step 6: Correct the repair request**

Change “matching the requested example and schema” to “matching the requested contract” while retaining the detailed validation error.

- [ ] **Step 7: Verify Task 3**

Run: python -m pytest backend/tests/semantic/test_planner.py -q

Expected: pass, including two timed-out attempts and cancellation cleanup.

- [ ] **Step 8: Commit Task 3**

Run git add backend/config.py backend/engine/deepseek_client.py backend/tests/semantic/test_planner.py, then git commit -m "fix: bound DeepSeek JSON completion attempts".

### Task 4: Verify the original symptom and integration safety

**Files:**

- Modify: backend/tests/semantic/test_judge.py.
- Test: backend/tests/semantic/test_planner.py, backend/tests/semantic/test_analyzer.py, backend/tests/semantic/test_end_to_end.py, backend/tests/test_analyze.py.

**Interfaces:**

- Consumes: completed Tasks 1-3.
- Produces: proof that an adapter-backed response omitting values completes on one provider call and existing integrations remain compatible.

- [ ] **Step 1: Write the adapter-backed original-symptom test**

Construct DeepSeekJsonAdapter around a fake response client whose valid JSON response omits both evidence values. Pass it to SemanticJudge and assert:

~~~python
assert create.await_count == 1
assert result.completed_groups == 1
assert result.failed_groups == 0
assert len(result.decisions) == 1
~~~

This is the same boundary that produced the observed LlmBatchError.

- [ ] **Step 2: Run original-symptom regression**

Run: python -m pytest backend/tests/semantic/test_judge.py::test_missing_evidence_values_complete_without_adapter_retry -q

Expected: pass after Tasks 1-3.

- [ ] **Step 3: Run focused semantic and API suites**

Run: python -m pytest backend/tests/semantic/test_judge.py backend/tests/semantic/test_planner.py backend/tests/semantic/test_analyzer.py backend/tests/semantic/test_end_to_end.py backend/tests/test_analyze.py -q

Expected: pass with no failed tests.

- [ ] **Step 4: Run full backend verification**

Run: python -m pytest backend/tests -q

Expected: pass with no failed tests.

- [ ] **Step 5: Check final diff and commit regression coverage**

Run git diff --check HEAD~3..HEAD and git status --short.

Expected: no whitespace errors and only intentional tracked changes. If Task 4 was not committed earlier, run git add backend/tests/semantic/test_judge.py followed by git commit -m "test: cover omitted semantic evidence values".

## Plan Self-Review

Spec coverage:

- Trusted field-only evidence and unchanged public output: Task 1.
- Explicit prompt contract and 4,096-token ceiling: Task 2.
- Configurable 45-second timeout, repair wording, and two-attempt behavior: Task 3.
- Original symptom, typed values, field authorization, semantic/API suites, and full backend verification: Tasks 1 and 4.

No placeholders remain. _EvidencePayload is field-only, while public RelationEvidence remains value-complete. LLM_REQUEST_TIMEOUT_SECONDS resolves to DeepSeekJsonAdapter.request_timeout_seconds.
