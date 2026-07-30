# Task 6 Report: Canvas Renderer, Hover Focus, and Drag Pinning

## Scope

Implemented the Task 6 Canvas rendering and interaction slice only:

- `frontend/src/graph/renderer.ts` (new)
- `frontend/src/graph/renderer.test.ts` (new)
- `frontend/src/components/GraphCanvas.tsx`
- `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- `.superpowers/sdd/2026-07-30-semantic-graph-nebula-layout/task-6-report.md`

No Task 7 fixtures, backend contracts, API contracts, store contracts, or broad
visual redesign were added.

## TDD evidence

The renderer and component behavior tests were written before implementation.

Initial RED command, from `frontend/`:

```powershell
npx vitest run src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Expected RED result:

```text
Test Files  2 failed (2)
Tests       3 failed | 30 passed (33)
```

- `renderer.test.ts` could not resolve the absent `./renderer` module.
- The zero-display-name fixture did not draw the requested presentation text.
- Hover did not produce the `0.16` / `0.06` focus opacities.
- Dragging did not request pointer capture.

Final focused GREEN:

```text
Test Files  2 passed (2)
Tests       37 passed (37)
```

## Implementation

- Extracted background, grid, aggregate/entity curves, table anchors, entity
  markers, two-line entity labels, relation labels, and arrowheads into the
  pure `drawGraphScene` renderer.
- Draws Task 4 `QuadraticGeometry` with `quadraticCurveTo`; a partial embedded
  or test Canvas context without that optional runtime method is tolerated
  without failing the render frame.
- Applies Task 4 semantic layer opacity when unfocused.
- Applies exact focus constants:
  - unrelated node opacity `0.16`
  - unrelated edge opacity `0.06`
  - focused edge width `2.2`
- Draws unrelated relationships and nodes before related relationships, active
  nodes, focused labels, and arrowheads.
- Reserves the active two-line label before collision-skipping background labels.
- Paints a dark backing behind focused relationship labels.
- Builds the Task 2 focus index with `useMemo`, filtered by the current
  confidence threshold, and keeps focus out of layout dependencies.
- Gives an explicit selected node precedence over transient hover focus.
- Focuses both endpoints of a selected entity relationship; selected aggregate
  relationships receive focused curve/label treatment.
- Avoids redundant hovered-node Zustand updates and clears hover focus on
  pointer leave/cancel.
- Keeps Worker layout stable across hover, selection, confidence filtering,
  projection filtering, zoom, pan, and fit. Relayout forwards the incremented
  `relayoutRequest` as `seedOffset`.
- Implements pointer-captured entity dragging with Task 3
  `moveLayoutEntity`. Drag motion is inverted through the current D3 transform,
  previews without Worker work, and commits an immutable local scene once on
  release.
- Persists pinned coordinates across normal scene rebuilds and viewport layout
  responses, suppresses the click immediately following a real drag, and clears
  all pins when an explicit relayout starts.
- Prevents D3 panning while a node drag is active.
- Expands fit bounds by two entity collision radii horizontally and one radius
  vertically so two-line labels are not clipped.
- Focus transitions are intentionally instantaneous. No motion preference state
  or animation path is needed.

## Verification

Commands run from `frontend/`:

```powershell
npx vitest run src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx
npx vitest run src/__tests__/integration.test.tsx
npm test
npm run lint
npm run build
```

Results:

- Focused renderer/Canvas: 37/37 passed.
- Integration: 15/15 passed.
- Full frontend: 25 files, 218/218 passed.
- Lint: `oxlint` passed.
- Build: `tsc -b && vite build` passed.
- `git diff --check`: clean apart from Git's existing LF-to-CRLF notices.

The first full-suite run exposed an older integration Canvas double without
`quadraticCurveTo`; the renderer now guards that optional runtime capability.
The integration suite and complete frontend suite passed after the fix.

## Self-review

- All semantic drawing layers use paired `save` / `restore`.
- Normal production Canvas rendering uses quadratic paths, while `lineTo` is
  reserved for the grid and arrowheads.
- Confidence changes rebuild the scene but do not enter the Worker layout effect.
- Drag moves clone layout data and recompute only incident endpoints through the
  existing pure layout helper.
- Tooltips/sidebar selection, keyboard navigation, search, confidence
  semantics, and curved hit testing remain on their established paths.
- No opacity interpolation was introduced; this avoids hidden React state,
  uncancelled frames, and reduced-motion divergence.

## Concerns

None within Task 6 scope.

## Fix Round 1

### Formal-review findings addressed

1. Arrowheads are collected and drawn in final semantic layers after active
   nodes and all focused labels. Their curve-specific focus color and opacity
   are retained.
2. Active labels are derived directly from
   `SceneEntityNode.presentation`. Connected and isolated active nodes therefore
   always draw both primary and secondary presentation lines at overview zoom,
   even when background semantic labels omit the node or blank the secondary.
3. A selected table relationship now focuses both endpoint table IDs. Endpoint
   anchors and labels draw at full opacity while unrelated nodes remain dimmed.
4. Drag teardown is centralized. Normal pointer-up commits and suppresses only
   the drag-generated click; pointer cancel and lost pointer capture discard
   the preview, restore D3/hit interaction, and leave the next click live.
5. Pointer move no longer maps layout arrays, rebuilds a scene, rebuilds the hit
   index, or updates React scene generation. It stores the latest screen/world
   point and coalesces one preview RAF. The preview uses incident relationships
   cached at pointer-down, redraws the already-built committed scene, and
   overlays only those relationships plus the moving node and label.
   `moveLayoutEntity` runs once on pointer-up, followed by the exact scene and
   hit-index rebuild.

The unused `reduceMotion` option, component state, listener, and renderer
plumbing were removed because this implementation has no animation.

### RED evidence

Focused command:

```powershell
npx vitest run src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Result before production fixes:

```text
Test Files  2 failed (2)
Tests       7 failed | 37 passed (44)
```

Expected failures showed:

- final arrow call order before final label order;
- missing overview secondary text for a connected active node;
- missing primary and secondary text for an isolated active node;
- selected table endpoints drawing at `0.16`;
- pointer cancel suppressing the next click;
- lost pointer capture leaving hover/drag interaction stuck;
- eight 7,000-node pointer moves taking `130.7ms`, above the fixed `80ms`
  bound.

The new partial-preview API also had an isolated RED before implementation:

```text
TypeError: drawGraphDragPreview is not a function
Tests 1 failed | 8 skipped
```

### GREEN evidence

Focused result:

```text
Test Files  2 passed (2)
Tests       45 passed (45)
```

The 7,000-node regression verifies all eight pointer moves complete below
`80ms`, scene generation does not change during movement, only one preview RAF
is queued, and pointer-up increments scene generation exactly once.

Full verification:

```text
npm run lint   PASS
npm run build  PASS
npm test       25 files passed, 226 tests passed
```

### Concerns

The coalesced preview frame redraws the existing committed scene before drawing
the cached incident-edge overlay. This work is bounded to one animation frame
regardless of pointer-event rate and does not rebuild geometry or hit indexes;
the exact immutable scene is rebuilt once at commit.
