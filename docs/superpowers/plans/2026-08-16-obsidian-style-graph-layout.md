# Obsidian-style Graph Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current table-lane/grid-influenced graph positioning with a compact, deterministic, Obsidian-like force layout and add restrained focus motion while preserving the existing node-side business data labels.

**Architecture:** Keep the current React + D3 + Canvas + Web Worker pipeline. Change the Worker input projection and positioning forces plus the Canvas focus animation lifecycle: the Worker receives the projected graph so hidden isolated nodes do not influence layout, entity nodes use a shared weighted force graph with mild component anchors, `scene.ts` retains the existing label generation unchanged, and `renderer.ts` receives a time phase only for focused edge/node feedback.

**Tech Stack:** React 19, TypeScript 6, Vite, D3 force simulation, Canvas 2D, Vitest, Testing Library.

## Global Constraints

- Default view includes all entities with visible relationships; isolated entities remain controlled by `showIsolatedNodes`.
- Preserve the existing primary label, secondary label, duplicate-name handling, label placement, search text, and detail-panel text.
- Do not change backend relationship discovery, confidence semantics, public graph data structures, or the Canvas/Web Worker boundary.
- Work with the existing dependencies; do not add a visualization library or replace Canvas with WebGL.
- Keep unrelated existing working-tree changes untouched.
- Respect `prefers-reduced-motion: reduce` and avoid leaving animation frames after relayout, unmount, or scene retirement.

---

### Task 1: Lock the new layout contract with regression tests

**Files:**
- Modify: `frontend/src/graph/layout.test.ts`
- Modify: `frontend/src/graph/scene.test.ts`
- Test: `frontend/src/graph/layout.test.ts`, `frontend/src/graph/scene.test.ts`

**Interfaces:**
- Consumes: existing `LayoutGraph`, `GraphLayout`, `computeNebulaLayout`, `compactLayoutGraph`, and `buildScene` APIs.
- Produces: failing tests that describe organic positioning, weighted edge distance, compact component spacing, and unchanged business labels/layer roles.

- [ ] **Step 1: Replace lane-specific expectations with organic-layout expectations**

Remove the test that requires `table-0 < table-1 < table-2 < table-3` on the x-axis. Replace it with a test that runs the 20-node and 200-node fixtures and asserts the table anchors do not form four equally spaced columns:

```ts
it.each([20, 200] as const)("does not lock process tables into equal business lanes", (entityCount) => {
  const layout = computeNebulaLayout(
    compactLayoutGraph(makeNebulaGraph({ entityCount })),
    { width: 1_280, height: 720 },
  );
  const xs = layout.tableNodes
    .map((node) => node.x)
    .sort((left, right) => left - right);
  const gaps = xs.slice(1).map((x, index) => x - xs[index]);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(18);
}, 15_000);
```

Keep the determinism, finite-coordinate, strong-vs-weak distance, collision, and disconnected-component tests, updating only thresholds if the new force constants require it.

- [ ] **Step 2: Add a test that table ownership does not dominate cross-table relationship distance**

Use a one-table fixture and a two-table fixture with the same strong edge. Assert the strong-linked endpoints remain within the configured link-distance band in both cases, so a table anchor cannot stretch the edge across the canvas:

```ts
it("keeps strong links compact even when endpoints belong to different tables", () => {
  const graph = layoutGraphFixture(2, 4, [
    { id: "cross", source: "entity-0", target: "entity-3", weight: 1 },
  ]);
  const layout = computeNebulaLayout(graph, { width: 1_280, height: 720 });
  const nodes = new Map(layout.entityNodes.map((node) => [node.id, node]));
  const distance = pointDistance(nodes.get("entity-0")!, nodes.get("entity-3")!);
  expect(distance).toBeLessThan(220);
});
```

- [ ] **Step 3: Add label-preservation assertions**

In the existing `buildScene` fixture assertions, verify the entity label still uses the existing `presentation.primary` and `presentation.secondary` values after any layout change. Do not loosen or rewrite the business presentation tests.

- [ ] **Step 4: Update scene opacity expectations to match entity-first graph reading**

Change only the assertions that currently require overview table edges to be stronger than entity edges. Assert instead that entity edges are the primary layer at overview and work zoom, while table edges remain present and lower weight:

```ts
expect(overview.layerOpacity.entityEdges).toBeGreaterThan(overview.layerOpacity.tableEdges);
expect(work.layerOpacity.entityEdges).toBeGreaterThan(work.layerOpacity.tableEdges);
```

- [ ] **Step 5: Run the focused tests and verify they fail for the old implementation**

Run: `npm --prefix frontend test -- --run frontend/src/graph/layout.test.ts frontend/src/graph/scene.test.ts`

Expected: the new organic-layout and entity-first opacity assertions fail before implementation, while unrelated existing tests continue to run.

- [ ] **Step 6: Commit the test contract**

```powershell
git add -- frontend/src/graph/layout.test.ts frontend/src/graph/scene.test.ts
git commit -m "test: define organic graph layout contract"
```

---

### Task 2: Replace table-lane positioning with a compact weighted force layout

**Files:**
- Modify: `frontend/src/graph/layout.ts:396-1315`
- Modify: `frontend/src/components/GraphCanvas.tsx:541-623`
- Test: `frontend/src/graph/layout.test.ts`

**Interfaces:**
- Consumes: existing `LayoutGraph`, `LayoutOptions`, `LayoutPoint`, `ENTITY_COLLISION_RADIUS`, and `computeNebulaLayout`/`computeFallbackScatterLayout` exports.
- Produces: the same `GraphLayout` shape with deterministic entity coordinates, shorter weighted edges, table nodes derived after entity placement, and no table-lane/grid packing on the main path.

- [ ] **Step 1: Add explicit organic-layout constants**

Near the existing layout constants, define the link and force values in one place so tests and future tuning have a stable vocabulary:

```ts
const STRONG_LINK_DISTANCE = 112;
const WEAK_LINK_DISTANCE = 164;
const STRONG_LINK_STRENGTH = 0.9;
const WEAK_LINK_STRENGTH = 0.28;
const ORGANIC_CHARGE = -108;
const ORGANIC_COMPONENT_STRENGTH = 0.018;
const ORGANIC_SIMULATION_TICKS = 420;
```

Keep `ENTITY_COLLISION_RADIUS` as the collision and label-spacing source of truth.

- [ ] **Step 2: Add deterministic organic component anchors**

Create a helper with this signature:

```ts
function seededOrganicAnchors(
  ids: readonly string[],
  seed: number,
  viewport: Viewport,
  minimumGap: number,
): Map<string, LayoutPoint>
```

Sort IDs before placement. Use a golden-angle/phyllotaxis sequence with small seed-derived radial jitter, scale the radius by `minimumGap` and component count, and center the result around the origin. Do not place anchors in rows/columns or on a fixed circle.

- [ ] **Step 3: Make entity initialization component-first, not table-first**

In `computeNebulaLayout`, keep `connectedComponents`, `componentByNode`, and stable seeding. Replace `businessLaneTableAnchors` as the entity initialization target with `seededOrganicAnchors` keyed by component ID. Initialize each entity around its component anchor using a stable per-node vector and a bounded scatter radius.

Do not feed table x/y anchors into the entity simulation. Keep a separate organic fallback anchor map for tables with no members.

- [ ] **Step 4: Configure one shared weighted D3 simulation**

Build the simulation with these forces:

```ts
const simulation = forceSimulation<SimulationEntity, SimulationEdge>(simulationNodes)
  .randomSource(random)
  .force(
    "links",
    forceLink<SimulationEntity, SimulationEdge>(links)
      .id((node) => node.id)
      .distance((link) => link.weight >= 1 ? STRONG_LINK_DISTANCE : WEAK_LINK_DISTANCE)
      .strength((link) => link.weight >= 1 ? STRONG_LINK_STRENGTH : WEAK_LINK_STRENGTH),
  )
  .force("charge", forceManyBody<SimulationEntity>()
    .strength(ORGANIC_CHARGE)
    .distanceMax(simulationNodes.length > 1_000 ? 900 : Infinity))
  .force("collision", forceCollide<SimulationEntity>(ENTITY_COLLISION_RADIUS)
    .strength(0.98)
    .iterations(2))
  .force("component-x", forceX<SimulationEntity>((node) =>
    componentAnchors.get(componentByNode.get(node.id) ?? node.id)?.x ?? 0,
  ).strength(ORGANIC_COMPONENT_STRENGTH))
  .force("component-y", forceY<SimulationEntity>((node) =>
    componentAnchors.get(componentByNode.get(node.id) ?? node.id)?.y ?? 0,
  ).strength(ORGANIC_COMPONENT_STRENGTH))
  .stop();
```

Run `ORGANIC_SIMULATION_TICKS` ticks for normal graphs. For large graphs, retain the existing node cap only as a force-acceleration optimization, then place omitted nodes using the same component anchor and collision relaxation so every default-visible related node still has coordinates.

- [ ] **Step 5: Remove the grid/lattice post-pass from the main path**

Do not call `packTableOwnedComponentLattice` from `computeNebulaLayout`. Keep `separateComponentBounds` only as a final collision safety pass, with the existing deterministic translation behavior and without reintroducing table-owned blocks. Use `relaxPointCollisions` after separation to maintain the label-safe minimum distance.

- [ ] **Step 6: Derive table nodes after entities are placed**

Continue using `tableNodesFromEntities`, but pass the organic fallback anchor map for empty tables. Table nodes must be centroids of their member entities and must not be used to reposition entities after the simulation. Keep table and entity edge routing unchanged.

- [ ] **Step 7: Align the fallback layout with the same visual contract**

Update `computeFallbackScatterLayout` to use the same organic component anchors and compact scatter rules instead of rectangular table anchors. Keep its deterministic seed behavior, finite-coordinate guarantees, and component separation safety net.

- [ ] **Step 8: Send the projected graph to the layout Worker**

In the graph-layout effect in `GraphCanvas.tsx`, replace the full-snapshot request:

```ts
void client.layoutGraph(graph, viewport, relayoutRequest)
```

with the current projection:

```ts
const layoutInput = projectedGraph ?? graph;
void client.layoutGraph(layoutInput, viewport, relayoutRequest)
```

Use `projectedGraph` in the effect dependency list so toggling `showIsolatedNodes` recomputes the layout. Keep `projectedGraphRef` for the async response guard and keep the full `graph` only for toolbar/summary data. Add a component test that enables the default hidden-isolated state, captures the Worker request, and verifies an isolated entity is absent from `request.graph.entity_nodes` while a connected entity remains.

- [ ] **Step 9: Run layout tests and tune only measurable thresholds**

Run: `npm --prefix frontend test -- --run frontend/src/graph/layout.test.ts`

Expected: PASS, including determinism, strong-vs-weak distance, component separation, finite coordinates, and no lane/grid assumptions. If a threshold fails, change the force constants or the test threshold based on measured output; do not restore table lanes.

- [ ] **Step 10: Commit the layout implementation**

```powershell
git add -- frontend/src/graph/layout.ts frontend/src/graph/layout.test.ts frontend/src/components/GraphCanvas.tsx frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "feat: use organic force layout for graph entities"
```

---

### Task 3: Make entity relations the primary scene layer without changing labels

**Files:**
- Modify: `frontend/src/graph/scene.ts:48-53`
- Modify: `frontend/src/graph/scene.test.ts:200-230`
- Test: `frontend/src/graph/scene.test.ts`

**Interfaces:**
- Consumes: unchanged `buildScene` input and existing `SemanticZoomLevel` values.
- Produces: the same `RenderScene` shape with entity-first opacity values and unchanged entity labels, label collision rules, relation labels, table colors, and hit index.

- [ ] **Step 1: Add a focused opacity test before changing constants**

Use the existing overview/work scene fixtures and assert entity edges are stronger than table edges at both levels while `tableEdges.length` and `entityLabels` remain unchanged. Run the focused test and verify it fails against the current `LAYER_OPACITY` values.

- [ ] **Step 2: Update only `LAYER_OPACITY`**

Use a restrained entity-first palette:

```ts
const LAYER_OPACITY = {
  overview: { tableEdges: 0.08, entityEdges: 0.24 },
  work: { tableEdges: 0.10, entityEdges: 0.54 },
  detail: { tableEdges: 0.08, entityEdges: 0.68 },
} as const;
```

Do not change `entityLabels`, `buildEdgeLabels`, `businessRelationLabel`, `tableColor`, or any presentation lookup.

- [ ] **Step 3: Run scene and presentation tests**

Run: `npm --prefix frontend test -- --run frontend/src/graph/scene.test.ts frontend/src/graph/businessPresentation.test.ts frontend/src/graph/businessRelations.test.ts`

Expected: PASS, with node-side primary/secondary labels matching the existing fixtures.

- [ ] **Step 4: Commit the scene-layer adjustment**

```powershell
git add -- frontend/src/graph/scene.ts frontend/src/graph/scene.test.ts
git commit -m "feat: prioritize entity relations in graph scene"
```

---

### Task 4: Add restrained Obsidian-like focus motion in Canvas

**Files:**
- Modify: `frontend/src/graph/renderer.ts:13-47,160-220,420-588`
- Modify: `frontend/src/components/GraphCanvas.tsx:200-397,680-765`
- Modify: `frontend/src/graph/renderer.test.ts`
- Modify: `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- Test: `frontend/src/graph/renderer.test.ts`, `frontend/src/components/__tests__/GraphCanvas.test.tsx`

**Interfaces:**
- Consumes: existing `GraphFocus`, `RenderScene`, `drawGraphScene`, and `GraphCanvas` animation frame refs.
- Produces: optional `motionPhase` drawing input, selected-edge pulse styling, active-node halo styling, and cleaned-up animation scheduling with no label-content changes.

- [ ] **Step 1: Add renderer tests for time-dependent focus styling**

Extend the existing Canvas context recorder to capture `setLineDash`, `lineDashOffset`, `shadowBlur`, and `shadowColor`. Add tests that call `drawGraphScene` with the same focused scene at two different motion phases and assert:

- focused entity edges receive a non-zero pulse offset or equivalent phase-dependent styling;
- the active node receives a halo stroke/fill operation;
- unrelated edges still use the existing reduced opacity;
- the label text operations still contain the original primary and secondary labels.

Use a phase input of `0` and `0.5`; do not rely on real time in unit tests.

- [ ] **Step 2: Extend `DrawGraphOptions` with an optional motion phase**

Add:

```ts
readonly motionPhase?: number;
```

Normalize non-finite values to `0`. Use the phase only inside focused edge and active-node drawing; keep static rendering identical when no focus exists.

- [ ] **Step 3: Implement the focused edge pulse**

For focused entity edges, draw the existing emphasized curve first, then add a short dashed highlight whose `lineDashOffset` advances with `motionPhase`. Keep the highlight narrow and low-frequency so the graph remains readable. Use `context.save()`/`restore()` around dash and shadow state and reset mutable Canvas properties for test/embedded contexts.

- [ ] **Step 4: Implement the active-node halo**

Before the active node fill, draw one or two translucent rings using the active node screen radius and a bounded phase-based radius multiplier. Use the existing `ACTIVE_NODE_OUTLINE`/`ENTITY_SELECTED` colors, not a new palette. Keep the halo outside the hit-test geometry so interaction behavior is unchanged.

- [ ] **Step 5: Add a motion loop only while focus or edge selection is active**

In `GraphCanvas.tsx`, add a ref for the motion animation frame and a ref for the current phase. Schedule a loop only when `graphFocus.activeNodeId`, `selectedEntityEdgeId`, or `selectedTableEdgeId` is non-null and reduced motion is not requested. Each frame updates the phase, calls the existing `invalidate()` path, and schedules the next frame. Stop and cancel the loop when focus clears, the scene is retired, the component unmounts, or reduced motion is enabled.

Do not start a permanent animation loop for an idle graph.

- [ ] **Step 6: Keep layout transition timing within the approved range**

Change the existing layout transition duration from `460` to `560` milliseconds. Keep the existing cubic ease, synchronous test-mode path, and cancellation behavior. Add a component test that confirms a relayout cancels the previous frame before scheduling the next layout frame.

- [ ] **Step 7: Run renderer and GraphCanvas tests**

Run: `npm --prefix frontend test -- --run frontend/src/graph/renderer.test.ts frontend/src/components/__tests__/GraphCanvas.test.tsx`

Expected: PASS, including label rendering, drag preview, focus fading, hit behavior, reduced-motion behavior, and motion cleanup.

- [ ] **Step 8: Commit the motion implementation**

```powershell
git add -- frontend/src/graph/renderer.ts frontend/src/graph/renderer.test.ts frontend/src/components/GraphCanvas.tsx frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "feat: add focused graph motion"
```

---

### Task 5: Verify the full frontend and inspect the rendered graph

**Files:**
- Modify: only files required by failing verification tests; do not change the approved label contract.
- Test: `frontend/src/graph/*.test.ts`, `frontend/src/components/__tests__/GraphCanvas.test.tsx`, `frontend/src/__tests__/integration.test.tsx`

**Interfaces:**
- Consumes: the completed organic layout, entity-first scene layer, and focus-motion renderer.
- Produces: a verified build and a visual inspection record for the requested graph shape.

- [ ] **Step 1: Run the full frontend test suite**

Run: `npm --prefix frontend test -- --run`

Expected: PASS with no snapshot or label regressions.

- [ ] **Step 2: Run TypeScript build and lint**

Run: `npm --prefix frontend run build`

Expected: PASS with no type errors. Then run `npm --prefix frontend run lint` and resolve only errors caused by this change.

- [ ] **Step 3: Start the Vite app for visual inspection**

Run: `npm --prefix frontend run dev -- --host 127.0.0.1`

Inspect the existing visual harness or app at 1920×1080, 1366×768, and a narrow viewport. Use at least the 20-node and 200-node fixtures before checking the current large graph.

- [ ] **Step 4: Verify the approved visual contract manually**

Check that:

- related nodes form compact organic clusters without table-lane columns;
- strong edges are shorter on average and long cross-canvas lines are gone;
- node-side concrete data labels remain visible with unchanged text;
- hover/selection emphasizes one-hop neighbors and animates only the focused relationship;
- no animation continues on an idle graph or after leaving the graph;
- `showIsolatedNodes`, search, drag, zoom, fit view, export, and details still work.

- [ ] **Step 5: Commit verification-only fixes and report results**

```powershell
git status --short
git diff --check
```

If verification requires a code fix, add only the affected files and commit with a focused message such as `fix: keep graph labels readable during focus motion`. Otherwise, leave unrelated working-tree changes untouched and report the exact test/build commands and outcomes.
