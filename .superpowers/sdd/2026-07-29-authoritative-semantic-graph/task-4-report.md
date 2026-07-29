# Task 4 report — clustered semantic network

## Status

Implemented deterministic clustered/radial graph layout and semantic Canvas
rendering while preserving the worker boundary, one-Canvas architecture,
keyboard navigation, pointer hit testing, fit/focus behavior, and the full
store graph used by details/export.

## RED

Command:

```text
npm --prefix frontend test -- --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Recorded output (verbatim):

```text
> frontend@0.0.0 test
> vitest run --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx


 RUN  v4.1.10 D:/桌面/test/ai-graph/frontend

 ❯ src/graph/scene.test.ts (11 tests | 4 failed) 29ms
     × carries relation labels and solid-versus-dashed semantics on visible edge commands 10ms
     × uses stable table colors and scales connected entity nodes by graph degree 1ms
     × never emits table rectangle commands for the clustered network 3ms
     × does not resurrect table rectangles when normal camera panning makes x and y negative 2ms
 ❯ src/graph/layout.test.ts (16 tests | 3 failed) 42ms
     × places separated table anchors with their entities orbiting instead of emitting table rectangles 14ms
     × orders known process classes before stable fallback table IDs 2ms
     × places all 7,000 entities on finite expanding rings around ten anchors 12ms
 ❯ src/components/__tests__/GraphCanvas.test.tsx (22 tests | 1 failed) 843ms
     × uses the projected graph for worker layout, counts, search, and readiness identity 28ms

 Test Files  3 failed (3)
      Tests  8 failed | 41 passed (49)
   Start at  00:23:27
   Duration  6.50s (transform 331ms, setup 1.89s, import 1.44s, tests 914ms, environment 9.58s)
```

The failures were against the old rectangular table regions, alphabetical
anchor order, fixed entity radius, untyped/unlabelled edge commands, emitted
table-region scene commands, and full-graph worker input.

## GREEN

Focused command:

```text
npm --prefix frontend test -- --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Recorded output (verbatim):

```text
> frontend@0.0.0 test
> vitest run --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx


 RUN  v4.1.10 D:/桌面/test/ai-graph/frontend


 Test Files  3 passed (3)
      Tests  49 passed (49)
   Start at  00:30:27
   Duration  7.66s (transform 410ms, setup 2.27s, import 1.85s, tests 1.03s, environment 11.10s)
```

Full frontend command:

```text
npm --prefix frontend test -- --run
```

Recorded output (verbatim):

```text
> frontend@0.0.0 test
> vitest run --run


 RUN  v4.1.10 D:/桌面/test/ai-graph/frontend


 Test Files  21 passed (21)
      Tests  148 passed (148)
   Start at  00:29:58
   Duration  18.17s (transform 1.72s, setup 22.79s, import 17.23s, tests 11.59s, environment 155.50s)
```

Lint command and output (verbatim):

```text
> frontend@0.0.0 lint
> oxlint
```

Build command and output (verbatim):

```text
> frontend@0.0.0 build
> tsc -b && vite build

vite v8.1.5 building client environment for production...
transforming...✓ 603 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                          0.45 kB │ gzip:  0.29 kB
dist/assets/layout.worker-B5QMUHEs.js    3.00 kB
dist/assets/index-DhRTNwBi.css          32.91 kB │ gzip:  7.11 kB
dist/assets/index-BRJDBnlv.js          299.85 kB │ gzip: 94.38 kB

✓ built in 654ms
```

## Files

- `frontend/src/graph/layout.ts`
- `frontend/src/graph/layout.test.ts`
- `frontend/src/graph/scene.ts`
- `frontend/src/graph/scene.test.ts`
- `frontend/src/components/GraphCanvas.tsx`
- `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- `.superpowers/sdd/2026-07-29-authoritative-semantic-graph/task-4-report.md`

The pre-existing `.gitignore` modification was preserved and excluded from
Task 4 staging.

## Visual and data invariants

- `MEProcess`, `MEOperation`, `MEStep`, and `Assembly` anchors precede fallback
  table IDs; fallback ordering is stable.
- Table anchors are separated on a viewport-aware world grid. Entities occupy
  deterministic radial slots on expanding rings around their owning table.
- Connected entities are ordered by descending degree and then stable ID;
  identical projected inputs produce identical worker output.
- Layout and scene emit no table rectangles. Rendering remains a single Canvas
  with circular category anchors and entity dots.
- Table identity maps through a deterministic hash to a stable palette.
  Entities inherit their owning table color, and entity radius increases with
  graph degree.
- Strong relationships render solid. Weak/semantic-only relationships render
  dashed. Visible edge commands carry their relation label and line style.
- Edge labels appear at semantic zoom, prioritize strong relationships, and
  use deterministic collision filtering. Entity labels retain their existing
  zoom boundary and 500-label viewport cap.
- Confidence filtering does not mutate graph or layout inputs. Strong
  relationships remain visible at every confidence threshold.
- GraphCanvas uses `projectGraph` for worker layout, scene construction, fit
  bounds, visible counts, search, focus, keyboard targets, and readiness
  identity. The Zustand graph remains the complete snapshot for details and
  export; accessible summary text reports projected counts first and full
  counts as context when they differ.
- Pointer hit testing, edge selection, keyboard navigation, worker ownership,
  stale request rejection, DPR sizing, and one-RAF coalescing remain covered.
- Empty, zero-sized, reordered, unknown-owner, and 7,000-entity inputs remain
  finite and deterministic.

## Self-review and concerns

- Reviewed the complete Task 4 diff and ran `git diff --check`; no whitespace
  errors were found.
- The palette intentionally has eight colors, so unrelated table IDs can share
  a color after hashing. Color is stable by ID but not globally unique.
- Label collision width uses a deterministic character-width estimate instead
  of `measureText`, keeping scene construction pure and worker-independent.
  Very wide non-Latin glyphs may be conservatively imperfect, but labels remain
  bounded and decluttered.
- Opting into thousands of isolated entities necessarily creates large radial
  worlds. Auto-fit and the one-Canvas/label-cap constraints keep rendering
  bounded; the 7,000-entity path is covered by focused and integration tests.
- During the first full-suite run, older Canvas mocks without `setLineDash` and
  older scene fixtures without `color` exposed compatibility gaps. The drawing
  call and scene field are backward-compatible now; the fresh full run above is
  green.

## Fix Round 1/5

### RED

Command:

```text
npm --prefix frontend test -- --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Recorded output (verbatim):

```text
> frontend@0.0.0 test
> vitest run --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx


 RUN  v4.1.10 D:/桌面/test/ai-graph/frontend

 ❯ src/graph/scene.test.ts (14 tests | 3 failed) 54ms
     × derives mixed table-edge labels and style only from relations visible at the threshold 8ms
     × bounds dense edge labels and keeps them deterministic under input reordering 29ms
     × uses code-unit edge ID ordering for deterministic label priority 2ms
 ❯ src/components/__tests__/GraphCanvas.test.tsx (24 tests | 2 failed) 817ms
     × fits every opted-in entity in a 7000-node radial layout inside the viewport 40ms
     × focuses a mixed table edge using only supporting relations visible at the threshold 15ms

 Test Files  2 failed | 1 passed (3)
      Tests  5 failed | 49 passed (54)
   Start at  00:42:16
   Duration  6.44s (transform 322ms, setup 1.48s, import 1.47s, tests 898ms, environment 9.58s)
```

The failures proved the 0.25 fit floor clipped the large radial world, dense
labels were unbounded at 600, locale ordering prioritized `a-edge` before
`Z-edge`, aggregate labels leaked a filtered weak relation, and table-edge
focus included the same filtered weak support.

### GREEN

Focused command:

```text
npm --prefix frontend test -- --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx
```

Recorded output (verbatim):

```text
> frontend@0.0.0 test
> vitest run --run src/graph/layout.test.ts src/graph/scene.test.ts src/components/__tests__/GraphCanvas.test.tsx


 RUN  v4.1.10 D:/桌面/test/ai-graph/frontend


 Test Files  3 passed (3)
      Tests  53 passed (53)
```

Full frontend command:

```text
npm --prefix frontend test -- --run
```

Recorded output (verbatim):

```text
> frontend@0.0.0 test
> vitest run --run


 RUN  v4.1.10 D:/桌面/test/ai-graph/frontend


 Test Files  21 passed (21)
      Tests  152 passed (152)
```

Lint command:

```text
npm --prefix frontend run lint
```

Recorded result: exit 0, `oxlint` emitted no findings.

Build command:

```text
npm --prefix frontend run build
```

Recorded result: exit 0; TypeScript and Vite completed, transforming 604
modules and emitting the worker and production bundles.

### Changed files

- `frontend/src/components/GraphCanvas.tsx`
- `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- `frontend/src/graph/semantics.ts`
- `frontend/src/graph/layout.ts`
- `frontend/src/graph/layout.test.ts`
- `frontend/src/graph/scene.ts`
- `frontend/src/graph/scene.test.ts`
- `frontend/src/graph/hitTest.test.ts`
- `frontend/src/graph/scaling.test.ts`
- `.superpowers/sdd/2026-07-29-authoritative-semantic-graph/task-4-report.md`

The pre-existing `.gitignore` edit remains preserved and outside Task 4
staging.

### Correctness and runtime reasoning

- Fit computes the scale from every projected table/entity point plus world
  padding, clamps it to the valid `0.02..2.5` zoom domain, and uses the same
  lower bound for D3 zoom. The 7,000-node regression checks all transformed
  points remain inside the 960x600 viewport and proves the required scale is
  below 0.25.
- Edge-label candidates retain deterministic priority through code-unit ID
  sorting. Accepted labels are capped at 200 and indexed into fixed
  screen-space buckets. Collision checks inspect only neighboring bucket
  occupants instead of every previously accepted label.
- Label work is `O(E log E)` for deterministic sorting plus bounded local
  collision checks; label-index memory is bounded by the 200-label cap. It no
  longer has the prior `O(E²)` accepted-label scan.
- Label width is capped and bucket coordinates must be safe integers with a
  bounded span. This prevents enormous but finite geometry from creating an
  unincrementable bucket loop; the regression keeps the edge but skips its
  unsafe label.
- Table-edge label/style derives from threshold-visible relations on
  resolvable supporting entity edges. Strong support remains solid while a
  below-threshold weak relation contributes neither label nor focus geometry.
- Table-edge focus filters supporting IDs through the same
  `visibleEntityRelations` helper before calculating bounds.
- `computeEntityDegrees` now has one implementation in `graph/semantics.ts`
  and is consumed by both worker-side layout and main-thread scene building.
- A repository-wide source check found no unchanged production consumer of
  `TableRegion`, `SceneTableRegion`, or `tableRegions`. Those dead types and
  fields were removed, and only directly affected test fixtures changed.
- Layout still executes in the existing Web Worker; rendering remains one
  Canvas with spatial hit indexes and no per-node DOM.

### Self-review and concerns

- `git diff --check` is clean, and repository-wide searches return no
  `tableRegions`, `TableRegion`, `SceneTableRegion`, `localeCompare`, or
  duplicated degree helper.
- An initial full-suite attempt exposed a new OOM in the existing
  `Number.MAX_VALUE` hit-test case. Diagnosis showed an unsafe bucket index
  could not change when incremented. Safe-integer/span guards fixed the cause;
  the isolated hit-test suite is 10/10 and the subsequent full suite is
  152/152.
- Aggregate table edges with no resolvable supporting entity edge retain the
  existing aggregate-field fallback so table-only evidence remains visible.
  When supporting edges are present, only their visible relation semantics are
  used.
- The global 200 edge-label cap intentionally favors deterministic strong and
  table-level labels over showing every label in dense scenes.
