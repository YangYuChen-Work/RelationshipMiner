# Semantic Relationship Analysis Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current field-pair equality pipeline with a scoped, explainable relationship analyzer that retrieves candidates from the selected database values, asks DeepSeek to judge non-deterministic candidates, and returns table/entity relationships with complete/partial/failed status.

**Architecture:** Add a deep `RelationshipAnalyzer` module under `backend/engine/semantic/`. Its small interface accepts `AnalysisScope` plus adapters for database records, embeddings, and LLM JSON output. Internally it builds entity documents, plans permitted table relationships, retrieves Top-K candidates with keyword and USearch indexes, executes physical FK relationships, judges remaining candidates in batches, and assembles traceable graph results.

**Tech Stack:** Python 3.12, FastAPI 0.115, Pydantic 2.11, SQLAlchemy 2.0, OpenAI Python SDK, sentence-transformers 5.x, `BAAI/bge-small-zh-v1.5`, NumPy 2.x, USearch 2.26, pytest 8.

## Global Constraints

- Analyze at most 10 selected tables and approximately 7000 total entities.
- Default task budget is exactly 180 seconds.
- Only user-selected dimensions may enter retrieval text, LLM prompts, or relationship evidence.
- Primary keys are system identity fields; physical FK fields are system relationship fields; `class_name` is optional display metadata.
- Physical FK and verified unique-identifier links are strong relationships.
- Every non-deterministic relationship must be approved by the LLM; vector distance never creates an edge.
- Do not enumerate the entity Cartesian product.
- LLM output failure must produce `partial` or `failed`, never a successful empty decision list.
- No autonomous multi-agent orchestration and no local composite relationship scorer.

---

### Task 1: Semantic domain models and public interface

**Files:**
- Create: `backend/engine/semantic/__init__.py`
- Create: `backend/engine/semantic/models.py`
- Create: `backend/engine/semantic/interfaces.py`
- Test: `backend/tests/semantic/test_models.py`

**Interfaces:**
- Consumes: no earlier task.
- Produces: `AnalysisScope`, `TableScope`, `EntityDocument`, `RelationshipPlan`, `CandidateGroup`, `RelationDecision`, `EntityEdge`, `TableEdge`, `AnalysisDiagnostics`, `AnalysisResult`, `AnalysisStatus`, `EmbeddingAdapter`, and `JsonLlmAdapter`.

- [ ] **Step 1: Write failing model-contract tests**

```python
def test_scope_keeps_dimensions_separate_from_system_fields():
    scope = AnalysisScope(
        tables=[TableScope(name="process", dimensions=["name"])],
        time_budget_seconds=180,
    )
    assert scope.tables[0].dimensions == ["name"]
    assert not hasattr(scope.tables[0], "primary_keys")


def test_result_serializes_partial_status_and_diagnostics():
    result = AnalysisResult(
        status=AnalysisStatus.PARTIAL,
        table_nodes=[],
        entity_nodes=[],
        table_edges=[],
        entity_edges=[],
        diagnostics=AnalysisDiagnostics(candidates_pending=12),
        warnings=["12 个候选未完成推理"],
    )
    assert result.model_dump()["status"] == "partial"
```

- [ ] **Step 2: Run tests and verify import failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_models.py -q`

Expected: FAIL because `engine.semantic.models` does not exist.

- [ ] **Step 3: Implement the exact public types**

Use Pydantic models and string enums. Required fields:

```python
class AnalysisStatus(str, Enum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    FAILED = "failed"

class TableScope(BaseModel):
    name: str
    dimensions: list[str]

class AnalysisScope(BaseModel):
    tables: list[TableScope] = Field(min_length=1, max_length=10)
    time_budget_seconds: float = Field(default=180.0, gt=0, le=180.0)

class AnalysisDiagnostics(BaseModel):
    entities_read: int = 0
    plans_created: int = 0
    candidates_retrieved: int = 0
    candidates_completed: int = 0
    candidates_pending: int = 0
    strong_edges_created: int = 0
    weak_edges_created: int = 0
```

Define `EmbeddingAdapter.encode_documents(texts)`, `EmbeddingAdapter.encode_queries(texts)`, and async `JsonLlmAdapter.complete_json(messages, max_tokens)` as `Protocol` methods. Add these exact model fields:

```python
class EntityDocument(BaseModel):
    entity_id: str
    table_name: str
    display_name: str
    class_name: str | None = None
    dimensions: dict[str, object]
    normalized_dimensions: dict[str, str]
    search_text: str

class RelationshipPlan(BaseModel):
    source_table: str
    target_table: str
    relation_type: str
    direction: Literal["source_to_target", "target_to_source", "undirected"]
    source_dimensions: list[str]
    target_dimensions: list[str]
    retrieval_modes: list[Literal["keyword", "semantic"]]
    candidate_limit_per_source: int = Field(default=20, ge=1, le=50)
    reason: str

class CandidateGroup(BaseModel):
    plan: RelationshipPlan
    source: EntityDocument
    candidates: list[EntityDocument]

class EntitySignatureGroup(BaseModel):
    representative: EntityDocument
    entity_ids: list[str]

class RelationEvidence(BaseModel):
    source_field: str
    source_value: object
    target_field: str
    target_value: object
    method: Literal["foreign_key", "unique_identifier", "llm_semantic_reasoning"]
    reason: str

class RelationDecision(BaseModel):
    source: str
    target: str
    relation_type: str
    direction: Literal["source_to_target", "target_to_source", "undirected"]
    strength: Literal["strong", "weak"]
    confidence: float = Field(ge=0, le=1)
    explanation: str
    evidence: list[RelationEvidence] = Field(min_length=1)

class EntityRelation(RelationDecision):
    model_id: str | None = None
    task_id: str | None = None

class EntityEdge(BaseModel):
    id: str
    source: str
    target: str
    relations: list[EntityRelation] = Field(min_length=1)

class EntityNode(BaseModel):
    id: str
    table_id: str
    display_name: str
    class_name: str | None = None
    dimensions: dict[str, object]

class TableNode(BaseModel):
    id: str
    display_name: str
    entity_count: int

class TableEdge(BaseModel):
    id: str
    source_table: str
    target_table: str
    relation_types: list[str]
    strong_count: int
    weak_count: int
    entity_edge_count: int
    average_confidence: float
    supporting_entity_edges: list[str]

class JudgementBatchResult(BaseModel):
    decisions: list[RelationDecision]
    completed_groups: int = 0
    failed_groups: int = 0
    pending_groups: int = 0

class AnalysisResult(BaseModel):
    status: AnalysisStatus
    table_nodes: list[TableNode]
    entity_nodes: list[EntityNode]
    table_edges: list[TableEdge]
    entity_edges: list[EntityEdge]
    diagnostics: AnalysisDiagnostics
    warnings: list[str]
```

- [ ] **Step 4: Run model tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_models.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/engine/semantic backend/tests/semantic/test_models.py
git commit -m "feat: define semantic analysis contracts"
```

---

### Task 2: Scope-aware record loading and entity corpus

**Files:**
- Create: `backend/engine/semantic/corpus.py`
- Modify: `backend/engine/pipeline.py`
- Test: `backend/tests/semantic/test_corpus.py`

**Interfaces:**
- Consumes: `AnalysisScope`, `EntityDocument`.
- Produces: `load_scoped_records(engine, scope, schema_result)` and `build_entity_documents(records, scope, pk_metadata, class_name_fields)`.

- [ ] **Step 1: Write failing corpus tests**

```python
def test_document_contains_only_selected_dimensions():
    scope = AnalysisScope(tables=[TableScope(name="users", dimensions=["name"])])
    docs = build_entity_documents(
        records={"users": [{"id": 1, "name": "张三", "secret": "x", "class_name": "User"}]},
        scope=scope,
        pk_metadata={"users": ["id"]},
        class_name_fields={"users": "class_name"},
    )
    assert docs[0].dimensions == {"name": "张三"}
    assert "secret" not in docs[0].search_text
    assert docs[0].class_name == "User"


def test_normalization_preserves_original_evidence_value():
    docs = build_entity_documents(
        {"parts": [{"id": 1, "model": "  AB-c 01 "}]},
        AnalysisScope(tables=[TableScope(name="parts", dimensions=["model"])]),
        {"parts": ["id"]},
        {"parts": None},
    )
    assert docs[0].dimensions["model"] == "  AB-c 01 "
    assert docs[0].normalized_dimensions["model"] == "ab-c01"


def test_identical_normalized_signatures_share_one_inference_group():
    groups = group_documents_by_signature([
        EntityDocument(
            entity_id="operation:1",
            table_name="operation",
            display_name=" 张三 ",
            dimensions={"operator": " 张三 "},
            normalized_dimensions={"operator": "张三"},
            search_text="表：操作；操作人：张三",
        ),
        EntityDocument(
            entity_id="operation:2",
            table_name="operation",
            display_name="张三",
            dimensions={"operator": "张三"},
            normalized_dimensions={"operator": "张三"},
            search_text="表：操作；操作人：张三",
        ),
    ])
    assert len(groups) == 1
    assert groups[0].entity_ids == ["operation:1", "operation:2"]
```

- [ ] **Step 2: Run tests and verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_corpus.py -q`

Expected: FAIL because corpus functions are missing.

- [ ] **Step 3: Implement scoped loading and deterministic normalization**

`load_scoped_records` must select the union of:

```python
requested = set(table_scope.dimensions)
requested.update(schema.primary_keys)
for fk in schema.foreign_keys:
    requested.update(fk.source_columns)
if class_name_field:
    requested.add(class_name_field)
```

Flatten FK columns before constructing the SQLAlchemy select. `build_entity_documents` must expose only `dimensions` in `search_text`, while storing PK/class metadata separately. Normalize strings with Unicode NFKC, lowercase Latin text, trim surrounding whitespace, and collapse internal whitespace. Do not normalize the stored original values. Implement `group_documents_by_signature` using `(table_name, sorted(normalized_dimensions.items()))`; later stages infer once per group and expand accepted decisions back to every member entity ID.

- [ ] **Step 4: Run corpus and existing pipeline tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_corpus.py backend\tests\test_analyze.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/engine/semantic/corpus.py backend/engine/pipeline.py backend/tests/semantic/test_corpus.py
git commit -m "feat: build scoped entity corpus"
```

---

### Task 3: Correct deterministic relationships

**Files:**
- Create: `backend/engine/semantic/deterministic.py`
- Modify: `backend/engine/relationship_computer.py`
- Test: `backend/tests/semantic/test_deterministic.py`
- Test: `backend/tests/test_relationship_computer.py`

**Interfaces:**
- Consumes: scoped records, PK metadata, schema indexes, `FKConstraint`, and optional `RelationshipPlan` objects.
- Produces: `build_fk_edges(records, pk_metadata, fk_constraints) -> list[EntityEdge]` and `build_unique_identifier_edges(records, schema_result, plans) -> list[EntityEdge]`.

- [ ] **Step 1: Add the non-primary target-column regression test**

```python
def test_fk_uses_declared_target_columns_not_target_primary_key():
    edges = build_fk_edges(
        records={
            "users": [{"id": 1, "code": "U-42"}],
            "orders": [{"id": 10, "user_code": "U-42"}],
        },
        pk_metadata={"users": ["id"], "orders": ["id"]},
        fk_constraints=[
            FKConstraint("orders", ["user_code"], "users", ["code"])
        ],
    )
    assert [(e.source, e.target) for e in edges] == [
        ("orders:10", "users:1")
    ]


def test_planned_unique_identifiers_create_strong_edges():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [{"id": 1, "creator_no": "E-7"}],
            "operations": [{"id": 2, "operator_no": "E-7"}],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                    indexes=[IndexMeta("uq_creator", ["creator_no"], True)],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                    indexes=[IndexMeta("uq_operator", ["operator_no"], True)],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={"requirements": ["id"], "operations": ["id"]},
        ),
        plans=[RelationshipPlan(
            source_table="requirements",
            target_table="operations",
            relation_type="人员行为",
            direction="source_to_target",
            source_dimensions=["creator_no"],
            target_dimensions=["operator_no"],
            retrieval_modes=["keyword"],
            candidate_limit_per_source=20,
            reason="唯一员工编号表示同一人员",
        )],
    )
    assert edges[0].relations[0].strength == "strong"
    assert edges[0].relations[0].evidence[0].method == "unique_identifier"
```

- [ ] **Step 2: Run the regression test**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_deterministic.py -q`

Expected: FAIL because `build_fk_edges` is missing.

- [ ] **Step 3: Implement target-column indexing and evidence**

Index target rows with `tuple(row[column] for column in fk.target_columns)`, never with target PK values. Generate entity IDs from PK metadata. Return a strong relation with type `外键关联`, confidence `1.0`, and evidence naming both declared columns.

For planned unique identifiers, require exactly one source and target dimension, verify each is a PK or single-column unique index in `SchemaAnalysisResult`, ignore nulls, and match normalized exact values. Return strong edges with `unique_identifier` evidence. All other exact values remain LLM candidates.

- [ ] **Step 4: Run deterministic and legacy relationship tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_deterministic.py backend\tests\test_relationship_computer.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/engine/semantic/deterministic.py backend/engine/relationship_computer.py backend/tests/semantic/test_deterministic.py backend/tests/test_relationship_computer.py
git commit -m "fix: honor declared foreign key targets"
```

---

### Task 4: Embedding and Top-K candidate retrieval

**Files:**
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Modify: `backend/config.py`
- Create: `backend/engine/semantic/embeddings.py`
- Create: `backend/engine/semantic/retrieval.py`
- Test: `backend/tests/semantic/test_retrieval.py`

**Interfaces:**
- Consumes: `EntityDocument`, `RelationshipPlan`, `EmbeddingAdapter`.
- Produces: `SentenceTransformerEmbeddingAdapter` and `retrieve_candidate_groups(documents, plans, embedding_adapter) -> list[CandidateGroup]`.

- [ ] **Step 1: Write retrieval tests with a fake embedding adapter**

```python
def test_retrieval_searches_only_planned_target_table(fake_embeddings):
    groups = retrieve_candidate_groups(
        documents=[
            EntityDocument(
                entity_id="process:1",
                table_name="process",
                display_name="转子装配工艺",
                dimensions={"name": "转子装配工艺"},
                normalized_dimensions={"name": "转子装配工艺"},
                search_text="表：工艺；名称：转子装配工艺",
            ),
            EntityDocument(
                entity_id="part:1",
                table_name="part",
                display_name="转子",
                dimensions={"name": "转子"},
                normalized_dimensions={"name": "转子"},
                search_text="表：零件；名称：转子",
            ),
        ],
        plans=[RelationshipPlan(
            source_table="process",
            target_table="part",
            relation_type="工艺涉及零件",
            direction="source_to_target",
            source_dimensions=["name"],
            target_dimensions=["name"],
            retrieval_modes=["keyword", "semantic"],
            candidate_limit_per_source=2,
            reason="名称语义",
        )],
        embedding_adapter=fake_embeddings,
    )
    assert {candidate.table_name for g in groups for candidate in g.candidates} == {"part"}
    assert all(len(g.candidates) <= 2 for g in groups)
```

Also assert duplicate keyword/vector hits are returned once and no candidate from the source table leaks into a group.

- [ ] **Step 2: Run retrieval tests and verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_retrieval.py -q`

Expected: FAIL because retrieval modules are missing.

- [ ] **Step 3: Add pinned runtime dependencies**

Add:

```toml
"numpy>=2.0,<3.0",
"sentence-transformers>=5.6,<6.0",
"usearch==2.26.0",
```

Run: `uv lock && uv sync`.

- [ ] **Step 4: Implement lazy BGE embeddings and per-table USearch indexes**

Default `EMBEDDING_MODEL` to `BAAI/bge-small-zh-v1.5`. Load `SentenceTransformer` lazily and encode normalized `float32` vectors. Build one USearch cosine index per target table with integer keys mapped back to entity IDs. Query only table pairs in a `RelationshipPlan`, request exactly `candidate_limit_per_source`, then union keyword and vector results without treating distance as a relationship verdict.

- [ ] **Step 5: Run retrieval tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_retrieval.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add pyproject.toml uv.lock backend/config.py backend/engine/semantic/embeddings.py backend/engine/semantic/retrieval.py backend/tests/semantic/test_retrieval.py
git commit -m "feat: retrieve semantic relationship candidates"
```

---

### Task 5: Reliable DeepSeek JSON adapter and relationship planner

**Files:**
- Modify: `backend/config.py`
- Modify: `backend/engine/deepseek_client.py`
- Create: `backend/engine/semantic/planner.py`
- Test: `backend/tests/semantic/test_planner.py`
- Modify: `backend/tests/test_ai_decision_maker.py`

**Interfaces:**
- Consumes: `AnalysisScope`, selected schema columns, one sample per table.
- Produces: async `DeepSeekJsonAdapter.complete_json(...)` and `RelationshipPlanner.plan(...) -> list[RelationshipPlan]`.

- [ ] **Step 1: Write JSON-output and planner tests**

Test that the client passes:

```python
response_format={"type": "json_object"}
max_tokens=4096
```

and rejects empty content or `finish_reason == "length"`. Test that planner output referencing an unselected field is discarded.

- [ ] **Step 2: Run tests and verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_planner.py -q`

Expected: FAIL because the JSON adapter/planner does not exist.

- [ ] **Step 3: Implement JSON mode, model migration, validation, and one retry**

Default `DEEPSEEK_MODEL` to `deepseek-v4-flash`. Send a JSON example in the prompt, set JSON Output, and inspect `finish_reason`. Retry once for empty, truncated, invalid, or Pydantic-invalid output using a repair prompt containing the validation errors. Raise `LlmBatchError` after the second failure; never return `[]` on failure.

- [ ] **Step 4: Implement selected-field-only planning**

The planner prompt must contain only table names, selected dimensions, types, and selected sample values. Parse a root object shaped as:

```json
{"plans": [{"source_table": "...", "target_table": "...", "relation_type": "..."}]}
```

Validate both tables and every source/target dimension against `AnalysisScope`.

- [ ] **Step 5: Run planner and existing AI tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_planner.py backend\tests\test_ai_decision_maker.py -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/config.py backend/engine/deepseek_client.py backend/engine/semantic/planner.py backend/tests/semantic/test_planner.py backend/tests/test_ai_decision_maker.py
git commit -m "feat: plan relationships with validated DeepSeek JSON"
```

---

### Task 6: Batched LLM entity judgment

**Files:**
- Modify: `backend/config.py`
- Create: `backend/engine/semantic/judge.py`
- Test: `backend/tests/semantic/test_judge.py`

**Interfaces:**
- Consumes: `CandidateGroup`, `JsonLlmAdapter`, task deadline.
- Produces: `SemanticJudge.judge_groups(groups, deadline) -> JudgementBatchResult`.

- [ ] **Step 1: Write batched judgment tests**

```python
@pytest.mark.asyncio
async def test_one_source_and_multiple_candidates_are_sent_together(fake_llm):
    result = await SemanticJudge(fake_llm, concurrency=2).judge_groups(
        [candidate_group_with_three_parts()],
        deadline=time.monotonic() + 30,
    )
    assert fake_llm.call_count == 1
    assert [d.target for d in result.decisions] == ["part:1", "part:3"]


@pytest.mark.asyncio
async def test_deadline_marks_unstarted_groups_pending(fake_llm):
    result = await SemanticJudge(fake_llm).judge_groups(
        [candidate_group_with_three_parts()],
        deadline=time.monotonic() - 1,
    )
    assert result.pending_groups == 1
    assert result.decisions == []
```

- [ ] **Step 2: Run tests and verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_judge.py -q`

Expected: FAIL because `SemanticJudge` is missing.

- [ ] **Step 3: Implement bounded async batching**

Use `asyncio.Semaphore(settings.LLM_CONCURRENCY)` with default `4`. Each prompt contains one source entity, its relationship plan, and all candidates in that group. Validate returned source/target IDs against the group. Accept multiple target matches. Preserve type, direction, confidence, explanation, and field evidence. Failed groups increment `failed_groups`; groups not started before the deadline increment `pending_groups`.

- [ ] **Step 4: Run judgment tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_judge.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/config.py backend/engine/semantic/judge.py backend/tests/semantic/test_judge.py
git commit -m "feat: judge entity candidates in LLM batches"
```

---

### Task 7: Graph assembly and table aggregation

**Files:**
- Create: `backend/engine/semantic/graph_builder.py`
- Test: `backend/tests/semantic/test_graph_builder.py`

**Interfaces:**
- Consumes: entity documents, deterministic edges, relation decisions.
- Produces: `build_graph(...) -> tuple[list[TableNode], list[EntityNode], list[TableEdge], list[EntityEdge]]`.

- [ ] **Step 1: Write aggregation tests**

Test that three same-type weak entity relations create one table edge, two weak relations do not, one strong relation does, and multiple relations between the same entity IDs become one edge with multiple independent relation entries.

- [ ] **Step 2: Run tests and verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_graph_builder.py -q`

Expected: FAIL because graph builder is missing.

- [ ] **Step 3: Implement evidence-preserving merge and support thresholds**

Use a canonical entity-pair key only for deduplication. Preserve each relation's original direction. Aggregate `strong_count`, `weak_count`, `entity_edge_count`, average confidence, relation types, and supporting entity-edge IDs. Apply the exact table-edge rules from the design.

- [ ] **Step 4: Run graph-builder tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_graph_builder.py -q`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/engine/semantic/graph_builder.py backend/tests/semantic/test_graph_builder.py
git commit -m "feat: assemble explainable semantic graph"
```

---

### Task 8: RelationshipAnalyzer orchestration and API integration

**Files:**
- Create: `backend/engine/semantic/analyzer.py`
- Modify: `backend/engine/pipeline.py`
- Modify: `backend/models/schemas.py`
- Modify: `backend/routers/analyze.py`
- Test: `backend/tests/semantic/test_analyzer.py`
- Modify: `backend/tests/test_analyze.py`

**Interfaces:**
- Consumes: all interfaces from Tasks 1–7.
- Produces: `RelationshipAnalyzer.analyze(engine, scope, on_progress) -> AnalysisResult`, updated HTTP/WS/export contract.

- [ ] **Step 1: Write analyzer status tests**

Cover:

```python
assert complete_result.status == AnalysisStatus.COMPLETE
assert partial_result.status == AnalysisStatus.PARTIAL
assert partial_result.diagnostics.candidates_pending > 0
assert failed_result.status == AnalysisStatus.FAILED
```

Also assert malformed LLM output cannot become `complete` with zero edges, and progress events expose entity/plan/candidate/edge counts.

- [ ] **Step 2: Run analyzer tests and verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_analyzer.py -q`

Expected: FAIL because analyzer orchestration is missing.

- [ ] **Step 3: Implement deadline-aware orchestration**

Calculate one monotonic deadline at task start. Check it before each table read, plan request, index build, candidate batch, judgment launch, and graph assembly. Derive status:

```python
if no_trustworthy_output and (planner_failed or all_judgment_groups_failed):
    status = AnalysisStatus.FAILED
elif pending_or_failed_groups:
    status = AnalysisStatus.PARTIAL
else:
    status = AnalysisStatus.COMPLETE
```

Emit structured progress after every stage. Retrieve and judge only each `EntitySignatureGroup.representative`; after judgment, expand each accepted source/target signature pair into the corresponding concrete entity IDs before graph assembly so deduplication never drops records.

- [ ] **Step 4: Replace API request/response schemas**

Accept `{tables: [{name, fields}]}` for backward compatibility but map `fields` to `dimensions`. Final WS message must include:

```json
{
  "phase": "complete",
  "progress": 1.0,
  "status": "partial",
  "graph": {
    "table_nodes": [],
    "entity_nodes": [],
    "table_edges": [],
    "entity_edges": []
  },
  "diagnostics": {},
  "warnings": []
}
```

Persist the same result in the export registry.

- [ ] **Step 5: Run backend tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests -q`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add backend/engine/semantic/analyzer.py backend/engine/pipeline.py backend/models/schemas.py backend/routers/analyze.py backend/tests
git commit -m "feat: integrate semantic relationship analyzer"
```

---

### Task 9: Backend verification and migration cleanup

**Files:**
- Modify: `backend/engine/ai_decision_maker.py`
- Modify: `backend/engine/relationship_computer.py`
- Modify: `README.md`
- Test: `backend/tests/test_analyze.py`

**Interfaces:**
- Consumes: completed backend analyzer.
- Produces: one supported analysis path with no silent legacy fallback.

- [ ] **Step 1: Add a test proving the router uses only RelationshipAnalyzer**

Patch the legacy `decide_matches` and `compute_relationships` functions to raise if called; run a full HTTP/WS analysis with semantic adapters and assert completion.

- [ ] **Step 2: Run the migration test and verify it fails before cleanup**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\test_analyze.py -k semantic_analyzer_only -q`

Expected: FAIL if any legacy path is still invoked.

- [ ] **Step 3: Remove legacy production calls and document model prerequisites**

Keep legacy pure functions only if existing tests still require them; mark them non-production. Document the BGE model download/cache, DeepSeek `deepseek-v4-flash`, JSON Output, and the 180-second behavior.

- [ ] **Step 4: Run complete backend verification**

Run:

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests -q
git diff --check
```

Expected: all tests pass and `git diff --check` prints nothing.

- [ ] **Step 5: Commit**

```powershell
git add backend README.md
git commit -m "refactor: retire legacy relationship pipeline"
```
