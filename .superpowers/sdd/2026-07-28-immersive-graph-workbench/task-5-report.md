# Task 5 Report — Persistent graph node inspector

## Status

Complete.

## Summary

- Replaced the legacy double-click detail drawer with one persistent inspector driven solely by `selectedNodeId`.
- Put the inspector in the desktop workbench's 360px grid column. It remains in layout without an overlay and shows graph counts plus “选择一个节点查看详情” before selection.
- Added the selected-node overview, complete ID, source table, degree, formatted field values (including `NULL` and indented object JSON), and raw direct-edge relationship metadata.
- Relationship items expose the other endpoint, labels, and confidence percentage, and select that endpoint when clicked.
- The same inspector becomes a fixed right-hand drawer only below the desktop breakpoint; its mobile close button clears `selectedNodeId` and is labelled “关闭节点详情”.
- Removed `detailPanelNodeId`, `openDetailPanel`, and `closeDetailPanel`; canvas click and keyboard selection continue to use `selectedNodeId`.

## Commit

`feat: add persistent graph node inspector`

## Verification

- `npm test -- --run src/components/__tests__/NodeDetailPanel.test.tsx src/__tests__/integration.test.tsx` — 2 files, 16 tests passed.
- `npm test` — 9 files, 55 tests passed.
- `npm run build` — passed.
- `npm run lint` — passed with no lint findings.
- `git diff --check` — passed.

## Self-review

- Desktop and mobile share a single inspector DOM instance, so responsive styles do not duplicate detail content in the accessibility tree.
- No desktop backdrop or fixed desktop drawer remains; the 360px column stays in normal grid flow.
- Direct relationship rows are derived from raw edges, preserving their labels and confidence rather than relying on node degree or a deduplicated neighbor list.
- The inspector does not invoke `requestFitView`, preserving its existing whole-canvas meaning.

## Follow-up concerns

- jsdom emits existing “Not implemented: navigation to another Document” notices during the full suite; the suite still exits successfully.
