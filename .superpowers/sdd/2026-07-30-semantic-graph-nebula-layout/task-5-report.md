# Task 5: Curved Edge Hit Testing

## Implementation

- Indexed each `SceneEdge.geometry` as the union of cells traversed by 16 sampled quadratic segments.
- Measured hit distance against the closest sampled quadratic segment.
- Preserved node-before-edge priority and the existing traversal, safe-integer, and index-size guards.

## TDD evidence

- RED: `npx vitest run src/graph/hitTest.test.ts` failed with two intended failures: a curved midpoint and a self-loop midpoint returned `null` while the old implementation indexed and measured only the source-target chord.
- GREEN: the same focused command passed all 12 tests after the implementation.

## Scope expansion: compatibility tests

After the hit-test implementation, the full suite exposed five stale interaction tests that clicked source-target chord midpoints: four in `GraphCanvas.test.tsx` and one integration test. This was the direct expected consequence of hit testing the rendered quadratic geometry. No production Canvas or renderer code changed.

- RED evidence: `npx vitest run src/components/__tests__/GraphCanvas.test.tsx src/__tests__/integration.test.tsx` reported all five failures (37/42 passing); each selection remained `null` after a straight-chord click.
- Updated only those click coordinates to use `buildScene(...)` and `quadraticPoint(edge.geometry, 0.5)`, retaining each test's interaction and selection assertions.
- GREEN evidence: the same affected command passed all 42 tests.

## Final verification

- `npx vitest run src/graph/hitTest.test.ts` — pass (12/12).
- `npx vitest run src/components/__tests__/GraphCanvas.test.tsx src/__tests__/integration.test.tsx` — pass (42/42).
- `npm test` — pass (207/207).
- `npm run lint` — pass.
- `npm run build` — pass.
