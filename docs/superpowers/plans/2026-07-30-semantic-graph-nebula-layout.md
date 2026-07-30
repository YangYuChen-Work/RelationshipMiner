# Semantic Graph Nebula Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the circular semantic graph with a deterministic Obsidian-like nebula layout, meaningful two-line entity labels, semantic edge decluttering, and one-hop hover focus.

**Architecture:** Keep graph analysis data immutable and add focused presentation, focus-index, layout, geometry, and renderer modules around it. Run weighted D3 force simulation synchronously inside the existing Web Worker, then render stable scene commands on Canvas without rerunning layout for hover, zoom, selection, or confidence filtering.

**Tech Stack:** React 19, TypeScript 6, D3 7, Canvas 2D, Web Worker, Zustand 5, Vitest 4, Testing Library, Vite 8, Tailwind CSS 4.

## Global Constraints

- Modify only frontend graph layout, presentation, interaction, and test support.
- Do not change backend relationship discovery or the public API data structure.
- Do not add a graph visualization framework or WebGL.
- Do not use concentric circles, regular rings, equal-angle placement, or a regular node grid.
- Use entity relationships as the primary layout force and table membership as a soft clustering force.
- Keep the same initial graph deterministic; derive an alternate deterministic seed only when `relayoutRequest` changes.
- Do not rerun layout for hover, selection, zoom, pan, fit-view, or confidence filtering.
- Show meaningful instance information without a click; `0`, `1`, booleans, nulls, and status-only values cannot be the sole primary label.
- Keep labels compact: primary instance name/code plus secondary class/table and visible relationship count.
- Hover focus is one hop only. Unrelated nodes use approximately `0.16` opacity and unrelated edges approximately `0.06`.
- Do not render aggregate table edges and entity edges at full strength in the same semantic zoom level.
- Honor `prefers-reduced-motion`.
- Preserve existing toolbar, detail-panel, search, keyboard access, error boundary, export, and reset-analysis behavior.
- Run commands from `frontend/` unless a step says otherwise.
- Before Task 1, run `npm ci` once so the locked frontend toolchain is available.

---

## File Structure

### New focused modules

- `frontend/src/graph/presentation.ts`: Deterministic two-line entity presentation and low-information filtering.
- `frontend/src/graph/presentation.test.ts`: Presentation fallback and determinism tests.
- `frontend/src/graph/focus.ts`: Visible-edge adjacency index and one-hop focus resolution.
- `frontend/src/graph/focus.test.ts`: One-hop, threshold, and hover-over-selection tests.
- `frontend/src/graph/edgeGeometry.ts`: Quadratic curves, self-loops, endpoint clipping, sampling, and arrow geometry.
- `frontend/src/graph/edgeGeometry.test.ts`: Geometry stability and finite-output tests.
- `frontend/src/graph/renderer.ts`: Canvas draw order, semantic opacity, two-line labels, relation labels, and focus styling.
- `frontend/src/graph/renderer.test.ts`: Canvas command and focus-opacity tests.
- `frontend/src/test/nebulaFixtures.ts`: Shared deterministic 20-node and 200-node semantic graph fixtures.
- `frontend/src/test/NebulaVisualHarness.tsx`: Browser-only visual verification harness.
- `frontend/visual-test.html`: Vite entry point for manual and automated screenshot verification.

### Existing modules to modify

- `frontend/src/graph/layout.ts`: Replace ring placement with weighted deterministic force layout and hashed scatter fallback.
- `frontend/src/graph/layout.test.ts`: Add nebula, distance, overlap, seed, and fallback assertions.
- `frontend/src/graph/layoutClient.ts`: Carry the relayout seed offset through queued Worker requests.
- `frontend/src/graph/layout.worker.ts`: Invoke nebula layout and return fallback layout after simulation failure.
- `frontend/src/graph/scene.ts`: Build presentation-rich nodes, curved edges, semantic zoom layers, and direction metadata.
- `frontend/src/graph/scene.test.ts`: Cover semantic zoom, meaningful labels, direction, and curved scene commands.
- `frontend/src/graph/hitTest.ts`: Index and measure sampled quadratic curves instead of straight segments.
- `frontend/src/graph/hitTest.test.ts`: Cover curved-edge and self-loop hit testing.
- `frontend/src/components/GraphCanvas.tsx`: Delegate drawing, apply focus, support pinning by drag, and pass seed offset to layout.
- `frontend/src/components/__tests__/GraphCanvas.test.tsx`: Cover hover dimming, layout lifecycle, drag pinning, and initial labels.
- `frontend/src/index.css`: Add only the visual harness page shell if needed; production graph remains Canvas-rendered.

---

### Task 1: Meaningful Two-Line Entity Presentation

**Files:**
- Create: `frontend/src/graph/presentation.ts`
- Create: `frontend/src/graph/presentation.test.ts`
- Test: `frontend/src/graph/presentation.test.ts`

**Interfaces:**
- Consumes: `EntityNodeData` from `frontend/src/api/analysis.ts`.
- Produces:

```ts
export interface EntityPresentation {
  primary: string;
  secondary: string;
  accessibleLabel: string;
}

export function presentEntity(
  entity: EntityNodeData,
  visibleDegree: number,
): EntityPresentation;
```

- [ ] **Step 1: Write failing tests for low-information rejection and semantic fallback**

Create table-driven tests that assert:

```ts
it.each([
  { display_name: "0", dimensions: { name: "反射器组件", status: 0 }, expected: "反射器组件" },
  { display_name: "0", dimensions: { status: 0, item_code: "ITEM0000400" }, expected: "ITEM0000400" },
  { display_name: "true", dimensions: { enabled: true }, expected: "42" },
])("selects a meaningful primary label", ({ display_name, dimensions, expected }) => {
  expect(presentEntity({
    id: "parts:42",
    table_id: "parts",
    display_name,
    class_name: "com.example.ReflectorPart",
    dimensions,
  }, 3).primary).toBe(expected);
});
```

Also assert that identical dimensions in different insertion orders produce the same primary label, that URL-encoded ID suffixes are decoded safely, and that the secondary line contains `ReflectorPart`, `parts`, or a relationship count without duplicating identical values.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run src/graph/presentation.test.ts
```

Expected: FAIL because `presentation.ts` and `presentEntity` do not exist.

- [ ] **Step 3: Implement deterministic presentation scoring**

Implement these exact selection rules:

```ts
const FIELD_TIERS: readonly [RegExp, number][] = [
  [/(^|_)(name|title|label)($|_)/i, 100],
  [/(^|_)(code|number|no|serial|model)($|_)/i, 90],
  [/(^|_)(id|identifier)($|_)/i, 80],
];

function usefulText(value: unknown): string | null {
  if (value == null || typeof value === "boolean") return null;
  const text = String(value).trim();
  if (!text || /^(0|1|null|undefined|true|false)$/i.test(text)) return null;
  return text;
}
```

Score candidates by tier, then normalized field name, then text. Use a safe `decodeURIComponent` wrapper for the ID suffix. Derive the class short name by splitting on `.`, `$`, `/`, and `\`. Cap visible lines at 42 code points while keeping the full text in `accessibleLabel`.

Construct the secondary line from the first non-duplicate type source and `${visibleDegree} 个关系`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
npx vitest run src/graph/presentation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the presentation unit**

```powershell
git add frontend/src/graph/presentation.ts frontend/src/graph/presentation.test.ts
git commit -m "feat: derive meaningful graph entity labels"
```

---

### Task 2: One-Hop Focus Index

**Files:**
- Create: `frontend/src/graph/focus.ts`
- Create: `frontend/src/graph/focus.test.ts`
- Test: `frontend/src/graph/focus.test.ts`

**Interfaces:**
- Consumes: `EntityEdgeData[]`, confidence threshold, hovered node ID, selected node ID.
- Produces:

```ts
export interface GraphFocusIndex {
  readonly neighborsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly edgeIdsByNode: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface GraphFocus {
  readonly activeNodeId: string | null;
  readonly nodeIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
}

export function buildGraphFocusIndex(
  edges: readonly EntityEdgeData[],
  confidenceThreshold: number,
): GraphFocusIndex;

export function resolveGraphFocus(
  index: GraphFocusIndex,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
): GraphFocus;
```

- [ ] **Step 1: Write failing tests for visible one-hop adjacency**

Use a chain `a -> b -> c` with one strong and one weak edge. Assert:

```ts
expect([...resolveGraphFocus(index, "a", null).nodeIds].sort()).toEqual(["a", "b"]);
expect([...resolveGraphFocus(index, "a", null).edgeIds]).toEqual(["ab"]);
expect(resolveGraphFocus(index, "b", null).nodeIds.has("c")).toBe(true);
expect(resolveGraphFocus(index, "a", "c").activeNodeId).toBe("a");
```

Raise the confidence threshold and assert that a low-confidence weak edge disappears while a strong edge remains.

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run src/graph/focus.test.ts
```

Expected: FAIL because the focus module does not exist.

- [ ] **Step 3: Implement immutable adjacency maps**

Use `visibleEntityRelations` from `semantics.ts`. Add both directions to `neighborsByNode`, add the edge ID to both endpoints, and never recurse beyond direct neighbors. Return empty sets when neither hover nor selection is active. Hover takes priority over selection.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
npx vitest run src/graph/focus.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the focus unit**

```powershell
git add frontend/src/graph/focus.ts frontend/src/graph/focus.test.ts
git commit -m "feat: index one-hop graph focus"
```

---

### Task 3: Deterministic Weighted Nebula Layout

**Files:**
- Modify: `frontend/src/graph/layout.ts:1-323`
- Modify: `frontend/src/graph/layout.test.ts:1-323`
- Modify: `frontend/src/graph/layoutClient.ts:1-198`
- Modify: `frontend/src/graph/layout.worker.ts:1-19`
- Modify: `frontend/src/graph/scaling.test.ts:1-154`
- Test: `frontend/src/graph/layout.test.ts`
- Test: `frontend/src/graph/scaling.test.ts`

**Interfaces:**
- Extends `LayoutEntityEdgeInput` with numeric `weight`.
- Produces:

```ts
export interface LayoutOptions {
  readonly seedOffset?: number;
}

export const ENTITY_COLLISION_RADIUS = 58;

export function computeNebulaLayout(
  graph: LayoutGraph,
  viewport: Viewport,
  options?: LayoutOptions,
): GraphLayout;

export function computeFallbackScatterLayout(
  graph: LayoutGraph,
  viewport: Viewport,
  options?: LayoutOptions,
): GraphLayout;

export function moveLayoutEntity(
  layout: GraphLayout,
  nodeId: string,
  point: LayoutPoint,
): GraphLayout;
```

- Changes `LayoutClient.layoutGraph` to:

```ts
layoutGraph(
  graph: SemanticGraphData | LayoutGraph,
  viewport: Viewport,
  seedOffset?: number,
): Promise<GraphLayout>;
```

- [ ] **Step 1: Update layout tests to describe nebula invariants**

Replace assertions that require ring radii with invariant tests:

```ts
const layout = computeNebulaLayout(graph, { width: 1280, height: 720 });
expect(layout.entityNodes.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
expect(computeNebulaLayout(graph, viewport)).toEqual(computeNebulaLayout(graph, viewport));
expect(computeNebulaLayout(graph, viewport, { seedOffset: 1 })).not.toEqual(layout);
```

Add helpers that calculate pair distances and radial spread. Assert:

- Strongly connected pairs are closer on average than unrelated pairs.
- No table group has more than 70% of its entities at the same rounded radius from its centroid.
- Minimum center distance respects the label collision approximation for a local representative 20-node fixture.
- Two disconnected components have non-overlapping padded bounding boxes.
- Input order permutations produce identical output after sorting by ID.
- Fallback scatter is deterministic and fails the same circularity assertion.
- `moveLayoutEntity` changes one node and exactly the incident edge endpoints without mutating the input layout.

- [ ] **Step 2: Update layout-client tests to require seed forwarding**

In the existing Worker mock tests, call:

```ts
client.layoutGraph(graph, viewport, 3);
expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({
  graph: expect.any(Object),
  seedOffset: 3,
}));
```

Assert that `compactLayoutGraph` assigns `weight: 1` when any relation is strong and `weight: 0.35` when all relations are weak.

- [ ] **Step 3: Run layout tests and verify they fail**

Run:

```powershell
npx vitest run src/graph/layout.test.ts src/graph/scaling.test.ts
```

Expected: FAIL because nebula APIs, weighted edges, and seed forwarding do not exist.

- [ ] **Step 4: Replace ring placement with seeded D3 simulation**

Import the existing D3 force primitives. Set explicit seeded random initial positions so D3 never falls back to phyllotaxis:

```ts
const random = randomLcg(seedFor(graph, options.seedOffset ?? 0));
const simulation = forceSimulation(nodes)
  .randomSource(random)
  .force("links", forceLink(links)
    .id((node) => node.id)
    .distance((link) => link.weight >= 1 ? 92 : 148)
    .strength((link) => link.weight >= 1 ? 0.72 : 0.22))
  .force("charge", forceManyBody().strength(-115))
  .force("collision", forceCollide(58).strength(0.95).iterations(2))
  .force("table-x", forceX((node) => tableAnchors.get(node.tableId)!.x).strength(0.055))
  .force("table-y", forceY((node) => tableAnchors.get(node.tableId)!.y).strength(0.055))
  .force("component-x", forceX((node) => componentAnchors.get(componentByNode.get(node.id)!)!.x).strength(0.025))
  .force("component-y", forceY((node) => componentAnchors.get(componentByNode.get(node.id)!)!.y).strength(0.025))
  .stop();

for (let tick = 0; tick < 360; tick += 1) simulation.tick();
```

Generate table and connected-component anchors from two independent seeded rectangular coordinates per anchor, followed by 80 collision-relaxation passes. Do not derive either coordinate from an angle. Add a small deterministic per-node `x` and `y` jitter and the component forces shown above so disconnected component bounds separate. After simulation:

- Recenter the complete layout in the viewport coordinate system.
- Derive each visible table node from the centroid of its member entities.
- Preserve stable ID sorting.
- Rebuild edge endpoints from final entity coordinates.
- Reject non-finite output and let the Worker use fallback scatter.

- [ ] **Step 5: Implement deterministic non-circular fallback**

Use stable hash values to distribute table centers across a seeded rectangle. Place member nodes with independent seeded `x` and `y` jitter, then perform 48 pairwise relaxation passes. When two node centers are closer than `ENTITY_COLLISION_RADIUS * 2`, move each half the overlap along a stable hash-derived unit vector. Do not derive positions from an angle or a shared radius.

Implement `moveLayoutEntity` as a pure clone: update the matching entity coordinate, update only edges whose `source` or `target` matches the entity ID, and leave table coordinates and unrelated edges unchanged.

- [ ] **Step 6: Forward relayout seed through the Worker**

Add `seedOffset` to `LayoutWorkerRequest`, queued requests, and the Worker handler:

```ts
self.postMessage({
  requestId,
  layout: computeNebulaLayout(graph, viewport, { seedOffset }),
});
```

Catch simulation errors inside the Worker and return `computeFallbackScatterLayout` before returning an error. Only report an error if both normal and fallback layouts fail.

- [ ] **Step 7: Run layout and client tests**

Run:

```powershell
npx vitest run src/graph/layout.test.ts src/graph/scaling.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the layout unit**

```powershell
git add frontend/src/graph/layout.ts frontend/src/graph/layout.test.ts frontend/src/graph/layoutClient.ts frontend/src/graph/layout.worker.ts frontend/src/graph/scaling.test.ts
git commit -m "feat: lay out graph as deterministic nebula"
```

---

### Task 4: Curved Edge Geometry and Semantic Scene Layers

**Files:**
- Create: `frontend/src/graph/edgeGeometry.ts`
- Create: `frontend/src/graph/edgeGeometry.test.ts`
- Modify: `frontend/src/graph/scene.ts:19-507`
- Modify: `frontend/src/graph/scene.test.ts:1-600`
- Test: `frontend/src/graph/edgeGeometry.test.ts`
- Test: `frontend/src/graph/scene.test.ts`

**Interfaces:**
- Produces:

```ts
export type SemanticZoomLevel = "overview" | "work" | "detail";
export type SceneDirection = "forward" | "reverse" | "undirected";

export interface ScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface QuadraticGeometry {
  readonly from: ScreenPoint;
  readonly control: ScreenPoint;
  readonly to: ScreenPoint;
  readonly isLoop: boolean;
}

export function semanticZoomLevel(scale: number): SemanticZoomLevel;
export function buildQuadraticGeometry(input: {
  edgeId: string;
  from: ScreenPoint;
  to: ScreenPoint;
  fromBounds: ScreenBounds;
  toBounds: ScreenBounds;
}): QuadraticGeometry;
export function sampleQuadratic(
  geometry: QuadraticGeometry,
  segments?: number,
): ScreenPoint[];
export function quadraticPoint(
  geometry: QuadraticGeometry,
  t: number,
): ScreenPoint;
```

- Extends `SceneEntityNode` with `presentation` and `visibleDegree`.
- Extends `SceneEdge` with `sourceId`, `targetId`, `geometry`, and `direction`.
- Extends `RenderScene` with `zoomLevel` and layer opacities:

```ts
layerOpacity: {
  tableEdges: number;
  entityEdges: number;
};
```

- [ ] **Step 1: Write failing geometry tests**

Assert:

- The same edge ID and endpoints produce the same control point.
- Reversing endpoints preserves the same visible curve.
- A self-loop has finite, non-zero geometry next to the node.
- Curve endpoints lie outside the source and target label bounds.
- `sampleQuadratic` includes both endpoints and finite intermediate points.
- `semanticZoomLevel(0.4) === "overview"`, `semanticZoomLevel(0.8) === "work"`, and `semanticZoomLevel(1.2) === "detail"`.

- [ ] **Step 2: Write failing scene tests**

Add assertions:

```ts
expect(scene.entityDots[0].presentation.primary).not.toBe("0");
expect(workScene.layerOpacity.entityEdges).toBeGreaterThan(workScene.layerOpacity.tableEdges);
expect(overviewScene.layerOpacity.tableEdges).toBeGreaterThan(overviewScene.layerOpacity.entityEdges);
expect(detailScene.entityEdges[0].direction).toBe("forward");
expect(detailScene.entityLabels[0].secondary).toContain("个关系");
```

For mixed relation directions, expect `undirected`. Assert that scene creation no longer drops every entity label solely because `k < 1.2`.

- [ ] **Step 3: Run focused tests and verify they fail**

Run:

```powershell
npx vitest run src/graph/edgeGeometry.test.ts src/graph/scene.test.ts
```

Expected: FAIL because geometry, presentation-rich scene nodes, and semantic layers are missing.

- [ ] **Step 4: Implement curve, clipping, loop, and arrow helpers**

Canonicalize the unordered endpoint pair before hashing so reversing endpoints preserves the same visible path. Use the stable edge hash to choose a small signed perpendicular offset between 12 and 28 screen pixels. Clip the first and last curve segments against each node-label rectangle. For a self-loop, place the control and sampled points above-right of the node bounds.

Resolve direction from visible relations:

```ts
function relationDirection(relations: readonly EntityRelationData[]): SceneDirection {
  const directions = new Set(relations.map((relation) => relation.direction));
  if (directions.size !== 1) return "undirected";
  const [direction] = directions;
  return direction === "source_to_target"
    ? "forward"
    : direction === "target_to_source"
      ? "reverse"
      : "undirected";
}
```

- [ ] **Step 5: Integrate presentation and semantic zoom into `buildScene`**

Compute visible degrees using only visible entity edges. Call `presentEntity` for every rendered entity. Use these layer values:

```ts
const LAYER_OPACITY = {
  overview: { tableEdges: 0.58, entityEdges: 0.10 },
  work: { tableEdges: 0.12, entityEdges: 0.42 },
  detail: { tableEdges: 0.06, entityEdges: 0.55 },
} as const;
```

Generate primary labels for all work/detail entities. At overview, generate primary labels for connected entities and all table anchors. Include secondary labels in work/detail scene commands; the renderer may suppress colliding secondary lines but must always retain the active node's complete presentation.

Remove `TABLE_ONLY_ZOOM` entity suppression. Entity markers remain present at every valid zoom; semantic zoom changes their label density and relationship opacity instead of deleting all entities.

- [ ] **Step 6: Run geometry and scene tests**

Run:

```powershell
npx vitest run src/graph/edgeGeometry.test.ts src/graph/scene.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the geometry and scene unit**

```powershell
git add frontend/src/graph/edgeGeometry.ts frontend/src/graph/edgeGeometry.test.ts frontend/src/graph/scene.ts frontend/src/graph/scene.test.ts
git commit -m "feat: add semantic curved graph scene"
```

---

### Task 5: Curved Edge Hit Testing

**Files:**
- Modify: `frontend/src/graph/hitTest.ts:1-300`
- Modify: `frontend/src/graph/hitTest.test.ts:1-230`
- Test: `frontend/src/graph/hitTest.test.ts`

**Interfaces:**
- Consumes: `SceneEdge.geometry` and `sampleQuadratic` from Task 4.
- Preserves: existing `HitTarget`, `SceneHitIndex`, `hitTest`, and diagnostic APIs.

- [ ] **Step 1: Write failing tests for curve-only hit points**

Create a quadratic edge whose midpoint is far from the straight source-target segment. Assert that the midpoint hits the edge and the old straight midpoint does not. Add a self-loop hit and a miss outside `EDGE_HIT_TOLERANCE`.

```ts
expect(hitTest(scene, quadraticPoint(edge.geometry, 0.5))).toEqual({
  kind: "entity-edge",
  id: edge.id,
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
npx vitest run src/graph/hitTest.test.ts
```

Expected: FAIL because indexing and distance checks still use the straight chord.

- [ ] **Step 3: Index sampled curve segments**

Replace `traversedEdgeCells(edge)` with traversal over `sampleQuadratic(edge.geometry, 16)` segment pairs. Union the traversed cells and keep the existing safe-integer and maximum-cell guards.

Replace `distanceToSegment(point, edge)` with the minimum distance to the sampled segments. Keep node priority over edge priority and preserve diagnostics.

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
npx vitest run src/graph/hitTest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit curved hit testing**

```powershell
git add frontend/src/graph/hitTest.ts frontend/src/graph/hitTest.test.ts
git commit -m "feat: hit test curved graph relations"
```

---

### Task 6: Canvas Renderer, Hover Focus, and Drag Pinning

**Files:**
- Create: `frontend/src/graph/renderer.ts`
- Create: `frontend/src/graph/renderer.test.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx:14-218`
- Modify: `frontend/src/components/GraphCanvas.tsx:220-864`
- Modify: `frontend/src/components/__tests__/GraphCanvas.test.tsx:1-902`
- Test: `frontend/src/graph/renderer.test.ts`
- Test: `frontend/src/components/__tests__/GraphCanvas.test.tsx`

**Interfaces:**
- Consumes: `RenderScene`, `GraphFocus`, viewport size, selected edge IDs.
- Produces:

```ts
export interface DrawGraphOptions {
  readonly width: number;
  readonly height: number;
  readonly focus: GraphFocus;
  readonly selectedEntityEdgeId: string | null;
  readonly selectedTableEdgeId: string | null;
  readonly reduceMotion: boolean;
}

export function drawGraphScene(
  context: CanvasRenderingContext2D,
  scene: RenderScene,
  options: DrawGraphOptions,
): void;
```

- [ ] **Step 1: Write failing renderer tests**

Use a mocked 2D context and assert:

- With no focus, entity and table layers use `scene.layerOpacity`.
- With node `a` focused, unrelated node alpha reaches `0.16` and unrelated edge alpha reaches `0.06`.
- Related curves are drawn after unrelated curves and with greater line width.
- `quadraticCurveTo` is used instead of a straight `lineTo` for normal relationships.
- Detail or focused direction uses an arrowhead path.
- Primary and secondary labels are both drawn for the active node.
- Focused relation labels draw a dark background before text.

- [ ] **Step 2: Update component tests before implementation**

Add tests that:

- Render a graph whose backend `display_name` values are all `0`, wait for scene readiness, and assert the mocked Canvas receives meaningful `fillText` values.
- Move the pointer over a known entity, then assert a redraw uses focus alpha values.
- Leave the Canvas and assert a redraw restores default alpha.
- Change confidence threshold and assert the Worker request count does not increase.
- Trigger relayout and assert the request carries an incremented `seedOffset`.
- Drag a node, assert pointer capture is used, and assert its scene coordinate changes without a Worker request.
- Trigger relayout after drag and assert the pinned override is cleared.

- [ ] **Step 3: Run renderer and component tests and verify they fail**

Run:

```powershell
npx vitest run src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Expected: FAIL because the renderer, focus styling, seed forwarding, and drag pinning are missing.

- [ ] **Step 4: Extract Canvas drawing into `renderer.ts`**

Move grid, edge, node, table-anchor, entity-label, and relation-label drawing out of `GraphCanvas.tsx`.

Use `context.save()`, `context.globalAlpha`, and `context.restore()` around every semantic layer. Draw in this order:

1. Background and restrained grid.
2. Unrelated aggregate and entity relationships.
3. Unrelated nodes and labels.
4. Related nodes and relationships.
5. Active node.
6. Focused labels and arrowheads.

Use the approved constants:

```ts
const UNRELATED_NODE_OPACITY = 0.16;
const UNRELATED_EDGE_OPACITY = 0.06;
const FOCUS_EDGE_WIDTH = 2.2;
```

Draw entity labels as a compact primary line and smaller secondary line beside the colored node marker. Use screen-space occupied rectangles to skip colliding background labels, but reserve and always draw the hovered or selected node presentation first.

- [ ] **Step 5: Build and memoize focus state in `GraphCanvas`**

Use `useMemo` for `buildGraphFocusIndex(projectedGraph.entity_edges, confidenceThreshold)`. Resolve the active focus from `hoveredNodeId` and `selectedNodeId` before each invalidated draw. Do not include focus in layout dependencies.

Avoid redundant Zustand updates:

```ts
const nextHoveredId =
  target?.kind === "entity-node" ? target.id : null;
if (nextHoveredId !== hoveredNodeRef.current) setHoveredNode(nextHoveredId);
```

- [ ] **Step 6: Forward the relayout seed without relayout on filters**

Call:

```ts
client.layoutGraph(projectedGraph, viewport, relayoutRequest)
```

Keep `confidenceThreshold` out of the layout effect dependencies. Rebuild only the scene when the threshold changes.

- [ ] **Step 7: Add node drag pinning**

Maintain:

```ts
const pinnedPositionsRef = useRef(new Map<string, { x: number; y: number }>());
const draggingNodeRef = useRef<string | null>(null);
```

On pointer-down capture, hit-test the current scene. If an entity node is hit, capture the pointer and record the node ID before D3 zoom handles the event. On pointer move while dragging:

- Invert `transformRef.current` to world coordinates.
- Apply the pinned position to a cloned layout.
- Recompute incident layout edge endpoints.
- Commit the updated scene through the existing animation-frame invalidation.

On pointer up or cancel, release pointer capture and keep the pinned coordinate. Clear all pins when `relayoutRequest` changes.

Update the D3 zoom filter so an active node drag does not pan the canvas.

Use `moveLayoutEntity` from Task 3 for the immutable coordinate update. Expand `fitTransform` bounds by `ENTITY_COLLISION_RADIUS * 2` horizontally and `ENTITY_COLLISION_RADIUS` vertically so initial fit does not clip two-line node labels.

- [ ] **Step 8: Honor reduced motion**

Read `window.matchMedia("(prefers-reduced-motion: reduce)")` once with cleanup. Use instant focus restoration when reduced motion is requested. Any opacity easing must use a short request-animation-frame interpolation outside React state and must be cancelable on unmount.

- [ ] **Step 9: Run renderer and component tests**

Run:

```powershell
npx vitest run src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Canvas interaction**

```powershell
git add frontend/src/graph/renderer.ts frontend/src/graph/renderer.test.ts frontend/src/components/GraphCanvas.tsx frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "feat: focus and render graph relationships"
```

---

### Task 7: Visual Fixtures, Responsive Verification, and Full Regression

**Files:**
- Create: `frontend/src/test/nebulaFixtures.ts`
- Create: `frontend/src/test/NebulaVisualHarness.tsx`
- Create: `frontend/visual-test.html`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/graph/layout.test.ts`
- Modify: `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- Test: all frontend tests and browser screenshots.

**Interfaces:**
- Produces:

```ts
export function makeNebulaGraph(options: {
  entityCount: 20 | 200;
}): SemanticGraphData;
```

- The fixture must contain four table groups, two disconnected components, strong and weak relations, at least one cross-table bridge, one self-loop, and several nodes whose backend `display_name` is `0`.

- [ ] **Step 1: Create shared deterministic graph fixtures**

Generate IDs, fields, and edges from integer indices only. Use business labels such as `总装测试`, `反射器组件`, `ITEM0000400`, and `高增益物面天线`; do not use random runtime data. For every tenth entity set `display_name: "0"` while providing a meaningful `dimensions.item_code` or `dimensions.name`.

- [ ] **Step 2: Refactor representative tests to use the shared fixtures**

Replace local large-graph construction in the nebula layout and Canvas regression tests with `makeNebulaGraph({ entityCount: 20 })` and `makeNebulaGraph({ entityCount: 200 })`. Keep specialized one-edge fixtures local.

- [ ] **Step 3: Add a development-only visual harness**

Mount `GraphCanvas` inside the same dark workbench shell. Read `?size=20` or `?size=200`, load the matching fixture into `useAnalysisStore`, and expose only test controls for hover/selection screenshot states.

The harness must not be imported by `src/main.tsx` or the production build entry.

- [ ] **Step 4: Run targeted 20-node and 200-node tests**

Run:

```powershell
npx vitest run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Expected: PASS for both fixture sizes.

- [ ] **Step 5: Run the complete frontend verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all tests pass, lint exits `0`, and Vite production build succeeds.

- [ ] **Step 6: Inspect the workbench in a real browser**

Use the `playwright` skill. Start Vite on an available local port, open:

```text
/visual-test.html?size=20
/visual-test.html?size=200
```

Capture initial, hover, and selected screenshots at:

- `1920×1080`
- `1366×768`
- `390×844`

Verify each acceptance item:

- No all-zero node labels.
- No circular or equal-angle placement.
- Organic irregular nebula clusters.
- Strong connections visibly form local groups.
- Disconnected components have whitespace.
- Hover isolates exactly one hop.
- Aggregate and entity relations do not compete at full intensity.
- Active two-line labels are readable and do not overlap.

- [ ] **Step 7: Fix only evidence-backed visual defects**

If screenshots reveal a failure, write or tighten the smallest automated regression test first, make one focused adjustment, rerun the focused test, then repeat the affected screenshot. Do not add unrelated restyling.

- [ ] **Step 8: Run final verification after screenshot fixes**

Run:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Expected: all commands exit `0`.

- [ ] **Step 9: Commit visual verification support**

```powershell
git add frontend/src/test/nebulaFixtures.ts frontend/src/test/NebulaVisualHarness.tsx frontend/visual-test.html frontend/src/index.css frontend/src/graph/layout.test.ts frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "test: verify semantic graph nebula experience"
```

---

## Final Acceptance Checklist

- [ ] Initial graph presents meaningful entity identities without click or double-click.
- [ ] A backend `display_name` of `0` cannot make all nodes appear as `0`.
- [ ] Layout is deterministic for initial load and changes only for explicit relayout.
- [ ] Layout is an irregular Obsidian-like nebula, not a circle, ring, or regular grid.
- [ ] Strong relations form tighter local groups than unrelated nodes.
- [ ] Same-table nodes have a soft tendency to cluster without hard boxes.
- [ ] Cross-table bridge nodes can sit naturally between clusters.
- [ ] Disconnected components retain visible whitespace.
- [ ] Hover highlights the active node, one-hop neighbors, and incident edges.
- [ ] Unrelated nodes and edges visibly dim to the approved opacity levels.
- [ ] Semantic zoom prevents aggregate and entity edges from competing at full intensity.
- [ ] Curved relations, self-loops, focused labels, and direction arrows remain hit-testable.
- [ ] Confidence filtering does not rerun layout.
- [ ] Dragging a node pins it until explicit relayout.
- [ ] Keyboard selection, search, details, export, errors, and reset behavior remain functional.
- [ ] Reduced-motion preference is respected.
- [ ] 20-node and 200-node fixtures pass automated and browser visual checks.
- [ ] Complete tests, lint, build, and `git diff --check` pass.
