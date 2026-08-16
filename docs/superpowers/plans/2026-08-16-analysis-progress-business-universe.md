# Analysis Progress and Business Universe Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the analysis loading state into a real-time analysis cockpit and replace the scattered/radial graph overview with a deterministic business-lane layout without changing APIs, routes, backend contracts, or graph interactions.

**Architecture:** Keep the existing Zustand/WebSocket state and `LayoutClient` Worker boundary. Enrich `ProgressIndicator` from the existing progress and diagnostics fields, replace orbital table anchors with deterministic business lanes plus bounded entity clusters in `computeNebulaLayout`, and remove the renderer’s decorative orbit backdrop while preserving scene, focus, search, drag, and transition behavior.

**Tech Stack:** React 19, TypeScript, Zustand, D3 force simulation, Canvas 2D renderer, Tailwind CSS plus `frontend/src/index.css`, Vitest and Testing Library, Vite.

## Global Constraints

- Do not modify backend analysis algorithms, WebSocket message formats, API URLs, database fields, routes, or graph data contracts.
- Preserve search, keyboard focus, node/edge selection, unrelated-node fading, drag, fit view, relayout, export, and responsive behavior.
- Preserve the Data Meridian Observatory palette: graphite graph canvas, mineral ivory workbench, copper confirmation, cyan active analysis/path.
- Do not render fake diagnostic numbers; use a stable waiting label when diagnostics are not present.
- Do not render concentric circles, radial spokes, decorative orbit rings, or equivalent radial background decoration.
- Keep layout deterministic for the same graph and seed; only the existing relayout request changes the seed.
- Use existing tests and add focused tests before implementation changes for each behavior.

---

### Task 1: Define the analysis cockpit stage model and failing component tests

**Files:**
- Modify: `frontend/src/components/__tests__/ProgressIndicator.test.tsx`
- Modify: `frontend/src/components/ProgressIndicator.tsx`

**Interfaces:**
- Consumes: `phase`, `currentPhase`, `progressMessage`, `progressValue`, `diagnostics`, `selectedTables` from `useAnalysisStore`.
- Produces: A stable stage descriptor list and rendered semantic hooks for the progress cockpit; no new store or API fields.

- [ ] **Step 1: Add failing tests for the six-stage rail and diagnostics states**

Extend the existing test setup so `diagnostics` and `selectedTables` are explicit, then add tests equivalent to:

```tsx
it("shows the current stage, completed stages, and live diagnostic counts", () => {
  useAnalysisStore.setState({
    currentPhase: "candidates",
    progressValue: 0.52,
    progressMessage: "候选对象已整理",
    diagnostics: {
      entities_read: 128,
      plans_created: 24,
      candidates_retrieved: 76,
      candidates_completed: 18,
      candidates_pending: 58,
      strong_edges_created: 6,
      weak_edges_created: 11,
    },
  });

  render(<ProgressIndicator />);

  expect(screen.getByRole("list", { name: "分析阶段" })).toBeInTheDocument();
  expect(screen.getByText("正在寻找可能有关的对象")).toHaveAttribute("data-stage-state", "current");
  expect(screen.getByText("读取业务数据")).toHaveAttribute("data-stage-state", "complete");
  expect(screen.getByText("128")).toBeInTheDocument();
  expect(screen.getByText("58")).toBeInTheDocument();
});

it("uses waiting labels instead of invented diagnostic values", () => {
  useAnalysisStore.setState({ diagnostics: null, currentPhase: "schema", progressValue: 0.08 });

  render(<ProgressIndicator />);

  expect(screen.getAllByText("等待数据").length).toBeGreaterThan(0);
  expect(screen.queryByText("0 个对象")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused tests and verify they fail for the new hooks**

Run: `npm test -- --run src/components/__tests__/ProgressIndicator.test.tsx --reporter=dot` from `frontend/`.

Expected: existing tests pass, and the new tests fail because the current component has no stage list or diagnostics metrics.

- [ ] **Step 3: Extract the exact stage descriptors inside `ProgressIndicator.tsx`**

Define a typed constant in the component module:

```ts
const ANALYSIS_STAGES = [
  { key: "schema", label: "读取业务数据" },
  { key: "entities", label: "整理业务对象" },
  { key: "planning", label: "梳理关系范围" },
  { key: "candidates", label: "寻找候选对象" },
  { key: "semantic_judging", label: "判断对象关系" },
  { key: "graph", label: "生成关系图" },
] as const;
```

Derive each stage state from the current phase and clamped progress without adding a second progress source. Use `complete` only for stages before the current stage, `current` for the active stage, and `pending` for later stages.

- [ ] **Step 4: Render the analysis cockpit using existing state only**

Keep the existing business-facing heading and technical details, but add:

```tsx
<ol aria-label="分析阶段" className="analysis-progress-stages">
  {stages.map((stage) => (
    <li key={stage.key} data-stage-state={stage.state}>
      <span aria-hidden="true" />
      <strong>{stage.label}</strong>
    </li>
  ))}
</ol>
```

Add a diagnostics definition list for selected tables, entities read, candidates pending, candidates completed, strong edges, and weak edges. Render `等待数据` when `diagnostics` is null or the individual value is absent. Clamp `progressValue` before calculating the displayed percentage and progress-bar width.

- [ ] **Step 5: Run the focused tests and commit the cockpit component**

Run: `npm test -- --run src/components/__tests__/ProgressIndicator.test.tsx --reporter=dot`.

Expected: all focused progress tests pass.

Commit only the component and its test:

```bash
git add frontend/src/components/ProgressIndicator.tsx frontend/src/components/__tests__/ProgressIndicator.test.tsx
git commit -m "feat: turn analysis progress into a live cockpit"
```

### Task 2: Implement deterministic business-lane graph anchors

**Files:**
- Modify: `frontend/src/graph/layout.ts`
- Modify: `frontend/src/graph/layout.test.ts`

**Interfaces:**
- Consumes: Existing `LayoutGraph`, `LayoutOptions`, `Viewport`, table metadata, entity ownership, table edges, and weighted entity edges.
- Produces: Existing `GraphLayout` with deterministic table anchors, bounded entity clusters, finite coordinates, stable edge routing, and unchanged public function signatures.

- [ ] **Step 1: Add failing layout tests for table lanes and owner-cluster proximity**

Add tests around `computeNebulaLayout` that assert the new spatial contract without relying on exact pixel coordinates:

```ts
it("places process tables on ordered business lanes instead of an orbital perimeter", () => {
  const layout = computeNebulaLayout(compactLayoutGraph(makeNebulaGraph({ entityCount: 20 })), { width: 1280, height: 720 });
  const xByTable = new Map(layout.tableNodes.map((node) => [node.id, node.x]));

  expect(xByTable.get("table-0")).toBeLessThan(xByTable.get("table-1")!);
  expect(xByTable.get("table-1")).toBeLessThan(xByTable.get("table-2")!);
  expect(xByTable.get("table-2")).toBeLessThan(xByTable.get("table-3")!);
});

it("keeps each entity cluster bounded around its owning table anchor", () => {
  const layout = computeNebulaLayout(compactLayoutGraph(makeNebulaGraph({ entityCount: 200 })), { width: 1280, height: 720 });
  const tables = new Map(layout.tableNodes.map((node) => [node.id, node]));
  const maxDistanceByTable = new Map<string, number>();

  for (const entity of layout.entityNodes) {
    const table = tables.get(entity.tableId)!;
    const distance = Math.hypot(entity.x - table.x, entity.y - table.y);
    maxDistanceByTable.set(entity.tableId, Math.max(maxDistanceByTable.get(entity.tableId) ?? 0, distance));
  }

  expect(Math.max(...maxDistanceByTable.values())).toBeLessThan(1_800);
});
```

Retain the existing determinism, strong-vs-weak distance, component separation, finite-coordinate, collision, and large-component tests.

- [ ] **Step 2: Run the layout tests and verify the new contract fails**

Run: `npm test -- --run src/graph/layout.test.ts --reporter=dot` from `frontend/`.

Expected: the new ordered-lane or bounded-cluster assertion fails against the orbital anchor implementation while existing invariants remain visible.

- [ ] **Step 3: Replace orbital table anchors with stable process-lane anchors**

Add a deterministic helper in `layout.ts` that groups sorted tables by `processClassIndex`, orders each group by table degree then stable ID, and places group columns across the viewport. Use a bounded minimum gap derived from the number of tables and the viewport aspect ratio. Unknown process classes occupy later columns in stable order. Do not call `seededOrbitalAnchors` from `computeNebulaLayout`.

The helper must preserve the existing recentering contract: a table-only layout remains centered on the viewport, and all output coordinates remain finite.

- [ ] **Step 4: Pull entities toward their owner lane while preserving relation forces**

Use the lane anchor map for the existing `table-x` and `table-y` forces. Increase owner-lane strength enough to keep each entity cluster bounded, keep strong links shorter and stronger than weak links, and cap the local table scatter span for very large tables so the whole graph does not expand into an unusable perimeter. Keep the existing collision and component-separation passes after the simulation.

- [ ] **Step 5: Run the complete layout test file and commit the algorithm**

Run: `npm test -- --run src/graph/layout.test.ts --reporter=dot`.

Expected: all layout tests, including the new lane and owner-cluster assertions, pass.

Commit:

```bash
git add frontend/src/graph/layout.ts frontend/src/graph/layout.test.ts
git commit -m "feat: arrange graph nodes into business lanes"
```

### Task 3: Remove radial canvas decoration and test the clean overview backdrop

**Files:**
- Modify: `frontend/src/graph/renderer.ts`
- Modify: `frontend/src/graph/renderer.test.ts`

**Interfaces:**
- Consumes: Existing `RenderScene` and `DrawGraphOptions`.
- Produces: The same `drawGraphScene` behavior for edges, nodes, labels, focus, drag previews, and semantic zoom, with only the decorative backdrop removed.

- [ ] **Step 1: Add a renderer regression test for no concentric backdrop**

Extend `recordingContext()` with a stroke record that can distinguish grid lines from full-circle arcs, then add:

```ts
it("keeps the overview canvas free of orbit circles and radial spokes", () => {
  const { context, records } = recordingContext();

  drawGraphScene(context, scene(0.2), options());

  expect(records.filter((record) => record.kind === "stroke" && record.arc)).toHaveLength(0);
  expect(context.moveTo).not.toHaveBeenCalledWith(480, 300);
});
```

The test must continue to permit node arcs; it only rejects stroked background arcs and center-to-perimeter spokes.

- [ ] **Step 2: Run the focused renderer test and verify it fails**

Run: `npm test -- --run src/graph/renderer.test.ts --reporter=dot`.

Expected: the new test fails because the current overview calls `drawObservatoryBackdrop`.

- [ ] **Step 3: Remove the orbit backdrop call and dead drawing function**

Delete `drawObservatoryBackdrop`, its orbit color constant, and the conditional call in `drawGraphScene`. Leave `drawGrid` as the only non-data canvas background layer. Keep all node and edge drawing order unchanged after the background step.

- [ ] **Step 4: Run renderer and graph canvas tests and commit**

Run: `npm test -- --run src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx --reporter=dot`.

Expected: the clean-backdrop test and all existing focus, search, drag, label, and arrowhead tests pass.

Commit:

```bash
git add frontend/src/graph/renderer.ts frontend/src/graph/renderer.test.ts
git commit -m "feat: remove radial graph backdrop"
```

### Task 4: Style the analysis cockpit and graph overview surfaces

**Files:**
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: The semantic class hooks from `ProgressIndicator` and existing `.selection-*` / `.graph-*` contracts.
- Produces: Desktop, narrow tablet, and mobile layouts for the new progress cockpit and the lane-based graph overview.

- [ ] **Step 1: Add the semantic cockpit selectors and state rules**

After Task 1 adds the markup hooks, add these exact selectors to `frontend/src/index.css`:

```css
.analysis-progress-shell
.analysis-progress-header
.analysis-progress-stages
.analysis-progress-stages li[data-stage-state="current"]
.analysis-progress-metrics
.analysis-progress-details
```

- [ ] **Step 2: Add the desktop cockpit layout styles**

Use the existing graphite/ivory/copper/cyan tokens. The progress surface should read as a detailed workbench module: a clear header, a horizontal stage rail, a metric grid, a wide progress bar, and a quiet details disclosure. Avoid a centered tiny card with large unused page space.

- [ ] **Step 3: Add responsive cockpit styles**

At the existing responsive breakpoints, switch the stage rail to a readable vertical or two-row flow, keep metrics in a two-column tablet grid and one-column mobile grid, preserve 44px touch targets, and retain safe-area padding already established for the app shell.

- [ ] **Step 4: Harmonize graph canvas surfaces after removing rings**

Keep the canvas graphite background and low-contrast grid, remove any CSS that implies orbit/radial decoration, and preserve the existing high-contrast selected/active/related states. Do not reintroduce circular decorative primitives through gradients or pseudo-elements.

- [ ] **Step 5: Run the build and detector checks for the CSS pass**

Run from `frontend/`:

```bash
npx vite build
```

Run from the repository root:

```bash
node C:/Users/Administrator/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout --target frontend/src/index.css
node C:/Users/Administrator/.agents/skills/impeccable/scripts/detect.mjs --json --scope type --target frontend/src/index.css
```

Expected: Vite succeeds and both detector commands return empty arrays.

### Task 5: Full verification and handoff

**Files:**
- Test: `frontend/src/components/__tests__/ProgressIndicator.test.tsx`
- Test: `frontend/src/graph/layout.test.ts`
- Test: `frontend/src/graph/renderer.test.ts`
- Verify: `frontend/src/components/__tests__/GraphCanvas.test.tsx`, `frontend/src/__tests__/integration.test.tsx`

**Interfaces:**
- Consumes: All task outputs above.
- Produces: A verified frontend implementation with unchanged API/backend behavior.

- [ ] **Step 1: Run TypeScript validation**

Run: `npx tsc -b` from `frontend/`.

Expected: exit code 0.

- [ ] **Step 2: Run the full Vitest suite**

Run: `npm test -- --reporter=dot` from `frontend/`.

Expected: all test files and tests pass. Existing non-failing `act(...)` and browser `Worker` stderr warnings may remain; they are not counted as failures.

- [ ] **Step 3: Run the production build**

Run: `npx vite build` from `frontend/`.

Expected: production assets build successfully.

- [ ] **Step 4: Run the final Impeccable and diff checks**

Run from the repository root:

```bash
node C:/Users/Administrator/.agents/skills/impeccable/scripts/detect.mjs --json --scope layout --target frontend/src/index.css
node C:/Users/Administrator/.agents/skills/impeccable/scripts/detect.mjs --json --scope type --target frontend/src/index.css
git diff --check
```

Expected: both detector commands return `[]`; `git diff --check` reports no whitespace errors.

- [ ] **Step 5: Perform the bounded manual review**

Review the running app at the selection route during analysis, then at the generated graph route/state. Check: current-stage progression, missing-diagnostics waiting labels, partial/failure messaging, no orbit rings, lane ordering, bounded entity clusters, search focus fading, relayout transition, 7000+ entity fit, narrow tablet stacking, and mobile touch controls.

- [ ] **Step 6: Commit the verified UI implementation**

Commit only the implementation and its tests after review:

```bash
git add frontend/src/components/ProgressIndicator.tsx frontend/src/components/__tests__/ProgressIndicator.test.tsx frontend/src/graph/layout.ts frontend/src/graph/layout.test.ts frontend/src/graph/renderer.ts frontend/src/graph/renderer.test.ts frontend/src/index.css
git commit -m "feat: redesign analysis progress and business graph overview"
```

## Plan self-review

- Spec coverage: progress cockpit is covered by Task 1; business-lane layout by Task 2; removal of rings by Task 3; responsive and premium styling by Task 4; error/empty/large graph and regression verification by Task 5.
- API boundary: no task changes `frontend/src/api/analysis.ts`, the store contract, routes, backend, or WebSocket payloads.
- Determinism: Task 2 explicitly retains graph-signature seeding and relayout-only seed changes.
- Completeness scan: no unresolved or unspecified implementation step remains in this plan.
- Type consistency: all tasks use existing `ProgressIndicator`, `computeNebulaLayout`, `GraphLayout`, `drawGraphScene`, and test file paths.
