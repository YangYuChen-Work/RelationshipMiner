# Task 5: Curved Edge Hit Testing

## Implementation

- Indexed each `SceneEdge.geometry` as the union of cells traversed by 16 sampled quadratic segments.
- Measured hit distance against the closest sampled quadratic segment.
- Preserved node-before-edge priority and the existing traversal, safe-integer, and index-size guards.

## TDD evidence

- RED: `npx vitest run src/graph/hitTest.test.ts` failed with two intended failures: a curved midpoint and a self-loop midpoint returned `null` while the old implementation indexed and measured only the source-target chord.
- GREEN: the same focused command passed all 12 tests after the implementation.

## Verification

- `npx vitest run src/graph/hitTest.test.ts` — pass (12/12).
- `npm run lint` — pass.
- `npm run build` — pass.
- `npm test` — 202/207 passing. The five unrelated-to-Task-5 failures are one integration test and four `GraphCanvas` tests that click straight source-target midpoints. Those coordinates no longer lie on the rendered quadratic curves. They need follow-up test updates using `quadraticPoint(edge.geometry, 0.5)` or an equivalent rendered curve coordinate; renderer and Canvas code were not modified here by task scope.
