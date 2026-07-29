# Authoritative Semantic Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reliably generate a complete process-operation-step-material graph by merging authoritative database relation tables with LLM semantic inference and render it as a clear, performant network.

**Architecture:** A new structural-relation boundary discovers supported generic relation tables, resolves their class/id endpoints to selected entity documents, and emits deduplicated strong edges before semantic planning. The analyzer always assembles available nodes and strong edges on timeout. The frontend projects connected entities by default and uses a deterministic clustered network layout with table colors, typed edges, labels, filters, and an isolated-node toggle.

**Tech Stack:** Python 3.12, SQLAlchemy 2, FastAPI, Pydantic 2, pytest, React 19, TypeScript, Zustand, Canvas 2D, Web Worker, Vitest.

## Global Constraints

- `class_name` remains optional in the user's field selection.
- Only table-to-table and entity-to-entity relationships are displayed.
- Database relation records are strong evidence; LLM semantic decisions are supplemental weak evidence.
- No final local similarity score is accepted as a relationship without LLM judgement.
- Large graphs must not create one DOM element per node.
- Existing table search behavior must remain available.
- Preserve the user-owned `.gitignore` change.

---

### Task 1: Resolve authoritative generic relation tables

**Files:**
- Create: `backend/engine/semantic/structural_relations.py`
- Modify: `backend/engine/semantic/models.py`
- Test: `backend/tests/semantic/test_structural_relations.py`

**Interfaces:**
- Consumes: `Engine`, selected `records`, `SchemaAnalysisResult`, and `EntityDocument` objects.
- Produces: `build_relation_table_edges(engine, records, schema_result, documents, check_deadline=None) -> list[EntityEdge]`.

- [ ] **Step 1: Write the failing duplicate-resolution test**

Create an SQLite relation source containing duplicate `MEProcess → MEOperation`
rows and assert that `build_relation_table_edges` returns exactly one strong
`包含工序` edge whose evidence method is `relation_table`.

- [ ] **Step 2: Run the focused test and verify red**

Run:
`uv run --directory backend pytest backend/tests/semantic/test_structural_relations.py -q`

Expected: collection/import failure because `structural_relations` and
`relation_table` evidence do not exist.

- [ ] **Step 3: Implement relation-source discovery and endpoint resolution**

Recognize existing `bom_temp_view_data`, `metargetrl`, and `relation_id` only
when they expose `left_id`, `right_id`, `left_class`, and `right_class`.
Build endpoint indexes from selected records and primary keys, issue a
parameterized cross-class query, and merge evidence by canonical entity pair.

- [ ] **Step 4: Run focused tests and verify green**

Run:
`uv run --directory backend pytest backend/tests/semantic/test_structural_relations.py -q`

Expected: all tests pass.

- [ ] **Step 5: Commit**

Stage only the new backend module, model change, and focused test, then commit
as `feat: resolve authoritative relation tables`.

### Task 2: Preserve useful graphs across semantic timeouts

**Files:**
- Modify: `backend/engine/semantic/analyzer.py`
- Modify: `backend/tests/semantic/test_analyzer.py`
- Test: `backend/tests/semantic/test_end_to_end.py`

**Interfaces:**
- Consumes: `build_relation_table_edges` from Task 1.
- Produces: `AnalysisResult` that contains all loaded nodes and all available
  strong edges even when semantic processing is partial.

- [ ] **Step 1: Write failing analyzer integration tests**

Add a relation table to the SQLite fixture and assert:

- an empty semantic plan still returns its strong relationship;
- a deadline reached after structural discovery returns `partial` with nodes
  and the strong edge instead of the empty partial payload;
- `class_name` need not be selected as a dimension.

- [ ] **Step 2: Run focused tests and verify red**

Run:
`uv run --directory backend pytest backend/tests/semantic/test_analyzer.py backend/tests/semantic/test_end_to_end.py -q`

Expected: the new assertions fail because the analyzer does not call the
structural resolver and discards nodes at the deadline.

- [ ] **Step 3: Integrate strong-edge discovery before semantic planning**

Build FK and relation-table edges immediately after entity documents. Append
plan-dependent unique identifier edges later. Skip semantic candidate pairs
already supported by strong evidence where the retrieval boundary permits it.

- [ ] **Step 4: Add one available-result finalizer**

Replace post-document empty timeout returns with a finalizer that calls
`build_graph` without a deadline check, computes diagnostics, preserves safe
warnings, and returns `partial` or `failed` according to available trustworthy
output.

- [ ] **Step 5: Run focused and full backend tests**

Run:

`uv run --directory backend pytest backend/tests/semantic -q`

`uv run --directory backend pytest -q`

Expected: all backend tests pass with no warning/error output.

- [ ] **Step 6: Commit**

Stage only analyzer and analyzer tests, then commit as
`fix: preserve structural graph on semantic timeout`.

### Task 3: Project connected entities and expose isolated-node control

**Files:**
- Create: `frontend/src/graph/projection.ts`
- Create: `frontend/src/graph/projection.test.ts`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/store/analysis.test.ts`
- Modify: `frontend/src/components/GraphToolbar.tsx`
- Modify: `frontend/src/components/__tests__/GraphToolbar.test.tsx`

**Interfaces:**
- Produces: `projectGraph(graph, showIsolatedNodes) -> SemanticGraphData` and
  store state `showIsolatedNodes`, `setShowIsolatedNodes(boolean)`.
- Consumers: GraphCanvas and toolbar.

- [ ] **Step 1: Write failing projection tests**

Use a literal graph with one connected and one isolated entity. Assert the
default projection keeps table nodes, connected endpoints and edges, removes
the isolated entity, and reports the hidden count; assert the enabled
projection returns all entities.

- [ ] **Step 2: Run focused tests and verify red**

Run:
`npm --prefix frontend test -- --run src/graph/projection.test.ts src/components/__tests__/GraphToolbar.test.tsx`

Expected: failure because projection and isolated-node control are absent.

- [ ] **Step 3: Implement projection and store toggle**

Derive connected IDs from visible entity edges, preserve immutable API data,
and reset the toggle to false for every new analysis. Add a toolbar checkbox
showing the number of hidden isolated entities.

- [ ] **Step 4: Run focused tests and verify green**

Run the command from Step 2 and expect all focused tests to pass.

- [ ] **Step 5: Commit**

Commit as `feat: control isolated graph entities`.

### Task 4: Replace dense table grids with a clustered network

**Files:**
- Modify: `frontend/src/graph/layout.ts`
- Modify: `frontend/src/graph/layout.test.ts`
- Modify: `frontend/src/graph/scene.ts`
- Modify: `frontend/src/graph/scene.test.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx`
- Modify: `frontend/src/components/__tests__/GraphCanvas.test.tsx`

**Interfaces:**
- Consumes: projected graph from Task 3.
- Produces: deterministic table anchors, radial entity clusters, degree-scaled
  entity nodes, relation labels, and strong/weak edge render metadata.

- [ ] **Step 1: Write failing layout and scene tests**

Assert that table anchors are separated, entity nodes orbit their owning
anchor, no table rectangles are emitted, connected high-degree entities are
larger, and visible edge commands carry relation label and line style.

- [ ] **Step 2: Run focused tests and verify red**

Run:
`npm --prefix frontend test -- --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx`

Expected: failures against the rectangular grid and untyped scene commands.

- [ ] **Step 3: Implement deterministic clustered layout**

Order known process classes as `MEProcess`, `MEOperation`, `MEStep`,
`Assembly`, fall back to stable table ID ordering, place anchors across the
available world, and place each table's connected entities on expanding
rings. Keep all layout work in the existing worker.

- [ ] **Step 4: Render semantic graph styling**

Use a stable table palette, scale entity radius by degree, draw strong edges
solid and semantic-only edges dashed, add collision-aware edge labels at
appropriate zoom, and update search/focus to use the projected graph.

- [ ] **Step 5: Run focused and full frontend verification**

Run:

`npm --prefix frontend test -- --run`

`npm --prefix frontend run lint`

`npm --prefix frontend run build`

Expected: all tests pass, lint exits zero, and the production build exits zero.

- [ ] **Step 6: Commit**

Commit as `feat: render clustered semantic network`.

### Task 5: Verify against the real database and browser

**Files:**
- Modify only if a test exposes a defect.

**Interfaces:**
- Exercises: real `.env` database, API analysis endpoint, progress transport,
  browser graph workbench, search, filters, and node interactions.

- [ ] **Step 1: Run real three-table analysis**

Select every user-visible field for `meprocess`, `meoperation`, and `mestep`.
Assert at least 35 unique process-operation and 87 unique operation-step
strong relationships, non-empty table/entity nodes, and no false zero-result
message.

- [ ] **Step 2: Run real four-table analysis**

Add `assembly`; assert material relations are present and duplicate entity
pairs are merged.

- [ ] **Step 3: Verify browser behavior**

Start backend and frontend, load the graph, confirm connected-only default,
isolated-node toggle, search, fit view, relation labels, and responsive
interaction. Capture a screenshot for visual evidence.

- [ ] **Step 4: Run final regression gate**

Run backend full tests, frontend full tests, lint, and build again. Inspect
`git diff --check`, `git status --short`, and confirm the existing table search
tests remain green.

- [ ] **Step 5: Commit final fixes and leave master deliverable**

Stage only task-owned files, preserve `.gitignore`, create the final commit on
`master`, and report exact verification counts and any residual limitations.
