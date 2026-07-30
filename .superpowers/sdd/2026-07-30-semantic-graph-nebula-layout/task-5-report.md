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

## Fix round 1: adaptive curve sampling

Review found that fixed 16-segment sampling can miss exact points on large, high-ordinal self-loops: the curve-to-polyline deviation grows quadratically with each segment's parameter span. A loop with ordinal 2,500 misses at `t = 0.46875` even though its midpoint (`t = 0.5`) is a sample vertex.

- RED: the new high-ordinal, off-sample self-loop regression failed under fixed sampling (`null` rather than the edge target).
- Replaced fixed sampling with shared adaptive sampling. The segment count is derived from the quadratic control-point curvature and a 3px maximum approximation deviation (half the 6px hit tolerance), with finite-input and 4,096-segment guards. Both spatial indexing and distance checks use the same sample set.
- GREEN: `npx vitest run src/graph/hitTest.test.ts` passed all 13 tests, including the regression.
- Final round verification: `npm test` passed 208/208; `npm run lint` and `npm run build` passed.
