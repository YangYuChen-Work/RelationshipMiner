# Task 7 Report: Visual Fixtures, Responsive Verification, and Full Regression

## Scope

Implemented Task 7 only:

- Added deterministic 20-entity and 200-entity semantic graph fixtures.
- Added a development-only visual harness at `visual-test.html`.
- Reused the fixtures in layout and Canvas regression tests.
- Added harness-only responsive styling and focus controls.
- Captured and inspected initial, hover, and selected states at all required
  viewport sizes.

No backend, API, store, production entry, graph renderer, or layout API was
changed. `src/main.tsx` does not import the visual harness.

## TDD evidence

Initial RED:

```powershell
npx vitest run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Result:

```text
Test Files  2 failed | 1 passed (3)
Tests       20 passed (20)
```

Both failing suites reported the expected missing
`src/test/nebulaFixtures.ts` module. The already-independent scene suite
remained green.

The fixture topology mutation check removed its self-loop temporarily:

```powershell
npx vitest run src/graph/layout.test.ts -t "required semantic topology"
```

Result:

```text
Tests  2 failed | 32 skipped (34)
AssertionError: expected false to be true
```

Restoring the self-loop returned the focused topology tests to green.

The absent harness produced a second expected RED:

```powershell
npx vitest run src/components/__tests__/GraphCanvas.test.tsx -t "visual fixture"
```

Result: the suite failed to resolve `src/test/NebulaVisualHarness.tsx`.
After implementation, the focused harness regression passed 1/1.

The first 390x844 screenshot exposed routine relationship labels competing
with entity identities. A regression derived label bounds from the real
20-node mobile scene:

```powershell
npx vitest run src/components/__tests__/GraphCanvas.test.tsx -t "mobile fixture"
```

RED observed 8 routine edge-label/entity-label overlaps. The fixture now keeps
routine relationships visually unlabeled while retaining their strong/weak
edge geometry; cross-table bridge and self-loop semantics remain labeled.
The same regression then passed with 0 overlaps.

Final focused result:

```text
Test Files  3 passed (3)
Tests       94 passed (94)
```

Coverage includes:

- required four-table, two-component, strong/weak, bridge, and self-loop
  topology at 20 and 200 nodes;
- deterministic layout and non-ring radial metrics at both sizes;
- strong-edge distance, disconnected-component whitespace, and meaningful
  fallback identities for every backend `display_name: "0"`;
- overview/work semantic layer dominance;
- exact `0.16` unrelated-node and `0.06` unrelated-edge focus opacity;
- hover and selection state changes without additional Worker layout requests;
- responsive harness query selection and deterministic controls.

## Browser verification

Vite ran at `http://127.0.0.1:4178`. The bundled Playwright wrapper was
attempted first, but its CRLF line endings were rejected by the available Bash
runtime. The equivalent documented CLI was run directly through:

```powershell
npx --yes --package @playwright/cli playwright-cli
```

Each navigation or viewport change was followed by a fresh snapshot before
using element references.

Artifacts are under `frontend/output/playwright/`:

- `20-1920x1080-{initial,hover,selected}.png`
- `20-1366x768-{initial,hover,selected}.png`
- `20-390x844-{initial,hover,selected}.png`
- `200-1920x1080-{initial,hover,selected}.png`
- `200-1366x768-{initial,hover,selected}.png`
- `200-390x844-{initial,hover,selected}.png`
- `20-390x844-initial-before-routine-label-fix.png`

Findings:

- Both fixture sizes form irregular, non-ring clusters rather than equal-angle
  circles or a grid.
- The two disconnected components retain clear whitespace, and table colors
  form soft groups without hard containers.
- Strong relationships form local chains while the cross-table bridge sits
  naturally between table groups.
- Initial labels include meaningful names and item codes; no entity uses `0`
  as its rendered primary identity.
- Aggregate and entity relationships remain visually separated by semantic
  opacity.
- Hover and selection isolate the bridge node, its single direct neighbor, and
  the incident relationship. Unrelated content dims visibly.
- Active two-line labels and the focused relationship-label backing are
  readable at all three viewports.
- The 200-node mobile initial view is necessarily dense, but collision culling
  preserves meaningful identities and the focused states remain unambiguous.
- Fresh-page browser console result: 0 errors, 0 warnings.

Reduced motion was verified in the real browser with emulated
`prefers-reduced-motion: reduce`:

```text
matchMedia(...).matches = true
transitionDuration = "0s"
animationName = "none"
```

## Final verification

Commands run from `frontend/`:

```powershell
npm test
npm run lint
npm run build
git diff --check
```

Results:

- Full frontend: 25 files, 241/241 tests passed.
- Oxlint: exit 0 with no warnings.
- TypeScript and Vite production build: exit 0.
- `git diff --check`: exit 0; Git emitted only the repository's existing
  LF-to-CRLF working-copy notices.

## Concerns

The screenshot artifacts intentionally remain untracked under
`frontend/output/playwright/`; the Task 7 source and report commit does not add
 generated browser output.
