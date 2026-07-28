# Semantic Relationship Graph Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update field selection and render the new table/entity relationship graph without creating thousands of SVG elements or running a global 7000-node force simulation.

**Architecture:** Keep Zustand as the application state seam, replace the graph contract with table/entity nodes and evidence-rich edges, and replace the SVG renderer with one Canvas 2D surface. A pure layout module and Web Worker place at most 10 table groups and arrange entities inside their source-table group; semantic zoom controls whether tables, entity dots, labels, or evidence affordances are drawn.

**Tech Stack:** React 19, TypeScript 6, Zustand 5, D3 zoom utilities, Canvas 2D, Web Workers, Vitest 4, Testing Library.

## Global Constraints

- Fields never become graph nodes.
- Graph edges exist only table-to-table and entity-to-entity.
- `class_name` is not a required semantic dimension; when available it is display metadata after the table name.
- All weak relationships enter the graph immediately and remain filterable by confidence.
- The DOM must not scale linearly with 7000 entities.
- Do not run a global entity force simulation.
- Preserve fit, focus, hover, selection, filtering, details, export, reset, and error states.

---

### Task 1: Frontend graph and progress contracts

**Files:**
- Modify: `frontend/src/api/analysis.ts`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/store/analysis.test.ts`

**Interfaces:**
- Consumes: backend WS contract from backend plan Task 8.
- Produces: `SemanticGraphData`, `AnalysisStatus`, `AnalysisDiagnostics`, and status-aware store state.

- [ ] **Step 1: Write failing contract/store tests**

Test that a final `partial` message stores the graph, warnings, and diagnostics while setting the UI phase to `done`; a `failed` message sets phase `error`; malformed WebSocket JSON calls the error callback instead of being silently ignored.

- [ ] **Step 2: Run store tests**

Run: `npm --prefix frontend test -- --run src/store/analysis.test.ts`

Expected: FAIL because new status fields/types do not exist.

- [ ] **Step 3: Define exact TypeScript types**

Create discriminated types matching backend JSON:

```ts
export type AnalysisStatus = "complete" | "partial" | "failed";
export interface SemanticGraphData {
  table_nodes: TableNodeData[];
  entity_nodes: EntityNodeData[];
  table_edges: TableEdgeData[];
  entity_edges: EntityEdgeData[];
}
```

Add `analysisStatus`, `warnings`, `diagnostics`, `selectedEntityEdgeId`, and `selectedTableEdgeId` to Zustand, with mutually exclusive `selectEntityEdge(id)` and `selectTableEdge(id)` actions. Treat `partial` as a usable graph with warnings. Route malformed socket payloads through `onError`.

- [ ] **Step 4: Run store tests**

Run: `npm --prefix frontend test -- --run src/store/analysis.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/api/analysis.ts frontend/src/store/analysis.ts frontend/src/store/analysis.test.ts
git commit -m "feat: consume semantic graph contract"
```

---

### Task 2: Optional class metadata and semantic dimension selection

**Files:**
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/components/DatabaseTableAccordion.tsx`
- Modify: `frontend/src/components/SelectionWorkspace.tsx`
- Modify: `frontend/src/store/analysis.test.ts`
- Modify: `frontend/src/components/__tests__/DatabaseTableAccordion.test.tsx`
- Modify: `frontend/src/components/__tests__/SelectionWorkspace.test.tsx`

**Interfaces:**
- Consumes: existing `ColumnInfo`.
- Produces: selected fields containing only user semantic dimensions.

- [ ] **Step 1: Replace the old required-column tests**

Assert:

```ts
expect(isSystemColumn(primaryKeyColumn)).toBe(true);
expect(isSystemColumn(classNameColumn)).toBe(true);
expect(useAnalysisStore.getState().selectedTables.get("users")?.selectedFields)
  .toEqual(new Set());
```

Verify normal dimensions can be selected/deselected, PK shows “自动用于实体ID”, class shows “用于节点展示”, and neither is sent in `fields`.

- [ ] **Step 2: Run selection tests and observe the old behavior**

Run: `npm --prefix frontend test -- --run src/store/analysis.test.ts src/components/__tests__/DatabaseTableAccordion.test.tsx src/components/__tests__/SelectionWorkspace.test.tsx`

Expected: FAIL because PK/class are currently forced into `selectedFields`.

- [ ] **Step 3: Separate system columns from dimensions**

Implement:

```ts
export function isSystemColumn(column: ColumnInfo): boolean {
  return column.is_primary_key || column.is_class_name;
}
```

Initialize `selectedFields` empty, exclude system columns from select-all, omit their checkboxes or render them disabled and unchecked, and remove the copy “主键与类名字段会始终保留.” Keep backend auto-loading responsible for both fields.

- [ ] **Step 4: Run selection tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/store/analysis.ts frontend/src/components/DatabaseTableAccordion.tsx frontend/src/components/SelectionWorkspace.tsx frontend/src/store/analysis.test.ts frontend/src/components/__tests__
git commit -m "feat: select semantic dimensions independently"
```

---

### Task 3: Pure grouped layout and Web Worker

**Files:**
- Create: `frontend/src/graph/layout.ts`
- Create: `frontend/src/graph/layout.worker.ts`
- Create: `frontend/src/graph/layoutClient.ts`
- Test: `frontend/src/graph/layout.test.ts`

**Interfaces:**
- Consumes: table/entity nodes and edges.
- Produces: `computeGroupedLayout(graph, viewport) -> GraphLayout` and async `layoutGraph(graph, viewport)`.

- [ ] **Step 1: Write failing deterministic layout tests**

Assert that all entities stay inside their source table's group, no table-entity edge is created, repeated input produces identical coordinates, and 7000 entities produce exactly 10 or fewer table regions.

- [ ] **Step 2: Run layout tests**

Run: `npm --prefix frontend test -- --run src/graph/layout.test.ts`

Expected: FAIL because the layout module is absent.

- [ ] **Step 3: Implement deterministic grouped layout**

Place table regions in a grid derived only from sorted table IDs. Arrange entities in a compact grid or spiral inside their table region. Route table edges between region headers and entity edges between entity coordinates. Do not import `d3-force`.

- [ ] **Step 4: Add worker transport**

The client must create:

```ts
new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" })
```

Tag requests with increasing IDs and ignore stale responses after graph/reset changes.

- [ ] **Step 5: Run layout tests**

Run: `npm --prefix frontend test -- --run src/graph/layout.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/graph
git commit -m "feat: lay out graph in table groups"
```

---

### Task 4: Canvas scene, semantic zoom, and hit testing

**Files:**
- Create: `frontend/src/graph/scene.ts`
- Create: `frontend/src/graph/hitTest.ts`
- Test: `frontend/src/graph/scene.test.ts`
- Test: `frontend/src/graph/hitTest.test.ts`

**Interfaces:**
- Consumes: graph data, layout, zoom transform, confidence threshold.
- Produces: `buildScene(...) -> RenderScene` and `hitTest(scene, point) -> HitTarget | null`.

- [ ] **Step 1: Write scene-level tests**

Test these exact zoom levels:

```ts
expect(buildScene(input({ k: 0.5 })).entityLabels).toHaveLength(0);
expect(buildScene(input({ k: 0.5 })).tableNodes).toHaveLength(4);
expect(buildScene(input({ k: 0.9 })).entityDots.length).toBeGreaterThan(0);
expect(buildScene(input({ k: 1.5 })).entityLabels.length).toBeGreaterThan(0);
```

Also verify confidence filtering affects entity/table edge draw commands without deleting graph data.

- [ ] **Step 2: Run scene tests**

Run: `npm --prefix frontend test -- --run src/graph/scene.test.ts src/graph/hitTest.test.ts`

Expected: FAIL because scene/hit-test modules are absent.

- [ ] **Step 3: Implement render-scene generation**

Use thresholds `k < 0.65` for table-only, `0.65 <= k < 1.2` for entity dots, and `k >= 1.2` for entity labels. Build a fixed-size spatial grid for node hit testing and segment bounds for table/entity edges so pointer movement does not scan all 7000 entities.

- [ ] **Step 4: Run scene tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/graph/scene.ts frontend/src/graph/hitTest.ts frontend/src/graph/*.test.ts
git commit -m "feat: build scalable graph render scene"
```

---

### Task 5: Replace SVG GraphCanvas with Canvas 2D

**Files:**
- Rewrite: `frontend/src/components/GraphCanvas.tsx`
- Modify: `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- Modify: `frontend/src/components/CanvasErrorBoundary.tsx`

**Interfaces:**
- Consumes: layout client, scene builder, hit testing, Zustand graph interaction state.
- Produces: one Canvas-backed interactive graph surface.

- [ ] **Step 1: Rewrite GraphCanvas tests around observable behavior**

Assert:

- one `<canvas>` exists for a 7000-entity fixture;
- no `[data-node-id]` DOM elements are created per entity;
- empty, failed, complete, and partial states render correct text;
- pointer hit selects an entity;
- clicking a table edge requests focus for its supporting entity relations;
- fit/reset/zoom commands update the canvas transform.

- [ ] **Step 2: Run GraphCanvas tests and observe failure**

Run: `npm --prefix frontend test -- --run src/components/__tests__/GraphCanvas.test.tsx`

Expected: FAIL against the SVG implementation.

- [ ] **Step 3: Implement the Canvas renderer**

Use `devicePixelRatio`, `ResizeObserver`, one `requestAnimationFrame` draw loop, and D3 zoom behavior attached to the canvas element. Draw table regions/edges first, entity edges second, then entity dots/cards. Draw labels only from `RenderScene`. Cancel worker requests and animation frames on cleanup.

- [ ] **Step 4: Implement pointer and keyboard access**

Use spatial hit testing for hover/click. Give the canvas a graph summary `aria-label`. Preserve keyboard access through the existing searchable/focusable detail panel rather than thousands of hidden DOM nodes.

- [ ] **Step 5: Run GraphCanvas tests**

Run: `npm --prefix frontend test -- --run src/components/__tests__/GraphCanvas.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/components/GraphCanvas.tsx frontend/src/components/CanvasErrorBoundary.tsx frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "feat: render semantic graph on canvas"
```

---

### Task 6: Evidence-rich details, progress, and warnings

**Files:**
- Modify: `frontend/src/components/NodeDetailPanel.tsx`
- Modify: `frontend/src/components/ProgressIndicator.tsx`
- Modify: `frontend/src/components/GraphWorkbench.tsx`
- Modify: `frontend/src/components/GraphToolbar.tsx`
- Test: `frontend/src/components/__tests__/NodeDetailPanel.test.tsx`
- Test: `frontend/src/components/__tests__/GraphWorkbench.test.tsx`

**Interfaces:**
- Consumes: semantic entity/table edges, diagnostics, warnings, partial status.
- Produces: traceable relation details and non-blocking partial-result warnings.

- [ ] **Step 1: Add failing details/status tests**

Test an edge panel containing relation type, direction, strength, confidence, source/target field values, explanation, and model/task identifiers. Test a partial banner containing candidates completed/pending.

- [ ] **Step 2: Run tests**

Run: `npm --prefix frontend test -- --run src/components/__tests__/NodeDetailPanel.test.tsx src/components/__tests__/GraphWorkbench.test.tsx`

Expected: FAIL because evidence and partial status are not rendered.

- [ ] **Step 3: Implement details and status copy**

Render `表名 · ShortClassName` when class metadata exists. Keep all weak relations available; the confidence slider changes visibility only. Distinguish “完整分析未发现关系” from “分析未完成”.

- [ ] **Step 4: Run component tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/components frontend/src/components/__tests__
git commit -m "feat: explain semantic graph relationships"
```

---

### Task 7: Frontend verification

**Files:**
- Modify: `frontend/src/__tests__/integration.test.tsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: all frontend tasks.
- Produces: verified complete user flow and production build.

- [ ] **Step 1: Update the integration fixture**

Drive selection → submit → progress → partial/complete semantic graph → table-edge focus → entity evidence detail. Assert submitted fields exclude PK and class metadata.

- [ ] **Step 2: Run complete frontend verification**

Run:

```powershell
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: all tests pass, lint exits 0, and Vite build completes.

- [ ] **Step 3: Verify DOM scaling structurally**

Render a 7000-entity fixture and assert:

```ts
expect(container.querySelectorAll("canvas")).toHaveLength(1);
expect(container.querySelectorAll("[data-node-id]")).toHaveLength(0);
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/src
git commit -m "test: verify semantic graph frontend"
```
