# Business-Friendly Graph Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete analysis flow understandable to non-technical users by naming nodes from `name`, using `class_name` only as hidden relationship context, and presenting tables, relations, details, and graph styling in business language.

**Architecture:** Add a small backend business-semantics boundary that classifies required fields, generates stable node display metadata, and supplies non-blocking table summaries and relationship labels. Keep graph interaction and rendering in the frontend, but replace per-component label guesses with one snapshot-wide presentation index shared by Canvas, search, accessibility, and details.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy, DeepSeek JSON adapter, React 19, TypeScript 6, Zustand 5, Canvas 2D, Vitest, Pytest.

## Global Constraints

- Every graph node represents a business object named by `name`.
- `name + class_name` is the primary relationship-analysis context; every other selected field is auxiliary evidence only.
- `class_name`, database IDs, model IDs, task IDs, table names, and field names never become normal node labels.
- `name` and `class_name` are required and automatically included; users cannot deselect them.
- Only duplicate names receive a second-line business code; missing codes use stable `同名 N` labels calculated from the complete snapshot.
- The result workbench uses a light canvas and solid colored nodes with a thin white outline.
- Relationship labels use short business verbs and fall back to `相关`.
- Existing JSON snapshots remain importable; new public fields are optional in the TypeScript compatibility boundary.
- Do not replace Canvas, Web Worker layout, Zustand, or the existing graph-analysis algorithm.

---

## File Structure

### Backend business semantics

- Create `backend/engine/business_fields.py`: one source of truth for identifying `name`, `class_name`, and business-code candidates.
- Create `backend/engine/table_semantics.py`: bounded sample collection, DeepSeek-backed table-label inference, deterministic fallback, and response-safe summaries.
- Modify `backend/database.py`: expose field-role flags and a bounded table-summary input query.
- Modify `backend/models/schemas.py`: extend table/column browse responses.
- Modify `backend/routers/tables.py`: add non-blocking semantic-summary endpoint and required-field metadata.
- Modify `backend/engine/schema_analyzer.py`: carry `is_name` alongside `is_class_name`.
- Modify `backend/engine/semantic/models.py`: add node display code and relationship display label.
- Modify `backend/engine/semantic/corpus.py`: always load required fields and generate display metadata only from `name` plus business-code candidates.
- Modify `backend/engine/semantic/analyzer.py`: preserve `name + class_name` as primary context while excluding them from auxiliary dimensions.
- Modify `backend/engine/semantic/graph_builder.py`: expose display code and normalized business relation labels.

### Frontend presentation

- Modify `frontend/src/api/tables.ts`: table summaries and `is_name` metadata.
- Modify `frontend/src/api/analysis.ts`: optional `display_code` and `display_label` compatibility fields.
- Modify `frontend/src/store/analysis.ts`: required-field enforcement, summary loading, and business-facing validation.
- Create `frontend/src/graph/businessPresentation.ts`: snapshot-wide duplicate detection, stable secondary labels, search text, and accessible labels.
- Modify `frontend/src/graph/scene.ts`: consume shared presentations and business relationship labels.
- Modify `frontend/src/graph/renderer.ts`: light theme, solid outlined nodes, and labels centered below nodes.
- Modify `frontend/src/components/SelectionWorkspace.tsx`: business-data copy and summary loading.
- Replace `frontend/src/components/DatabaseTableAccordion.tsx` with focused `frontend/src/components/BusinessDatasetCard.tsx`.
- Modify `frontend/src/components/GraphCanvas.tsx`: shared presentation-based search and keyboard labels.
- Modify `frontend/src/components/GraphWorkbench.tsx`, `GraphToolbar.tsx`, `NodeDetailPanel.tsx`, `StrengthFilter.tsx`, and `frontend/src/index.css`: business vocabulary, light surfaces, and disclosure hierarchy.

---

### Task 1: Establish required business-field roles

**Files:**
- Create: `backend/engine/business_fields.py`
- Modify: `backend/database.py`
- Modify: `backend/engine/schema_analyzer.py`
- Modify: `backend/models/schemas.py`
- Modify: `backend/routers/tables.py`
- Test: `backend/tests/test_tables.py`
- Create: `backend/tests/test_business_fields.py`

**Interfaces:**
- Produces: `normalize_field_name(name: str) -> str`
- Produces: `is_name_field(name: str) -> bool`
- Produces: `is_class_name_field(name: str) -> bool`
- Produces: `business_code_priority(name: str) -> int | None`
- Produces: `ColumnInfo.is_name: bool`
- Produces: `ColumnMeta.is_name: bool`
- Consumes: SQLAlchemy column names already returned by `Inspector.get_columns()`.

- [ ] **Step 1: Write failing field-role tests**

Add focused cases proving exact normalized `name` matching, existing class-name aliases, and code priority without treating plain `id` as a business code:

```python
from engine.business_fields import (
    business_code_priority,
    is_class_name_field,
    is_name_field,
)


def test_business_field_roles_are_explicit():
    assert is_name_field("name") is True
    assert is_name_field("Name") is True
    assert is_name_field("display_name") is False
    assert is_class_name_field("className") is True
    assert business_code_priority("part_code") == 0
    assert business_code_priority("serial_number") == 1
    assert business_code_priority("id") is None
```

Extend `/api/tables/users/fields` assertions with `is_name=True` only for `name`.

- [ ] **Step 2: Run tests and verify the missing API fails**

Run: `uv run --directory backend pytest tests/test_business_fields.py tests/test_tables.py -q`

Expected: FAIL because `engine.business_fields` and `ColumnInfo.is_name` do not exist.

- [ ] **Step 3: Implement the shared role classifier**

Create `business_fields.py` with deterministic token matching:

```python
import re
import unicodedata

CLASS_NAME_FIELDS = {"class_name", "classname", "class"}
CODE_TOKENS = ("code", "number", "no", "serial", "model")


def normalize_field_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKC", name).strip()
    return re.sub(r"(?<!^)(?=[A-Z])", "_", normalized).lower()


def is_name_field(name: str) -> bool:
    return normalize_field_name(name) == "name"


def is_class_name_field(name: str) -> bool:
    normalized = normalize_field_name(name)
    return normalized in CLASS_NAME_FIELDS or normalized.replace("_", "") == "classname"


def business_code_priority(name: str) -> int | None:
    tokens = [token for token in re.split(r"[^a-z0-9]+", normalize_field_name(name)) if token]
    for priority, token in enumerate(CODE_TOKENS):
        if token in tokens:
            return priority
    return None
```

Use these functions in `database.get_table_columns()` and `_analyze_single_table()`. Add `is_name` to `ColumnInfo` and `ColumnMeta`; remove duplicated class-name constants.

- [ ] **Step 4: Run field-role and browse tests**

Run: `uv run --directory backend pytest tests/test_business_fields.py tests/test_tables.py -q`

Expected: PASS, including `name`, `class_name`, `className`, `class`, and plain `id` cases.

- [ ] **Step 5: Commit the field-role boundary**

```powershell
git add backend/engine/business_fields.py backend/database.py backend/engine/schema_analyzer.py backend/models/schemas.py backend/routers/tables.py backend/tests/test_business_fields.py backend/tests/test_tables.py
git commit -m "feat: classify required business fields"
```

### Task 2: Generate stable node display metadata and primary analysis context

**Files:**
- Modify: `backend/engine/semantic/models.py`
- Modify: `backend/engine/semantic/corpus.py`
- Modify: `backend/engine/semantic/analyzer.py`
- Modify: `backend/engine/semantic/judge.py`
- Modify: `backend/engine/semantic/graph_builder.py`
- Test: `backend/tests/semantic/test_corpus.py`
- Test: `backend/tests/semantic/test_analyzer.py`
- Test: `backend/tests/semantic/test_judge.py`
- Test: `backend/tests/semantic/test_graph_builder.py`

**Interfaces:**
- Consumes: `ColumnMeta.is_name`, `ColumnMeta.is_class_name`, and `business_code_priority()` from Task 1.
- Produces: `EntityDocument.display_code: str | None`
- Produces: `EntityNode.display_code: str | None`
- Produces: `required_field_names(schema: TableSchema) -> tuple[str, str]`
- Produces: `select_display_code(row: dict[str, object], schema: TableSchema) -> str | None`
- Produces: judge payload `business_context: {name: str, class_name: str}` plus `auxiliary_evidence`.

- [ ] **Step 1: Write failing corpus tests for required fields and display values**

Add tests with auxiliary fields ordered before `name` and with an internal primary key:

```python
def test_display_metadata_uses_name_and_business_code_only(engine):
    scope = AnalysisScope(
        tables=[TableScope(name="users", dimensions=["email"])]
    )
    schema = analyze_schema(engine, ["users"])
    records = load_scoped_records(engine, scope, schema)
    documents = build_entity_documents(records, scope, schema)

    assert documents[0].display_name == "Alice"
    assert documents[0].class_name == "com.example.User"
    assert documents[0].dimensions == {"email": "alice@example.com"}
    assert documents[0].display_code is None
```

Add missing/blank-name coverage asserting `display_name == "未命名对象"`; add a fixture with `part_code="GY0000203"` asserting that value becomes `display_code` while integer `id` does not.

- [ ] **Step 2: Run the corpus tests and verify current first-dimension behavior fails**

Run: `uv run --directory backend pytest tests/semantic/test_corpus.py tests/semantic/test_graph_builder.py -q`

Expected: FAIL because required `name` is not automatically loaded and `display_code` is absent.

- [ ] **Step 3: Implement required-field loading and display metadata**

Change `build_entity_documents` to accept `SchemaAnalysisResult` instead of separate PK/class maps. Add exact helpers:

```python
def required_field_names(schema: TableSchema) -> tuple[str, str]:
    name_field = next((column.name for column in schema.columns if column.is_name), None)
    class_field = next((column.name for column in schema.columns if column.is_class_name), None)
    if name_field is None:
        raise ValueError(f"Table {schema.name} is missing required name field")
    if class_field is None:
        raise ValueError(f"Table {schema.name} is missing required class_name field")
    return name_field, class_field


def select_display_code(row: dict[str, object], schema: TableSchema) -> str | None:
    candidates = sorted(
        (
            (priority, column.name)
            for column in schema.columns
            if (priority := business_code_priority(column.name)) is not None
        ),
        key=lambda item: (item[0], item[1].lower(), item[1]),
    )
    for _, field_name in candidates:
        value = row.get(field_name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None
```

`load_scoped_records()` must append both required fields before de-duplicating columns. `dimensions` and `normalized_dimensions` must still contain only user-selected auxiliary fields. Build `search_text` from `display_name`, `class_name`, then auxiliary evidence so the primary context is explicit.

- [ ] **Step 4: Remove the analyzer's current class-only special case and validate both required fields**

Replace `class_name_fields` and the current `effective_scope` filtering with schema-driven required fields. Ensure `name`, `class_name`, primary keys, and foreign-key support columns are excluded from auxiliary dimensions, while both required values remain on `EntityDocument`. Before record loading, collect tables missing either role and return a failed result with exactly one safe warning per condition: `缺少业务名称字段。` or `缺少对象类型信息，无法进行主要关系判断。`. Add both strings to `_safe_warnings()` so they are not rewritten as timeouts. Count blank names during document construction and append the fixed warning `部分对象缺少业务名称。` without including table names or row values.

- [ ] **Step 5: Make the semantic judge receive primary context separately from evidence**

Change `_entity_payload()` in `judge.py` to return this exact shape:

```python
return {
    "entity_id": entity.entity_id,
    "business_context": {
        "name": entity.display_name,
        "class_name": entity.class_name,
    },
    "auxiliary_evidence": {
        name: _canonical_json_value(entity.dimensions[name])
        for name in dimensions
        if name in entity.dimensions
    },
}
```

Update the system prompt to state that `business_context` identifies the two objects and `auxiliary_evidence` may only support or reject a relationship. Preserve the existing validator rule that returned evidence fields must belong to the planned auxiliary dimensions. Add a judge test that inspects the outbound request and asserts `name` and `class_name` are present even though neither appears in `auxiliary_evidence`.

- [ ] **Step 6: Expose `display_code` through graph construction**

Add nullable `display_code` fields to `EntityDocument` and `EntityNode`, then copy it in `build_graph()`:

```python
EntityNode(
    id=document.entity_id,
    table_id=document.table_name,
    display_name=document.display_name,
    display_code=document.display_code,
    class_name=document.class_name,
    dimensions=document.dimensions,
)
```

- [ ] **Step 7: Run semantic backend tests**

Run: `uv run --directory backend pytest tests/semantic/test_corpus.py tests/semantic/test_analyzer.py tests/semantic/test_judge.py tests/semantic/test_graph_builder.py -q`

Expected: PASS; assertions confirm `name + class_name` are present as primary context and other fields remain auxiliary dimensions/evidence.

- [ ] **Step 8: Commit node business metadata**

```powershell
git add backend/engine/semantic/models.py backend/engine/semantic/corpus.py backend/engine/semantic/analyzer.py backend/engine/semantic/judge.py backend/engine/semantic/graph_builder.py backend/tests/semantic/test_corpus.py backend/tests/semantic/test_analyzer.py backend/tests/semantic/test_judge.py backend/tests/semantic/test_graph_builder.py
git commit -m "feat: derive node identity from business names"
```

### Task 3: Add bounded table-semantic summaries

**Files:**
- Create: `backend/engine/table_semantics.py`
- Modify: `backend/database.py`
- Modify: `backend/models/schemas.py`
- Modify: `backend/routers/tables.py`
- Test: `backend/tests/test_table_semantics.py`
- Test: `backend/tests/test_tables.py`

**Interfaces:**
- Produces: `TableSummaryInput(table_name, row_count, name_samples, class_name_samples, column_names)`
- Produces: `TableBusinessSummary(table_name, semantic_name, row_count, name_samples, status)`
- Produces: `infer_table_summaries(inputs, llm) -> list[TableBusinessSummary]`
- Produces: `GET /api/table-summaries -> list[TableBusinessSummaryResponse]`
- Consumes: `DeepSeekJsonAdapter.complete_json()` and Task 1 field-role classifiers.

- [ ] **Step 1: Write failing deterministic fallback tests**

Create tests that never call the network:

```python
class FailingLlm:
    async def complete_json(self, **_kwargs):
        raise RuntimeError("offline")


async def test_summary_falls_back_without_blocking():
    result = await infer_table_summaries([
        TableSummaryInput(
            table_name="assembly_process",
            row_count=128,
            name_samples=["通信卫星总装", "高增益天线装配"],
            class_name_samples=["com.example.AssemblyProcess"],
            column_names=["id", "name", "class_name"],
        )
    ], FailingLlm())
    assert result[0].semantic_name == "Assembly Process 数据"
    assert result[0].status == "fallback"
```

Add tests limiting each sample list to three non-empty strings and ensuring exception text/API keys never appear in the response.

- [ ] **Step 2: Run tests and verify the summary module is missing**

Run: `uv run --directory backend pytest tests/test_table_semantics.py tests/test_tables.py -q`

Expected: FAIL because the summary models and endpoint do not exist.

- [ ] **Step 3: Implement bounded summary input collection**

Add `get_table_summary_input(engine, table_name, sample_limit=3)` using SQLAlchemy Core. Reflect only the table, require identified `name` and `class_name`, execute one `COUNT(*)` query and one limited non-empty sample query selecting those two columns. Return only strings truncated to 80 Unicode code points; never include other row values.

- [ ] **Step 4: Implement one batched, validated LLM request and fallback**

Define a Pydantic response model containing only `{table_name, semantic_name}`. Send one JSON request for all table inputs with instructions to return a concise Chinese business category, never a record name, class path, or database type. Wrap the call in `asyncio.timeout(8)` and validate that each returned `table_name` belongs to the input set. For missing, invalid, timed-out, or failed items, use:

```python
def fallback_semantic_name(table_name: str) -> str:
    words = re.sub(r"(?<!^)(?=[A-Z])", "_", table_name).replace("-", "_").split("_")
    readable = " ".join(word.capitalize() for word in words if word)
    return f"{readable or '业务'} 数据"
```

- [ ] **Step 5: Add the non-blocking endpoint contract**

Implement `async def list_table_summaries(...)`. Use `asyncio.to_thread()` for database inspection, then call the summarizer. Return HTTP 200 with per-table `status: "inferred" | "fallback"`; a summarizer failure must not return 5xx. Database unavailability continues to use the existing safe 503 response.

- [ ] **Step 6: Run endpoint and summary tests**

Run: `uv run --directory backend pytest tests/test_table_semantics.py tests/test_tables.py -q`

Expected: PASS for inferred, fallback, bounded-sample, missing-field, and safe-error cases.

- [ ] **Step 7: Commit table summaries**

```powershell
git add backend/engine/table_semantics.py backend/database.py backend/models/schemas.py backend/routers/tables.py backend/tests/test_table_semantics.py backend/tests/test_tables.py
git commit -m "feat: summarize database tables for business users"
```

### Task 4: Build the business-data selection experience

**Files:**
- Modify: `frontend/src/api/tables.ts`
- Modify: `frontend/src/api/tables.test.ts`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/store/analysis.test.ts`
- Create: `frontend/src/components/BusinessDatasetCard.tsx`
- Create: `frontend/src/components/__tests__/BusinessDatasetCard.test.tsx`
- Modify: `frontend/src/components/SelectionWorkspace.tsx`
- Modify: `frontend/src/components/__tests__/SelectionWorkspace.test.tsx`
- Delete: `frontend/src/components/DatabaseTableAccordion.tsx`
- Delete: `frontend/src/components/__tests__/DatabaseTableAccordion.test.tsx`
- Modify: `frontend/src/components/AnalysisLauncher.tsx`
- Modify: `frontend/src/components/__tests__/AnalysisLauncher.test.tsx`

**Interfaces:**
- Consumes: `GET /api/table-summaries` and `ColumnInfo.is_name` from Tasks 1 and 3.
- Produces: `TableBusinessSummary` TypeScript interface.
- Produces: store state `tableSummaries: Map<string, TableBusinessSummary>` and `loadTableSummaries(): Promise<void>`.
- Produces: `isRequiredBusinessColumn(column): boolean`.

- [ ] **Step 1: Write failing API and store tests**

Add a fetch contract test and required-field selection test:

```ts
expect(await fetchTableSummaries()).toEqual([{
  table_name: "assembly_process",
  semantic_name: "装配工艺数据",
  row_count: 128,
  name_samples: ["通信卫星总装", "高增益天线装配"],
  status: "inferred",
}]);

expect(isRequiredBusinessColumn({
  name: "name", type: "VARCHAR", is_name: true,
  is_class_name: false, is_primary_key: false,
})).toBe(true);
```

Assert `startAnalysis()` submits `fields` containing only selected auxiliary fields; the backend remains responsible for auto-including required fields. Assert missing `name` and missing `class_name` produce the approved Chinese validation messages before submission.

- [ ] **Step 2: Run API/store tests and verify failure**

Run: `npm test -- --run src/api/tables.test.ts src/store/analysis.test.ts`

Working directory: `frontend`

Expected: FAIL because summary state and `is_name` are absent.

- [ ] **Step 3: Add summary API and store state**

Add exact interfaces from the backend response, fetch summaries after the table list resolves, and merge results by `table_name`. Summary errors set a non-blocking `tableSummariesWarning`; they must not set `tablesError`.

Implement:

```ts
export function isRequiredBusinessColumn(column: ColumnInfo): boolean {
  return column.is_name || column.is_class_name;
}

export function isAuxiliaryColumn(column: ColumnInfo): boolean {
  return !isRequiredBusinessColumn(column) && !column.is_primary_key;
}
```

Use only `isAuxiliaryColumn` for toggle, select-all, deselect-all, and submitted `fields`.

- [ ] **Step 4: Write the dataset-card component test**

Render a card and assert visible content is `装配工艺数据`, `assembly_process`, `128 个对象`, two sample names, and “辅助判断依据”. Assert `class_name` is not rendered as a selectable row and database types appear only after clicking “技术信息”.

- [ ] **Step 5: Implement `BusinessDatasetCard` and selection copy**

Use semantic name as the card heading and original table name as subdued source text. Include the exact explanation “系统将使用名称和对象类型判断关系。” Render required roles as a non-interactive summary, auxiliary fields as checkboxes, and technical metadata inside a native `<details>` element. Replace page/title/button copy with “选择要分析的业务数据” and “生成业务关系图”.

- [ ] **Step 6: Run selection component tests**

Run: `npm test -- --run src/components/__tests__/BusinessDatasetCard.test.tsx src/components/__tests__/SelectionWorkspace.test.tsx src/components/__tests__/AnalysisLauncher.test.tsx src/store/analysis.test.ts`

Working directory: `frontend`

Expected: PASS; summary failure still leaves cards selectable by original table name.

- [ ] **Step 7: Commit the selection workflow**

```powershell
git add frontend/src/api/tables.ts frontend/src/api/tables.test.ts frontend/src/store/analysis.ts frontend/src/store/analysis.test.ts frontend/src/components/BusinessDatasetCard.tsx frontend/src/components/__tests__/BusinessDatasetCard.test.tsx frontend/src/components/SelectionWorkspace.tsx frontend/src/components/__tests__/SelectionWorkspace.test.tsx frontend/src/components/AnalysisLauncher.tsx frontend/src/components/__tests__/AnalysisLauncher.test.tsx frontend/src/components/DatabaseTableAccordion.tsx frontend/src/components/__tests__/DatabaseTableAccordion.test.tsx
git commit -m "feat: present tables as business datasets"
```

### Task 5: Create one snapshot-wide entity presentation index

**Files:**
- Modify: `frontend/src/api/analysis.ts`
- Create: `frontend/src/graph/businessPresentation.ts`
- Create: `frontend/src/graph/businessPresentation.test.ts`
- Modify: `frontend/src/graph/scene.ts`
- Modify: `frontend/src/graph/scene.test.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx`
- Modify: `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- Delete: `frontend/src/graph/presentation.ts`
- Delete: `frontend/src/graph/presentation.test.ts`

**Interfaces:**
- Consumes: optional `EntityNodeData.display_code` from Task 2.
- Produces: `buildBusinessPresentationIndex(entities, degrees) -> Map<string, BusinessEntityPresentation>`.
- Produces: `BusinessEntityPresentation { primary, secondary, accessibleLabel, searchText, isDuplicate }`.
- Produces: `businessName(entity) -> string` legacy-snapshot fallback.

- [ ] **Step 1: Write failing presentation tests**

Cover unique, duplicate-with-code, duplicate-without-code, blank name, old snapshots, and filter stability:

```ts
const index = buildBusinessPresentationIndex([
  entity("a", "通信天线装配", "GY0000203"),
  entity("b", "通信天线装配", "GY0000204"),
  entity("c", "电性能测试", null),
], new Map([["a", 2], ["b", 1], ["c", 0]]));

expect(index.get("a")).toMatchObject({
  primary: "通信天线装配",
  secondary: "GY0000203",
  isDuplicate: true,
});
expect(index.get("c")?.secondary).toBe("");
```

For no-code duplicates, assert stable ID ordering gives `同名 1` and `同名 2`. Assert class/table/ID values never appear in `primary`.

- [ ] **Step 2: Run presentation tests and verify old heuristics fail**

Run: `npm test -- --run src/graph/businessPresentation.test.ts src/graph/scene.test.ts`

Working directory: `frontend`

Expected: FAIL because the snapshot-wide index does not exist and current secondary labels expose class/table and relationship count.

- [ ] **Step 3: Implement the business presentation index**

Implement legacy fallback in this exact order: non-empty `dimensions.name`, meaningful existing `display_name`, `未命名对象`. Treat blank, `0`, `1`, booleans, and status-only values as non-meaningful. Normalize duplicate comparison with NFKC, trim, whitespace collapse, and locale-lowercase. Assign no-code ordinals after sorting duplicate members by `entity.id`, but calculate duplicates from the complete entity list passed at snapshot load.

- [ ] **Step 4: Integrate the index into scene construction**

Build degrees first, then one presentation index. Replace calls to `presentEntity(entity, degree)` with `presentations.get(entity.id)`. Entity labels use `primary` and `secondary`; never use `class_name`, table ID, or degree as the secondary line.

- [ ] **Step 5: Use the shared index for search and accessibility**

In `GraphCanvas`, rank exact/prefix/contains matches against `presentation.searchText`. Keyboard target labels use `accessibleLabel`, not raw `display_name` or entity ID. Keep raw ID matching only inside an explicitly technical compatibility path that is not rendered in normal search suggestions.

- [ ] **Step 6: Run presentation, scene, and Canvas tests**

Run: `npm test -- --run src/graph/businessPresentation.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx`

Working directory: `frontend`

Expected: PASS for unique and duplicate labels, stable ordinals, old snapshots, search, and keyboard names.

- [ ] **Step 7: Commit shared entity presentation**

```powershell
git add frontend/src/api/analysis.ts frontend/src/graph/businessPresentation.ts frontend/src/graph/businessPresentation.test.ts frontend/src/graph/scene.ts frontend/src/graph/scene.test.ts frontend/src/components/GraphCanvas.tsx frontend/src/components/__tests__/GraphCanvas.test.tsx frontend/src/graph/presentation.ts frontend/src/graph/presentation.test.ts
git commit -m "feat: unify business node names across graph views"
```

### Task 6: Normalize business relationship labels and detail hierarchy

**Files:**
- Modify: `backend/engine/semantic/models.py`
- Modify: `backend/engine/semantic/planner.py`
- Modify: `backend/engine/semantic/judge.py`
- Modify: `backend/engine/semantic/graph_builder.py`
- Test: `backend/tests/semantic/test_planner.py`
- Test: `backend/tests/semantic/test_judge.py`
- Test: `backend/tests/semantic/test_graph_builder.py`
- Modify: `frontend/src/api/analysis.ts`
- Create: `frontend/src/graph/businessRelations.ts`
- Create: `frontend/src/graph/businessRelations.test.ts`
- Modify: `frontend/src/graph/scene.ts`
- Modify: `frontend/src/components/NodeDetailPanel.tsx`
- Modify: `frontend/src/components/__tests__/NodeDetailPanel.test.tsx`

**Interfaces:**
- Produces: `RelationshipPlan.display_label: str`, copied unchanged through `RelationDecision` into `EntityRelation.display_label`.
- Produces: optional `EntityRelationData.display_label?: string` for legacy snapshots.
- Produces: `businessRelationLabel(relation) -> string`.
- Produces: `confidenceBand(value) -> "明确" | "较可信" | "可能有关"`.
- Consumes: shared business entity presentations from Task 5.

- [ ] **Step 1: Write failing relation-label tests**

Backend assertions:

```python
assert relation.display_label == "包含"
assert normalize_relation_label("") == "相关"
assert normalize_relation_label("business_relationship") == "相关"
```

Add a planner adapter test whose captured response contains `relation_type="assembly_containment"` and `display_label="包含"`; assert both values survive validation. Add a judge request/response test asserting the judge must echo the planned `display_label` exactly and cannot substitute an unrelated phrase.

Frontend assertions:

```ts
expect(businessRelationLabel({ display_label: "用于检验", relation_type: "llm_check" })).toBe("用于检验");
expect(businessRelationLabel({ display_label: undefined, relation_type: "" })).toBe("相关");
expect(confidenceBand(0.92)).toBe("明确");
expect(confidenceBand(0.71)).toBe("较可信");
expect(confidenceBand(0.40)).toBe("可能有关");
```

- [ ] **Step 2: Run relation tests and verify failure**

Run backend: `uv run --directory backend pytest tests/semantic/test_planner.py tests/semantic/test_judge.py tests/semantic/test_graph_builder.py -q`

Run frontend from `frontend`: `npm test -- --run src/graph/businessRelations.test.ts src/components/__tests__/NodeDetailPanel.test.tsx`

Expected: FAIL because display labels and confidence bands are absent.

- [ ] **Step 3: Plan and validate a separate business display label**

Add `display_label: str = "相关"` to `RelationshipPlan`, `RelationDecision`, and `EntityRelation`. Change the planner response example and prompt so every plan supplies a concise Chinese business verb of 2–12 code points, while `relation_type` remains the stable internal category. Change the judge response schema and validation so returned `display_label` must equal `group.plan.display_label`. Normalize the final public label after trimming and length-limit it to 12 code points. Map invalid, generic, or blank values to `相关`. Keep `relation_type` unchanged for export and technical evidence. For deterministic relations that never pass through the planner, map known structural categories to Chinese verbs and use `相关` for unknown categories.

- [ ] **Step 4: Add frontend legacy normalization**

Implement `businessRelationLabel()` with `display_label` first, a small explicit map for known existing Chinese/business labels second, and `相关` last. Never render raw snake_case or camelCase relation types in the normal layer.

- [ ] **Step 5: Rebuild the detail panel hierarchy**

Use the shared entity presentations for headings and connected-object buttons. The default relation view shows `业务名称 A → 业务名称 B`, business label, explanation, confidence band, and only evidence entries attached to that relation. Put exact confidence, raw relation type, `class_name`, matching method, model ID, and task ID inside `<details><summary>技术依据</summary>`. Put complete `dimensions` inside a separate `<details><summary>查看原始数据</summary>`.

- [ ] **Step 6: Run backend and frontend relation-detail tests**

Run backend: `uv run --directory backend pytest tests/semantic/test_planner.py tests/semantic/test_judge.py tests/semantic/test_graph_builder.py -q`

Run frontend from `frontend`: `npm test -- --run src/graph/businessRelations.test.ts src/graph/scene.test.ts src/components/__tests__/NodeDetailPanel.test.tsx`

Expected: PASS; normal rendered text excludes class paths, IDs, raw relation types, model IDs, and task IDs until the matching disclosure is opened.

- [ ] **Step 7: Commit relationship presentation**

```powershell
git add backend/engine/semantic/models.py backend/engine/semantic/planner.py backend/engine/semantic/judge.py backend/engine/semantic/graph_builder.py backend/tests/semantic/test_planner.py backend/tests/semantic/test_judge.py backend/tests/semantic/test_graph_builder.py frontend/src/api/analysis.ts frontend/src/graph/businessRelations.ts frontend/src/graph/businessRelations.test.ts frontend/src/graph/scene.ts frontend/src/components/NodeDetailPanel.tsx frontend/src/components/__tests__/NodeDetailPanel.test.tsx
git commit -m "feat: explain relationships in business language"
```

### Task 7: Apply the light graph theme and non-technical workbench copy

**Files:**
- Modify: `frontend/src/graph/renderer.ts`
- Modify: `frontend/src/graph/renderer.test.ts`
- Modify: `frontend/src/components/GraphWorkbench.tsx`
- Modify: `frontend/src/components/GraphToolbar.tsx`
- Create: `frontend/src/components/GraphLegend.tsx`
- Create: `frontend/src/components/__tests__/GraphLegend.test.tsx`
- Modify: `frontend/src/components/StrengthFilter.tsx`
- Modify: `frontend/src/components/ProgressIndicator.tsx`
- Modify: `frontend/src/components/__tests__/GraphWorkbench.test.tsx`
- Modify: `frontend/src/components/__tests__/GraphToolbar.test.tsx`
- Modify: `frontend/src/components/__tests__/StrengthFilter.test.tsx`
- Modify: `frontend/src/components/__tests__/ProgressIndicator.test.tsx`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/test/NebulaVisualHarness.tsx`

**Interfaces:**
- Consumes: scene labels from Tasks 5 and 6.
- Produces: light Canvas palette and centered-below-node label geometry.
- Produces: business-facing toolbar and analysis-state copy.
- Produces: a color legend that resolves table IDs to `tableSummaries.semantic_name`, with `TableNodeData.display_name` as the legacy fallback.

- [ ] **Step 1: Write failing renderer tests for the approved visual contract**

Use the mocked Canvas context to assert `drawGrid()` fills `#f3f5f7`, every entity node performs both `fill()` and `stroke()` with a white outline, primary labels are centered below the node, and edge colors use low-contrast light-theme values. Keep the active-node outline thicker without changing its business color.

- [ ] **Step 2: Run renderer tests and verify dark-theme expectations fail**

Run: `npm test -- --run src/graph/renderer.test.ts`

Working directory: `frontend`

Expected: FAIL because the renderer currently fills `#0d1926`, uses light text, positions labels to the right, and outlines only active nodes.

- [ ] **Step 3: Implement the approved Canvas theme**

Centralize these constants in `renderer.ts`:

```ts
const GRAPH_BACKGROUND = "#f3f5f7";
const GRAPH_GRID = "#e4e8ed";
const ENTITY_EDGE = "#aeb6c1";
const TABLE_EDGE = "#8d98a7";
const PRIMARY_TEXT = "#252b35";
const SECONDARY_TEXT = "#667085";
const NODE_OUTLINE = "#ffffff";
```

Always fill solid entity circles, then stroke with `NODE_OUTLINE` at 1.5px; selected nodes use 3px. Recalculate label bounds and draw positions centered on `node.screen.x`, starting at `node.screen.y + node.screenRadius + 6`.

- [ ] **Step 4: Write failing workbench-copy tests**

Assert the toolbar renders `业务关系图`, `{N} 个对象`, `{N} 条业务关系`, `关系可信程度`, `适应视图`, and `重新生成布局`. Assert it does not render `实体边`, `表边`, `候选关系`, or `语义维度` in the normal layer. Add `GraphLegend.test.tsx` with two selected data sources and assert their solid-node colors are labeled `装配工艺数据` and `检验标准数据`, while raw table names appear only as subdued source text.

- [ ] **Step 5: Convert React surfaces to the light business theme and add the semantic legend**

Change the workbench root to a light neutral background, white toolbar/detail surfaces, slate text, and subtle borders. Preserve responsive drawer behavior and focus visibility. Add `GraphLegend` as a collapsible overlay in the upper-left of the Canvas; consume the same table-color function exported by `scene.ts` and resolve labels from `useAnalysisStore.tableSummaries`. Convert analysis notices to business impact copy; move candidate counters and diagnostics into a collapsed “技术详情”. Keep export and new-analysis actions.

- [ ] **Step 6: Run renderer and workbench component tests**

Run: `npm test -- --run src/graph/renderer.test.ts src/components/__tests__/GraphWorkbench.test.tsx src/components/__tests__/GraphToolbar.test.tsx src/components/__tests__/GraphLegend.test.tsx src/components/__tests__/StrengthFilter.test.tsx src/components/__tests__/ProgressIndicator.test.tsx`

Working directory: `frontend`

Expected: PASS for light palette, solid outlined nodes, centered labels, responsive controls, and business-facing copy.

- [ ] **Step 7: Commit the approved visual theme**

```powershell
git add frontend/src/graph/renderer.ts frontend/src/graph/renderer.test.ts frontend/src/components/GraphWorkbench.tsx frontend/src/components/GraphToolbar.tsx frontend/src/components/GraphLegend.tsx frontend/src/components/__tests__/GraphLegend.test.tsx frontend/src/components/StrengthFilter.tsx frontend/src/components/ProgressIndicator.tsx frontend/src/components/__tests__/GraphWorkbench.test.tsx frontend/src/components/__tests__/GraphToolbar.test.tsx frontend/src/components/__tests__/StrengthFilter.test.tsx frontend/src/components/__tests__/ProgressIndicator.test.tsx frontend/src/index.css frontend/src/test/NebulaVisualHarness.tsx
git commit -m "feat: apply light business graph theme"
```

### Task 8: Verify compatibility, full flow, and documentation

**Files:**
- Modify: `frontend/src/__tests__/integration.test.tsx`
- Modify: `frontend/src/test/nebulaFixtures.ts`
- Modify: `frontend/src/components/__tests__/GraphWorkbench.error.test.tsx`
- Modify: `backend/tests/semantic/test_end_to_end.py`
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: all public fields and UI modules from Tasks 1–7.
- Produces: tested legacy-snapshot compatibility and documented business terminology.

- [ ] **Step 1: Add an end-to-end fixture with duplicate names**

Update the representative fixture to include:

```ts
{ id: "assembly:1", display_name: "通信天线装配", display_code: "GY0000203", class_name: "com.example.Assembly", dimensions: { name: "通信天线装配", code: "GY0000203" } }
{ id: "assembly:2", display_name: "通信天线装配", display_code: "GY0000204", class_name: "com.example.Assembly", dimensions: { name: "通信天线装配", code: "GY0000204" } }
{ id: "test:1", display_name: "电性能综合测试", display_code: null, class_name: "com.example.Test", dimensions: { name: "电性能综合测试" } }
```

Include a relation whose `display_label` is `用于检验` and whose raw `relation_type` is technical.

- [ ] **Step 2: Write integration assertions for the complete user journey**

Test: load table list, receive semantic summaries, select a business dataset, choose one auxiliary evidence field, submit analysis, receive the graph, find nodes by business name, select a duplicate, see its second-line code, open relation detail, and reveal technical evidence only after activating its disclosure.

- [ ] **Step 3: Add legacy snapshot coverage**

Create a graph fixture without `display_code` and `display_label`. Assert `dimensions.name` wins over a bad `display_name="0"`, duplicates receive stable `同名 N`, and relationship text falls back to `相关`. Assert no class/table/ID appears as a node title.

- [ ] **Step 4: Run targeted end-to-end tests**

Run backend: `uv run --directory backend pytest tests/semantic/test_end_to_end.py -q`

Run frontend from `frontend`: `npm test -- --run src/__tests__/integration.test.tsx src/components/__tests__/GraphWorkbench.error.test.tsx`

Expected: PASS for new and legacy payloads, partial results, failed analysis with available graph data, and summary fallback.

- [ ] **Step 5: Update project terminology and usage documentation**

Document the invariant that `name + class_name` is primary context and all other fields are auxiliary evidence. Update the user flow to “选择业务数据 → 选择辅助判断依据 → 生成业务关系图”. Document light solid-node presentation, duplicate codes, table semantic summaries, technical disclosures, and legacy snapshot fallback.

- [ ] **Step 6: Run complete verification**

Run backend: `uv run --directory backend pytest`

Run frontend from `frontend`:

```powershell
npm test -- --run
npm run build
```

Expected: all Pytest and Vitest tests pass; TypeScript/Vite production build exits 0.

- [ ] **Step 7: Perform browser visual acceptance**

Start backend and frontend with the documented commands. At 1920×1080, 1366×768, and a 390px-wide viewport, inspect 20-node and 200-node fixtures. Capture evidence for: light canvas, solid colored nodes, white outlines, names below nodes, code only on duplicate names, readable business relationship verbs, non-technical default details, responsive technical disclosures, and no label regression during filtering.

- [ ] **Step 8: Commit compatibility and documentation**

```powershell
git add frontend/src/__tests__/integration.test.tsx frontend/src/test/nebulaFixtures.ts frontend/src/components/__tests__/GraphWorkbench.error.test.tsx backend/tests/semantic/test_end_to_end.py README.md CONTEXT.md CHANGELOG.md
git commit -m "docs: describe business-friendly graph workflow"
```

---

## Final Review Gate

- [ ] Confirm `git status --short` contains no unintended files.
- [ ] Confirm every commit is limited to its task boundary.
- [ ] Confirm the full backend suite, full frontend suite, and production build passed in the final working tree.
- [ ] Confirm browser evidence covers both graph sizes and all three viewport classes.
- [ ] Compare the finished UI against `docs/superpowers/specs/2026-08-03-business-friendly-graph-presentation-design.md` and record any deliberate deviations before merging.
