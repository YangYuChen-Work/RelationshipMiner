# Task 3 Report — Grouped layout and worker transport

## RED → GREEN

The new layout suite initially failed because `layout.ts` did not exist. It
now verifies deterministic coordinates despite reordered input, containment of
each known entity in its table region, separate table/entity edge routing with
unknown endpoints skipped, a 7,000-entity/10-table fixture with exactly ten
regions, and stale-worker cancellation using a fake Vitest worker.

## Implementation

- `computeGroupedLayout` is pure and uses sorted table/entity IDs plus compact
  grids; it does not use `d3-force`.
- Table edges use table-header coordinates; entity edges use entity positions.
- `LayoutClient` creates a module worker, uses strictly increasing request IDs,
  rejects superseded/reset requests, ignores late responses, and terminates the
  worker while rejecting pending work on disposal.

## Verification

- `npm --prefix frontend test -- --run src/graph/layout.test.ts` — 3 passed.
- Focused TypeScript check for the three production graph files — passed.
- `git diff --check` for staged graph files — passed.
- Full frontend suite — 82 passed, 5 failed. The five failures remain the
  pre-existing legacy `src/__tests__/integration.test.tsx` fixtures using the
  retired graph/progress contract; no graph-layout test failed.

## Commit

- `8eb0db6` — `feat: lay out graph in table groups`
