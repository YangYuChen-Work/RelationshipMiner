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

## Fix round 1

### RED → GREEN

- Replaced the single-request worker assumption with tests for concurrent
  increasing request IDs and out-of-order replies. RED showed the second
  request rejecting the first; GREEN settles each promise by its own ID.
- Added reset/late-reply, idempotent disposal, worker `error`, and worker
  `messageerror` cases. Reset now rejects all current work while keeping the
  healthy worker available. Fatal worker events reject and clear every pending
  promise, detach handlers, terminate once, and make later requests reject
  immediately. Disposal has the same settlement guarantee and is idempotent.
- Added exact table-header/entity-position edge endpoint checks, full
  containment for 7,000 entities in ten regions, a 701-entity capacity case,
  empty/orphan/zero-viewport finite-output cases, and duplicate-ID cases for
  all four semantic graph collections. Duplicate IDs now fail explicitly
  before layout or endpoint maps can overwrite data.

### Verification

- Focused layout suite: 14 passed.
- Focused production TypeScript check: passed.
- `git diff --check`: passed.
- Worker construction remains the required module-worker URL and no
  `d3-force` import exists.
- Full frontend suite: 93 passed, 5 failed. The five failures remain the same
  legacy `src/__tests__/integration.test.tsx` graph/progress contract cases.

### Commit

- `f163a81` — `fix: harden grouped layout worker lifecycle`
