# 自然语言分析表与字段选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户以自然语言默认生成可编辑的分析表与辅助字段选择，并保留现有手动选择与分析流程。

**Architecture:** 后端以 YAML 别名映射产生表级证据，但始终把当前可分析核心表目录提供给单个结构化 DeepSeek 选择器。选择器只返回表和辅助字段意图，确定性校验器扩展“未指定字段即全选”、阻止隐式字段被选中，并把安全结果交给前端共享的 Zustand `selectedTables` 状态。前端使用请求所有权和原子替换避免旧结果或半完成结果污染用户选择。

**Tech Stack:** Python 3.12、FastAPI、Pydantic v2、SQLAlchemy、PyYAML、OpenAI-compatible DeepSeek client、React 19、TypeScript、Zustand、Vitest、Testing Library。

## Global Constraints

- 自然语言选择只负责表和辅助字段，不生成或执行行级过滤；时间词仅帮助选表/字段。
- `name`、`class_name`、主键、外键不能作为 `dimensions` 返回；现有分析读取逻辑会隐式补齐它们。
- 未明确字段时，已选表的全部合法辅助字段默认进入 `dimensions`；不得因字段数量静默截断。
- 表数上限固定为 10；超过时返回 `needs_clarification` 和 `SCOPE_TOO_BROAD`。
- YAML 未命中、证据不足或歧义时，模型仍可从完整可分析目录做语义选表；它不是硬过滤器。
- 仅使用单次结构化模型选择；模型和服务故障返回 `unavailable`，不能误导用户补充描述。
- 模型上下文与接口日志不得包含表记录、提示词、原始异常或凭据；理由按普通文本渲染。
- 第一版 YAML 仅支持 `aliases -> tables` 的字面量映射；不实现正则、权重、字段词条或前端编辑。
- 保持现有手动选择、`/api/analyze`、WebSocket 和图谱行为；`metadata_revision` 只作为向后兼容的可选字段加入分析请求。

---

## 文件结构

| 路径 | 职责 |
|---|---|
| `backend/config/natural_language_glossary.yaml` | 首版可维护的 `aliases -> tables` 词汇表。 |
| `backend/engine/natural_selection/models.py` | 目录、词汇命中、模型输出和公开响应的 Pydantic 模型。 |
| `backend/engine/natural_selection/glossary.py` | YAML 加载、归一化、重复校验和别名命中。 |
| `backend/engine/natural_selection/catalog.py` | 从 SQLAlchemy 元数据构建不含记录值的可分析表目录和版本哈希。 |
| `backend/engine/natural_selection/service.py` | 结构化模型提示、语义选择、字段展开和确定性校验。 |
| `backend/routers/natural_language_selection.py` | `POST /api/natural-language-selection` 的 HTTP 映射与安全错误响应。 |
| `backend/models/schemas.py` | 请求/响应模型及 `AnalyzeRequest.metadata_revision`。 |
| `frontend/src/api/naturalSelection.ts` | 自然语言选择 HTTP 客户端与响应类型。 |
| `frontend/src/store/analysis.ts` | 模式、请求所有权、历史快照与原子应用 AI 结果。 |
| `frontend/src/components/NaturalLanguageSelectionPanel.tsx` | 描述输入、状态、建议和澄清/不可用提示。 |
| `frontend/src/components/SelectionModeToggle.tsx` | 自然语言/手动模式切换。 |
| `frontend/src/components/SelectionReplacementDialog.tsx` | 已人工修改时的差异确认与应用操作。 |

### Task 1: YAML 词汇表解析与项目配置

**Files:**
- Modify: `pyproject.toml`
- Modify: `backend/requirements.txt`
- Create: `backend/config/natural_language_glossary.yaml`
- Create: `backend/engine/natural_selection/__init__.py`
- Create: `backend/engine/natural_selection/models.py`
- Create: `backend/engine/natural_selection/glossary.py`
- Create: `backend/tests/natural_selection/test_glossary.py`
- Reuse: `docs/superpowers/specs/examples/natural-language-glossary-project-fixture.yaml`

**Interfaces:**
- Produces `Glossary`, `GlossaryMapping` and `GlossaryHit` from `engine.natural_selection.glossary`.
- `load_glossary(path: Path, catalog_table_names: set[str]) -> Glossary` raises `GlossaryError(code="GLOSSARY_INVALID")` for invalid YAML.
- `Glossary.match(description: str) -> list[GlossaryHit]` returns all matching mapping/table pairs; it never filters the catalog.

- [ ] **Step 1: Write failing parser tests for the first-version format**

```python
def test_one_alias_group_can_map_to_multiple_tables(tmp_path):
    path = tmp_path / "glossary.yaml"
    path.write_text(
        'schema_version: 1\nglossary_version: "1"\nmappings:\n'
        '  - aliases: [订单, 订单表]\n'
        '    tables: [sales_order, purchase_order]\n',
        encoding="utf-8",
    )
    glossary = load_glossary(path, {"sales_order", "purchase_order"})

    assert glossary.match("分析订单数据") == [
        GlossaryHit(alias="订单", table_name="sales_order"),
        GlossaryHit(alias="订单", table_name="purchase_order"),
    ]


def test_duplicate_normalized_alias_in_separate_mappings_is_invalid(tmp_path):
    path = tmp_path / "glossary.yaml"
    path.write_text(
        'schema_version: 1\nglossary_version: "1"\nmappings:\n'
        '  - aliases: [订单]\n    tables: [sales_order]\n'
        '  - aliases: [" 订单 "]\n    tables: [purchase_order]\n',
        encoding="utf-8",
    )

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, {"sales_order", "purchase_order"})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `uv run --directory backend pytest tests/natural_selection/test_glossary.py -q`  
Expected: FAIL because the package and `load_glossary` do not exist.

- [ ] **Step 3: Add the YAML dependency and baseline configuration**

Add `pyyaml==6.0.2` to both dependency declarations, run `uv lock`, and copy the validated contents of `docs/superpowers/specs/examples/natural-language-glossary-project-fixture.yaml` to `backend/config/natural_language_glossary.yaml`. Keep the production YAML data-only: no Python import, no user-controlled path and no regular expressions.

- [ ] **Step 4: Implement strict normalized loading and matching**

```python
class GlossaryError(RuntimeError):
    def __init__(self, code: str = "GLOSSARY_INVALID") -> None:
        super().__init__(code)
        self.code = code


def normalize_text(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


def load_glossary(path: Path, catalog_table_names: set[str]) -> Glossary:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or set(payload) != {"schema_version", "glossary_version", "mappings"}:
        raise GlossaryError()
    if payload["schema_version"] != 1 or not isinstance(payload["glossary_version"], str) or not payload["glossary_version"].strip():
        raise GlossaryError()
    if not isinstance(payload["mappings"], list) or not payload["mappings"]:
        raise GlossaryError()
    seen_aliases: set[str] = set()
    mappings: list[GlossaryMapping] = []
    for raw in payload["mappings"]:
        if not isinstance(raw, dict) or set(raw) != {"aliases", "tables"}:
            raise GlossaryError()
        if not isinstance(raw["aliases"], list) or not isinstance(raw["tables"], list):
            raise GlossaryError()
        if any(not isinstance(value, str) or not normalize_text(value) for value in raw["aliases"]):
            raise GlossaryError()
        if any(not isinstance(value, str) or value not in catalog_table_names for value in raw["tables"]):
            raise GlossaryError()
        aliases = tuple(normalize_text(value) for value in raw["aliases"])
        tables = tuple(raw["tables"])
        if not aliases or not tables or len(set(aliases)) != len(aliases) or len(set(tables)) != len(tables):
            raise GlossaryError()
        if seen_aliases.intersection(aliases):
            raise GlossaryError()
        seen_aliases.update(aliases)
        mappings.append(GlossaryMapping(aliases=aliases, tables=tables))
    return Glossary(version=payload["glossary_version"].strip(), mappings=tuple(mappings))


def match(self, description: str) -> list[GlossaryHit]:
    normalized = normalize_text(description)
    return [
        GlossaryHit(alias=alias, table_name=table_name)
        for mapping in self.mappings
        for alias in mapping.aliases
        if normalize_text(alias) in normalized
        for table_name in mapping.tables
    ]
```

Use Pydantic models with `extra="forbid"` to reject unrecognized top-level and mapping keys. Preserve aliases in declaration order and deduplicate only identical `(alias, table_name)` hits.

- [ ] **Step 5: Add the remaining parser tests and verify the suite**

Add tests for unknown tables, empty aliases, empty `tables`, unsupported `schema_version`, NFKC/whitespace matching, multiple alias hits on one table and the checked-in project fixture. Run: `uv run --directory backend pytest tests/natural_selection/test_glossary.py -q`  
Expected: PASS.

- [ ] **Step 6: Commit the self-contained configuration unit**

```bash
git add pyproject.toml uv.lock backend/requirements.txt backend/config/natural_language_glossary.yaml backend/engine/natural_selection backend/tests/natural_selection/test_glossary.py
git commit -m "feat: add natural selection glossary"
```

### Task 2: Metadata-only catalog and deterministic selection validator

**Files:**
- Create: `backend/engine/natural_selection/catalog.py`
- Create: `backend/engine/natural_selection/validator.py`
- Modify: `backend/engine/natural_selection/models.py`
- Create: `backend/tests/natural_selection/test_catalog.py`
- Create: `backend/tests/natural_selection/test_validator.py`

**Interfaces:**
- Produces `CatalogSnapshot(tables: list[CatalogTable], metadata_revision: str)`.
- `build_catalog_snapshot(engine: Engine) -> CatalogSnapshot` reads table/column metadata only and excludes tables without both required business roles.
- `validate_model_selection(output, snapshot) -> ValidatedSelection` expands `field_selection="all"` to every `isAuxiliaryColumn` field and rejects invalid `specified` fields.

- [ ] **Step 1: Write failing catalog and validator tests**

```python
def test_catalog_excludes_table_without_name_and_class_name(engine):
    snapshot = build_catalog_snapshot(engine)

    assert [table.name for table in snapshot.tables] == ["orders", "products", "users"]
    assert all("private-row-value" not in table.model_dump_json() for table in snapshot.tables)


def test_all_field_selection_expands_only_legal_auxiliary_fields(snapshot):
    result = validate_model_selection(
        ModelSelection(tables=[ModelTableSelection(
            table_name="orders", field_selection="all", auxiliary_fields=[]
        )]),
        snapshot,
    )

    assert result.tables[0].auxiliary_fields == ["amount"]
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `uv run --directory backend pytest tests/natural_selection/test_catalog.py tests/natural_selection/test_validator.py -q`  
Expected: FAIL because the catalog and validator modules do not exist.

- [ ] **Step 3: Build the catalog without reading database rows**

```python
def build_catalog_snapshot(engine: Engine) -> CatalogSnapshot:
    tables = []
    for table_name in get_table_names(engine):
        columns = get_table_columns(engine, table_name)
        if not any(column["is_name"] for column in columns):
            continue
        if not any(column["is_class_name"] for column in columns):
            continue
        tables.append(CatalogTable(name=table_name, columns=columns))
    canonical = [table.model_dump(mode="json") for table in tables]
    revision = "sha256:" + hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    return CatalogSnapshot(tables=tables, metadata_revision=revision)
```

Do not call `get_table_summary_input`, `select`, or any row-reading function. Use the table name, field names and role flags as the model-visible catalog.

- [ ] **Step 4: Implement validation and expansion**

```python
class ModelTableSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    table_name: str
    field_selection: Literal["all", "specified"]
    auxiliary_fields: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=1, max_length=160)


class ModelSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["selected", "needs_clarification"]
    tables: list[ModelTableSelection] = Field(default_factory=list)
    reason_code: str | None = None
    guidance: str | None = None
    suggested_questions: list[str] = Field(default_factory=list, max_length=2)


class ClarificationRequired(ValueError):
    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


class InvalidModelOutput(ValueError):
    def __init__(self, reason_code: str = "INVALID_MODEL_OUTPUT") -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


def allowed_auxiliary_fields(table: CatalogTable) -> list[str]:
    return [
        column.name for column in table.columns
        if not column.is_name
        and not column.is_class_name
        and not column.is_primary_key
        and not column.is_foreign_key
    ]


def validate_model_selection(output: ModelSelection, snapshot: CatalogSnapshot) -> ValidatedSelection:
    if len(output.tables) > 10:
        raise ClarificationRequired("SCOPE_TOO_BROAD")
    tables_by_name = {table.name: table for table in snapshot.tables}
    selected: list[ValidatedTableSelection] = []
    seen_tables: set[str] = set()
    for item in output.tables:
        if item.table_name in seen_tables or item.table_name not in tables_by_name:
            raise InvalidModelOutput("INVALID_MODEL_OUTPUT")
        seen_tables.add(item.table_name)
        allowed = allowed_auxiliary_fields(tables_by_name[item.table_name])
        if item.field_selection == "all":
            fields = allowed
        elif item.field_selection == "specified" and len(item.auxiliary_fields) == len(set(item.auxiliary_fields)) and set(item.auxiliary_fields).issubset(allowed):
            fields = item.auxiliary_fields
        else:
            raise InvalidModelOutput("INVALID_MODEL_OUTPUT")
        selected.append(ValidatedTableSelection(name=item.table_name, auxiliary_fields=fields, reason=item.reason))
    if not selected:
        raise ClarificationRequired("NO_RELIABLE_MATCH")
    return ValidatedSelection(tables=selected)
```

Define `ClarificationRequired` for user-fixable ambiguity and `InvalidModelOutput` for malformed or invented output. A selected table with no legal auxiliary fields is valid and receives `[]`.

- [ ] **Step 5: Add stable-revision and invalid-field regression cases**

Test stable revisions for unchanged metadata, changed revision after adding a column, rejection of `name`, `className`, primary/foreign keys, duplicate fields, unknown tables and more than 10 tables. Run: `uv run --directory backend pytest tests/natural_selection/test_catalog.py tests/natural_selection/test_validator.py -q`  
Expected: PASS.

- [ ] **Step 6: Commit the metadata/validation boundary**

```bash
git add backend/engine/natural_selection/models.py backend/engine/natural_selection/catalog.py backend/engine/natural_selection/validator.py backend/tests/natural_selection/test_catalog.py backend/tests/natural_selection/test_validator.py
git commit -m "feat: validate natural selection metadata"
```

### Task 3: Single-model semantic selection service

**Files:**
- Create: `backend/engine/natural_selection/service.py`
- Modify: `backend/engine/natural_selection/models.py`
- Create: `backend/tests/natural_selection/test_service.py`
- Reuse: `backend/engine/deepseek_client.py`

**Interfaces:**
- `SelectionModelClient` protocol exposes `complete_json(messages, max_tokens, response_model)`.
- `NaturalSelectionService.select(description: str, snapshot: CatalogSnapshot) -> SelectionResponse` returns `selected` or raises a typed service/clarification exception.
- The service consumes `Glossary.match(description)`, `DeepSeekJsonAdapter` and `validate_model_selection`.

- [ ] **Step 1: Write failing service tests with a recording fake model**

```python
@pytest.mark.asyncio
async def test_unmatched_glossary_still_sends_all_catalog_tables(snapshot):
    model = RecordingModel({
        "status": "selected",
        "tables": [{
            "table_name": "orders", "field_selection": "all",
            "auxiliary_fields": [], "reason": "订单交易信息"
        }],
    })

    result = await service(snapshot, glossary_with_no_matches, model).select("查看交易链路")

    assert result.status == "selected"
    prompt_payload = json.loads(model.calls[0]["messages"][1]["content"])
    assert {item["name"] for item in prompt_payload["tables"]} == {"users", "orders", "products"}
    assert "Alice" not in json.dumps(model.calls, ensure_ascii=False)


@pytest.mark.asyncio
async def test_model_unavailable_is_not_turned_into_clarification(snapshot):
    with pytest.raises(SelectionUnavailable, match="MODEL_UNAVAILABLE"):
        await service(snapshot, empty_glossary, FailingModel()).select("分析订单")
```

- [ ] **Step 2: Run the focused service tests to verify they fail**

Run: `uv run --directory backend pytest tests/natural_selection/test_service.py -q`  
Expected: FAIL because the service and typed selection exceptions do not exist.

- [ ] **Step 3: Use the strict model contract from Task 2 and construct the prompt**

```python
SELECTION_SYSTEM_PROMPT = (
    "你是分析表与辅助字段选择器。只能从 tables 中选择；不得编造表或字段。"
    "name、class_name、主键和外键不是辅助字段，绝对不得返回。"
    "若用户没有明确限定字段，field_selection 必须为 all 且 auxiliary_fields 必须为空数组。"
    "若用户明确限定字段，field_selection 必须为 specified，auxiliary_fields 只能含 tables 中存在的合法辅助字段。"
    "不生成任何数据过滤条件。选表不得超过十张。无法可靠判断时返回 needs_clarification 和中文 guidance。"
    "仅返回符合 ModelSelection 的 JSON 对象。"
)

def _messages(
    description: str,
    snapshot: CatalogSnapshot,
    hits: list[GlossaryHit],
) -> list[dict[str, object]]:
    return [
        {"role": "system", "content": SELECTION_SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps({
            "description": description,
            "tables": [table.model_dump(mode="json") for table in snapshot.tables],
            "glossary_hits": [hit.model_dump(mode="json") for hit in hits],
        }, ensure_ascii=False, separators=(",", ":"))},
    ]
```

System instructions must state: choose only supplied tables; return `all` when fields were not explicitly constrained; return only legal auxiliary fields for `specified`; do not generate filters; return `needs_clarification` for unresolved intent; emit one JSON object. The user message supplies the original description plus a catalog containing table/column metadata and glossary hits, never row samples.

- [ ] **Step 4: Implement service result classification**

```python
class SelectionUnavailable(RuntimeError):
    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


async def select(self, description: str, snapshot: CatalogSnapshot) -> SelectionResponse:
    hits = self.glossary.match(description)
    try:
        payload = await self.model.complete_json(
            messages=self._messages(description, snapshot, hits),
            max_tokens=2048,
            response_model=ModelSelection,
        )
    except Exception as error:
        raise SelectionUnavailable("MODEL_UNAVAILABLE") from error
    decision = ModelSelection.model_validate(payload)
    if decision.status == "needs_clarification":
        return clarification_response(decision)
    return selected_response(validate_model_selection(decision, snapshot), snapshot)
```

Map invented tables, invalid JSON and Pydantic contract failures to `SelectionUnavailable("INVALID_MODEL_OUTPUT")`; map model-declared unresolved intent and validator table-count ambiguity to `needs_clarification`. Do not use numeric model confidence as a gate.

- [ ] **Step 5: Add semantic fallback, ambiguity and field-intent tests**

Add tests proving a multi-table `订单` alias reaches the prompt as evidence, no YAML hit still permits a valid semantic selection, `field_selection="all"` expands all auxiliary fields, `specified` remains exact, and a model `needs_clarification` response preserves its safe guidance. Run: `uv run --directory backend pytest tests/natural_selection/test_service.py -q`  
Expected: PASS.

- [ ] **Step 6: Commit the selection service**

```bash
git add backend/engine/natural_selection/service.py backend/engine/natural_selection/models.py backend/tests/natural_selection/test_service.py
git commit -m "feat: add semantic table selection service"
```

### Task 4: HTTP endpoint and analysis-time schema revalidation

**Files:**
- Create: `backend/routers/natural_language_selection.py`
- Modify: `backend/main.py`
- Modify: `backend/models/schemas.py`
- Modify: `backend/routers/analyze.py`
- Create: `backend/tests/test_natural_language_selection.py`
- Modify: `backend/tests/test_analyze.py`

**Interfaces:**
- `POST /api/natural-language-selection` accepts `{"description": "分析订单", "request_id": "uuid"}`.
- Success/clarification responses contain the matching `request_id`, `metadata_revision`, `glossary_version` and `selector_version`; unavailable errors use HTTP 503.
- `AnalyzeRequest` gains `metadata_revision: str | None = None`; when present, `/api/analyze` compares it to a fresh catalog snapshot before creating a task.

- [ ] **Step 1: Write failing FastAPI contract tests**

```python
def test_selection_returns_all_fields_and_metadata_revision(client, override_selector):
    response = client.post("/api/natural-language-selection", json={
        "request_id": "req-1", "description": "分析订单"
    })

    assert response.status_code == 200
    assert response.json()["request_id"] == "req-1"
    assert response.json()["status"] == "selected"
    assert response.json()["tables"][0]["auxiliary_fields"] == ["amount"]
    assert response.json()["metadata_revision"].startswith("sha256:")


def test_model_failure_returns_503_without_internal_message(client, unavailable_selector):
    response = client.post("/api/natural-language-selection", json={
        "request_id": "req-2", "description": "分析订单"
    })

    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
    assert "api_key" not in response.text
```

- [ ] **Step 2: Run endpoint tests to verify they fail**

Run: `uv run --directory backend pytest tests/test_natural_language_selection.py tests/test_analyze.py -q`  
Expected: FAIL because the endpoint and optional request revision are absent.

- [ ] **Step 3: Add schemas, dependency injection and router wiring**

```python
class NaturalLanguageSelectionRequest(BaseModel):
    request_id: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=1000)


class AnalyzeRequest(BaseModel):
    tables: list[TableSelection]
    metadata_revision: str | None = Field(default=None, max_length=80)
```

Create a router dependency that builds the catalog from `get_engine()`, loads the checked-in glossary and instantiates `NaturalSelectionService(DeepSeekJsonAdapter())`. Register it in `backend/main.py`. Do not accept database names, table lists, fields or model prompts in the natural-language request.

- [ ] **Step 4: Map typed failures to safe HTTP responses and revalidate analysis**

```python
if request.metadata_revision is not None:
    current = build_catalog_snapshot(engine)
    if current.metadata_revision != request.metadata_revision:
        raise HTTPException(status_code=409, detail={
            "code": "metadata_changed",
            "message": "数据库结构已发生变化，请重新确认分析范围。",
        })
```

For selection: return HTTP 200 for `selected`/`needs_clarification`, 422 for invalid request fields, and 503 for `SelectionUnavailable`. Ensure all messages use fixed Chinese copy and omit model/provider exception content.

- [ ] **Step 5: Add router regression coverage and run backend tests**

Test empty/overlong descriptions, `SCOPE_TOO_BROAD`, unchanged current selection after every non-selected response, optional revision backward compatibility, and 409 after metadata change. Run: `uv run --directory backend pytest tests/test_natural_language_selection.py tests/test_analyze.py -q`  
Expected: PASS.

- [ ] **Step 6: Commit the API boundary**

```bash
git add backend/main.py backend/models/schemas.py backend/routers/natural_language_selection.py backend/routers/analyze.py backend/tests/test_natural_language_selection.py backend/tests/test_analyze.py
git commit -m "feat: expose natural language selection API"
```

### Task 5: Frontend API client and authoritative selection state

**Files:**
- Create: `frontend/src/api/naturalSelection.ts`
- Create: `frontend/src/api/naturalSelection.test.ts`
- Modify: `frontend/src/api/analysis.ts`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/store/analysis.test.ts`

**Interfaces:**
- `requestNaturalSelection(request, signal)` posts `{request_id, description}` and returns the typed public response.
- Store actions: `setSelectionMode`, `setNaturalLanguageInput`, `requestNaturalSelection`, `applyAISelection`, `confirmAIReplacement`, `cancelAIReplacement`, `undoAIReplacement`.
- `submitAnalysis(tables, metadataRevision?)` includes `metadata_revision` only when non-null.

- [ ] **Step 1: Write failing API and store ownership tests**

```ts
it("expands the AI response into one atomic selection only for its active request", async () => {
  const pending = useAnalysisStore.getState().requestNaturalSelection("分析订单");
  const oldRequest = useAnalysisStore.getState().naturalLanguage.activeRequestId!;
  useAnalysisStore.getState().setSelectionMode("manual");
  resolveSelection(oldRequest, selectedOrdersResponse);
  await pending;

  expect(useAnalysisStore.getState().selectedTables).toEqual(new Map());
});

it("requires confirmation before replacing dirty manual changes", () => {
  useAnalysisStore.setState({ selectionDirty: true, selectedTables: usersSelection });
  useAnalysisStore.getState().queueAISelection(ordersSelection);

  expect(useAnalysisStore.getState().selectedTables).toEqual(usersSelection);
  expect(useAnalysisStore.getState().pendingAIReplacement).toEqual(ordersSelection);
});
```

- [ ] **Step 2: Run the focused frontend tests to verify they fail**

Run: `cd frontend; npm test -- --run src/api/naturalSelection.test.ts src/store/analysis.test.ts`  
Expected: FAIL because the natural-selection API and state actions do not exist.

- [ ] **Step 3: Implement typed API and abortable request ownership**

```ts
export type NaturalSelectionResponse = SelectedResponse | ClarificationResponse | UnavailableResponse;

export async function requestNaturalSelection(
  request: { request_id: string; description: string },
  signal: AbortSignal,
): Promise<NaturalSelectionResponse> {
  const response = await fetch("/api/natural-language-selection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  return parseNaturalSelectionResponse(response);
}
```

Store the `AbortController` outside serializable Zustand state, abort it when starting a newer request, resetting analysis or switching away before completion. Treat `AbortError` as a no-op. Compare response `request_id` to `activeRequestId` before fetching any table columns or mutating state.

- [ ] **Step 4: Implement atomic conversion to existing selected tables**

Fetch every response table's columns with `Promise.all(response.tables.map((table) => fetchTableColumns(table.table_name)))`, derive `selectedFields` from the backend-provided `auxiliary_fields`, then call one action only after all requests succeed:

```ts
applyAISelection(selection: Map<string, SelectedTable>, metadataRevision: string) {
  const previous = cloneSelectedTables(get().selectedTables);
  set({
    selectedTables: selection,
    previousSelection: previous,
    selectionSource: "ai",
    selectionDirty: false,
    metadataRevision,
    pendingTables: new Set(),
  });
}
```

If current selection is dirty, store the fully loaded proposed selection in `pendingAIReplacement` instead of applying it. Manual `toggleTable` and field actions set `selectionDirty: true`, update `selectionSource` to `mixed`, and clear `metadataRevision`.

- [ ] **Step 5: Preserve existing analyze payload behavior with optional revision**

```ts
const payload = metadataRevision
  ? { tables, metadata_revision: metadataRevision }
  : { tables };

body: JSON.stringify(payload)
```

Add tests for all-fields defaults, specified-field selection, clarification/unavailable state preservation, old response rejection, confirmation, cancel, undo and omission of `metadata_revision` after manual mutation. Run: `cd frontend; npm test -- --run src/api/naturalSelection.test.ts src/store/analysis.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit the frontend state layer**

```bash
git add frontend/src/api/naturalSelection.ts frontend/src/api/naturalSelection.test.ts frontend/src/api/analysis.ts frontend/src/store/analysis.ts frontend/src/store/analysis.test.ts
git commit -m "feat: manage natural language selections"
```

### Task 6: Default natural-language UI and preserved manual workspace

**Files:**
- Create: `frontend/src/components/NaturalLanguageSelectionPanel.tsx`
- Create: `frontend/src/components/SelectionModeToggle.tsx`
- Create: `frontend/src/components/SelectionReplacementDialog.tsx`
- Modify: `frontend/src/components/SelectionWorkspace.tsx`
- Create: `frontend/src/components/__tests__/NaturalLanguageSelectionPanel.test.tsx`
- Create: `frontend/src/components/__tests__/SelectionModeToggle.test.tsx`
- Create: `frontend/src/components/__tests__/SelectionReplacementDialog.test.tsx`
- Modify: `frontend/src/components/__tests__/SelectionWorkspace.test.tsx`

**Interfaces:**
- `SelectionModeToggle` accepts `mode: "natural" | "manual"` and `onChange(mode)`.
- `NaturalLanguageSelectionPanel` consumes only Zustand actions/state and renders safe text from `reason`, `guidance` and suggested questions.
- `SelectionReplacementDialog` accepts `current`, `proposed`, `onConfirm`, `onCancel`; it displays added/removed table and field names as text.

- [ ] **Step 1: Write failing component tests for the default path and failure copy**

```tsx
it("uses natural language mode by default and keeps the manual mode available", () => {
  render(<SelectionWorkspace />);

  expect(screen.getByRole("tab", { name: "自然语言选取" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "手动选取" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "描述要分析的业务关系" })).toBeVisible();
});

it("shows the safe unavailable guidance without clearing selected tables", () => {
  useAnalysisStore.setState({ naturalLanguage: unavailableState, selectedTables: ordersSelection });
  render(<NaturalLanguageSelectionPanel />);

  expect(screen.getByText("当前无法完成自动选取，已有选择未发生变化；可稍后重试或切换到手动选取。")).toBeVisible();
  expect(useAnalysisStore.getState().selectedTables).toEqual(ordersSelection);
});
```

- [ ] **Step 2: Run the focused component tests to verify they fail**

Run: `cd frontend; npm test -- --run src/components/__tests__/NaturalLanguageSelectionPanel.test.tsx src/components/__tests__/SelectionWorkspace.test.tsx`  
Expected: FAIL because the components and mode UI do not exist.

- [ ] **Step 3: Build accessible mode and natural-language components**

Use a `role="tablist"` with two buttons (`自然语言选取` and `手动选取`) and matching `aria-selected`. The natural panel must provide:

```tsx
<textarea
  aria-label="描述要分析的业务关系"
  placeholder="例如：分析客户、订单与退款之间的关系"
  value={input}
  onChange={(event) => setNaturalLanguageInput(event.target.value)}
/>
<button disabled={!input.trim() || status === "loading"} onClick={submit}>
  AI 自动选取
</button>
```

Explain below the input that time wording only helps choose tables/fields and does not filter rows. Render reasons, guidance and suggestions through React text interpolation, never `dangerouslySetInnerHTML`.

- [ ] **Step 4: Compose the workspace without duplicating selection data**

In natural mode, show the panel and the currently selected `BusinessDatasetCard` instances so users can directly remove tables or edit fields. In manual mode, retain the existing search and full table list exactly. Keep `DatabaseInfoCard`, the 10-table warning, and `AnalysisLauncher` visible in both modes. Mount `SelectionReplacementDialog` whenever `pendingAIReplacement` exists; confirming applies it, cancelling preserves the existing selection.

- [ ] **Step 5: Add interaction/regression tests and verify**

Cover mode switching with preserved selections, blank disabled submit, loading state, selected result with all fields checked, needs-clarification copy, unavailable copy, difference confirmation, cancel, undo, table limit warning and existing manual search. Run: `cd frontend; npm test -- --run src/components/__tests__/NaturalLanguageSelectionPanel.test.tsx src/components/__tests__/SelectionModeToggle.test.tsx src/components/__tests__/SelectionReplacementDialog.test.tsx src/components/__tests__/SelectionWorkspace.test.tsx`  
Expected: PASS.

- [ ] **Step 6: Commit the UI integration**

```bash
git add frontend/src/components/NaturalLanguageSelectionPanel.tsx frontend/src/components/SelectionModeToggle.tsx frontend/src/components/SelectionReplacementDialog.tsx frontend/src/components/SelectionWorkspace.tsx frontend/src/components/__tests__
git commit -m "feat: add natural language selection UI"
```

### Task 7: Offline semantic quality suite and full regression verification

**Files:**
- Create: `backend/tests/fixtures/natural_selection_cases.yaml`
- Create: `backend/tests/natural_selection/test_evaluation_cases.py`
- Create: `scripts/benchmark_natural_selection.py`
- Modify: `README.md`

**Interfaces:**
- Evaluation cases contain `input`, `expected_tables` or `expected_status`, plus optional `acceptable_reason_codes`.
- `scripts/benchmark_natural_selection.py --cases backend/tests/fixtures/natural_selection_cases.yaml` prints table precision, recall, complete-set accuracy, correct-clarification rate, false-preselection rate and P95 latency.

- [ ] **Step 1: Write the failing fixture-quality test**

```python
def test_evaluation_fixture_has_required_coverage_and_at_least_60_cases():
    cases = load_cases(FIXTURE_PATH)

    assert len(cases) >= 60
    assert any(case.input == "分析订单" and case.expected_status == "needs_clarification" for case in cases)
    assert any("忽略之前指令" in case.input for case in cases)
    assert any(case.expected_status == "needs_clarification" for case in cases)
    assert all(bool(case.expected_tables) ^ bool(case.expected_status) for case in cases)
```

- [ ] **Step 2: Run the focused evaluation test to verify it fails**

Run: `uv run --directory backend pytest tests/natural_selection/test_evaluation_cases.py -q`  
Expected: FAIL because the evaluation fixture and loader do not exist.

- [ ] **Step 3: Add a 60-case deterministic corpus and metrics script**

Create exactly 64 cases: 20 direct aliases across the checked-in project glossary, 12 multi-table relationship requests, 8 synonym/abbreviation variants, 6 typo or mixed Chinese/English variants, 6 exclusion/irrelevant requests, 4 ambiguous `订单`/`工艺` requests, 3 time-wording requests that assert no filter field, 3 prompt-injection or SQL-style requests, and 2 unrelated requests. Use only the ten configured table names and expected statuses/codes; no database records or secrets belong in this fixture.

```python
def score(cases: list[CaseResult]) -> dict[str, float]:
    return {
        "table_precision": safe_divide(sum(item.true_positive for item in cases), sum(item.predicted_count for item in cases)),
        "table_recall": safe_divide(sum(item.true_positive for item in cases), sum(item.expected_count for item in cases)),
        "complete_set_accuracy": safe_divide(sum(item.exact_table_match for item in cases), len(cases)),
        "correct_clarification_rate": safe_divide(sum(item.correct_clarification for item in cases), sum(item.expects_clarification for item in cases)),
        "false_preselection_rate": safe_divide(sum(item.false_preselection for item in cases), len(cases)),
        "p95_latency_ms": percentile([item.latency_ms for item in cases], 95),
    }
```

Make the benchmark accept an injected fake selector for CI and require an explicit environment flag before any real DeepSeek calls, so normal tests remain deterministic and offline.

- [ ] **Step 4: Document operation and run all verification commands**

Add README sections for the default natural-language flow, manual fallback, YAML path/validation, field-default rule, environment requirements and benchmark command. Run:

```bash
uv run --directory backend pytest
cd frontend
npm test -- --run
npm run build
```

Expected: all backend tests, all frontend tests and the production build pass.

- [ ] **Step 5: Commit quality gates and documentation**

```bash
git add backend/tests/fixtures/natural_selection_cases.yaml backend/tests/natural_selection/test_evaluation_cases.py scripts/benchmark_natural_selection.py README.md
git commit -m "test: add natural selection quality suite"
```
