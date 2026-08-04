# Semantic Judge Reliability Design

## Goal

Eliminate repeated semantic-judge failures caused by the LLM omitting or
rewriting evidence values, while modestly improving latency, token usage, and
decision accuracy. Preserve all public API, graph, export, and frontend data
shapes.

## Current Failure

The judge asks the LLM to return `source_value` and `target_value`, although
both values already exist in the trusted candidate group. The prompt does not
enumerate those fields clearly. When the model omits either value, Pydantic
rejects the entire response, the adapter performs a second full completion,
and the group is eventually discarded. Since retrieval creates one judgement
group per relationship plan and source entity, this failure and its retry cost
multiply across an analysis.

## Considered Approaches

### 1. Trusted server-side evidence hydration (selected)

The LLM returns the source field, target field, and reasoning. After validating
that the selected fields belong to the plan, the server copies the corresponding
values from the source and target `EntityDocument` objects into the final
`RelationEvidence`.

This removes redundant model work, prevents invented or reformatted values,
reduces output tokens, and keeps the public result unchanged.

### 2. Prompt-only schema clarification

Keep requiring the model to echo values but enumerate every evidence field and
add an example. This is a smaller contract change, but it cannot guarantee that
the model copies typed database values exactly. Missing or altered values would
continue to fail whole groups.

### 3. Repair missing values after validation failure

Accept the old response and fill only absent values. This mixes validation and
repair, leaves an ambiguous LLM contract, and makes it harder to distinguish a
harmless omission from a forged value. It is not selected.

## Internal Contract

The LLM evidence payload contains:

- `source_field`: a field from the plan's source dimensions;
- `target_field`: a field from the plan's target dimensions;
- `method`: exactly `llm_semantic_reasoning`;
- `reason`: a non-empty explanation of how the selected fields support the
  relationship.

It does not contain `source_value` or `target_value`. The judge validates entity
IDs, relationship metadata, direction, fields, confidence, and duplicate
decisions exactly as before. It then obtains evidence values from the trusted
candidate group and constructs the existing `RelationEvidence` model.

The final `RelationDecision` and `RelationEvidence` schemas do not change.
Consumers, exports, saved graph snapshots, and frontend rendering therefore do
not require migration.

## Prompt and Adapter Changes

The judgement prompt will describe the complete response structure, including
the nested evidence fields, and will include a schema-shaped example that uses
placeholder entity and field identifiers rather than preapproving a real
candidate.

The generic repair prompt will stop referring to a nonexistent example. It will
ask for a corrected object matching the supplied contract and include the
validation error.

The judge completion token budget will return to 4,096 tokens for a batch of at
most ten candidates instead of allowing 16,384 output tokens. A configurable
`LLM_REQUEST_TIMEOUT_SECONDS` setting, defaulting to 45 seconds, will bound each
provider attempt. The judge's existing absolute deadline remains wrapped around
the whole adapter call, so the effective wait is always limited by whichever
deadline expires first.

Retries remain limited to one repair attempt. Validation errors, transient
provider failures, and an individual 45-second attempt timeout may use that
attempt. Task cancellation and expiry of the judge's global deadline propagate
without retrying.

## Error Handling

- Unknown or unplanned evidence fields fail the group.
- Unknown entities, altered relationship metadata, conflicting duplicates, and
  invalid confidence or direction continue to fail the group.
- Evidence values are always copied from trusted documents and retain their
  canonical JSON representation.
- A per-attempt timeout fails only the started group. Other workers continue
  until the global deadline.
- Logs report one concise group failure rather than printing a full traceback
  for an expected model-contract error.

## Testing

Regression tests will prove the following behavior:

1. An LLM response without evidence values completes successfully and produces
   final evidence containing the exact trusted source and target values.
2. Typed values such as decimals, dates, UUIDs, bytes, arrays, and objects retain
   the existing canonical representation after server-side hydration.
3. Unknown or out-of-plan evidence fields still fail the group.
4. The prompt explicitly exposes the nested evidence contract without embedding
   a real approved candidate as an example.
5. The repair prompt no longer references a missing example.
6. A slow LLM attempt respects its per-attempt timeout and leaves no active
   request behind.
7. The judge uses the reduced output-token budget.
8. Existing semantic judge, planner, analyzer, graph, API, and export tests remain
   green.

A deterministic benchmark with delayed fake completions will compare valid and
invalid batches and confirm that the original missing-value response no longer
causes a second LLM request.

## Non-Goals

This change does not alter candidate retrieval ranking, relationship planning,
embedding models, LLM concurrency, public API schemas, frontend behavior, or
database access. Broader batching and provider-specific strict JSON Schema
support can be evaluated separately after this contract is stable.
