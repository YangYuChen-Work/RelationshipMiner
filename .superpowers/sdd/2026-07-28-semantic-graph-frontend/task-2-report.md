# Task 2 Report — Semantic dimension selection

## RED

Updated the store and selection UI tests, then ran:

```powershell
npm --prefix frontend test -- --run src/store/analysis.test.ts src/components/__tests__/DatabaseTableAccordion.test.tsx src/components/__tests__/SelectionWorkspace.test.tsx
```

Expected failures: 5 tests failed because `isSystemColumn` did not exist, PK
and class-name fields were preselected and included by select-all, the two
system-field purpose labels were absent, and the old retention copy remained.

## GREEN

- Focused tests: 3 files, 29 tests passed.
- Focused TypeScript check of all six changed source/test files (with the
  project's Vitest and jest-dom types): passed.
- `git diff --check`: passed.

The selection store now starts every selected table with no dimensions,
select-all affects only ordinary dimensions, and request payloads are built
only from selected ordinary dimensions. Empty dimension selections remain
valid. PK/class metadata stays backend-owned; the UI renders it disabled and
unchecked with `自动用于实体 ID` and `用于节点展示` respectively.

## Commit

- `27bff5d551ca8768b9af877946dfe6e5b15c203b` — `feat: select semantic dimensions independently`

## Known cross-task failures

- Full frontend suite: 78 passed / 5 failed. All failures are existing
  `src/__tests__/integration.test.tsx` assertions using Task 1's retired
  numeric phases and legacy `nodes`/`edges` graph fixture/output expectations.
- `npm --prefix frontend run build` is blocked by the same incomplete Task 1
  graph-view migration (`GraphData` versus `SemanticGraphData`). No fallback
  was added because it is outside Task 2.

## Follow-up hardening

### RED → GREEN

- Added a stale/unknown-field regression: after selecting `email`, toggling
  PK, class metadata, or a field absent from the current table leaves
  `selectedFields` unchanged. RED showed `stale_field` being added.
- Added accessibility assertions that each disabled system-field checkbox has
  an `aria-describedby` value targeting its visible purpose text. RED showed
  no association.
- GREEN: the same three-file focused suite passed 29 tests; focused TypeScript
  and `git diff --check` passed.

### Commit

- `da0116bc5e430b56638aabb7caa7ac614b33f628` — `fix: guard stale field selections and describe system fields`
