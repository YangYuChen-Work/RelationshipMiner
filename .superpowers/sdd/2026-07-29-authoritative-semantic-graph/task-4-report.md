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
