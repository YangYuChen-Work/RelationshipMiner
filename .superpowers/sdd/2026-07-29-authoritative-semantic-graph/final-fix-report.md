# Authoritative semantic graph — final fix report

Date: 2026-07-30

Starting revision: `1949ca5`

## Outcome

The five Important findings in `final-review-findings.md` are covered by
regression tests and fixed in one production wave:

1. Structural relation rows are accepted only when their resolved endpoints
   belong to different selected business tables. Same-class endpoints remain
   discoverable across different tables.
2. One canonical entity edge can own multiple ordered relations. Evidence is
   merged only into a relation with the same ordered endpoints, direction,
   relation type, and strength, so reverse-row evidence cannot be attached to
   the wrong relation.
3. Relation-table discovery filters on selected endpoint IDs in safe chunks,
   streams bounded row batches, checks the cooperative deadline while querying
   and merging, preserves already-resolved edges on interruption, and applies
   a MySQL `MAX_EXECUTION_TIME` hint from the remaining structural-phase
   budget. Analyzer orchestration reserves time inside the existing public
   budget for the cooperative partial result and final assembly.
4. `SemanticJudge` treats an upstream `DeadlineExceeded` as an incomplete
   stream boundary. It retains completed decisions/outcomes, records a pending
   remainder, and finishes/cancels workers through the existing bounded
   coordinator. The analyzer consequently retains completed weak edges and
   reports partial diagnostics.
5. The layout client posts a compact readonly DTO containing only layout
   fields. Full dimensions, explanations, evidence, and supporting-edge
   payloads remain on the main thread. The client allows one Worker request in
   flight and keeps only the latest queued request, rejecting superseded queued
   work as stale while retaining late-response protection.

The optional projection-aggregate cleanup and Worker recreation changes were
not included; neither was needed to close the five findings, and adding them
would have expanded the final fix wave.

## TDD evidence

The following RED results were recorded before production changes:

| Boundary | RED result | Expected failure demonstrated |
| --- | ---: | --- |
| Structural resolver | 3 failed, 7 passed | same-table row leaked, same-class cross-table row was missed, reverse evidence was merged into the wrong relation, and relation queries were not ID-bounded/stream-deadline-aware |
| Analyzer | 2 failed, 20 passed | same-table structural row leaked and an upstream retrieval deadline discarded the completed weak result |
| Semantic judge | 1 failed, 26 passed | upstream `DeadlineExceeded` escaped and discarded the batch |
| Layout client | 2 failed, 15 passed | every request was posted and the full heavy graph crossed the Worker boundary |
| Graph Canvas | 2 failed, 25 passed | heavy entity/relation payloads crossed the boundary and resize bursts posted every request |

The focused GREEN checks after the production wave were:

```text
uv run --directory backend pytest tests/semantic/test_structural_relations.py -q
10 passed

uv run --directory backend pytest tests/semantic/test_judge.py tests/semantic/test_analyzer.py -q
49 passed

npm --prefix frontend test -- --run src/graph/layout.test.ts
17 passed

npm --prefix frontend test -- --run src/components/__tests__/GraphCanvas.test.tsx
27 passed
```

One pre-existing deadline assertion was tightened to match the new cooperative
merge boundary: once the test clock expires after the first resolved pair, one
relation-table evidence item is retained instead of allowing the rest of that
batch to merge.

## Fresh full verification

```text
uv run --directory backend pytest -q
239 passed in 20.90s

npm --prefix frontend test -- --run
21 files passed; 160 tests passed

npm --prefix frontend run lint
exit 0

npm --prefix frontend run build
TypeScript and Vite production build exited 0

git diff --check -- backend frontend
exit 0
```

## Count-only real acceptance and evidence hygiene

The existing aggregate-only audit was parsed without printing any entity ID,
display name, dimension, endpoint value, relation evidence, node, or edge
payload. Its established acceptance counts remain:

| Metric | Count |
| --- | ---: |
| Tables | 4 |
| Entities | 7,056 |
| Table relationships | 5 |
| Entity relationships | 186 |
| Unique edge records | 186 |
| Unique directed pairs | 186 |

The three aggregate relation-type totals still sum to 186. Recursive key
validation found zero forbidden entity-level keys, and the deleted raw real
graph export remains absent. No raw entity export was recreated.

## Scope and staging hygiene

The user-owned `.gitignore` modification and untracked `.playwright-cli/` and
`output/` trees were neither edited nor staged. The final commit is limited to
the backend/frontend production changes, their regression tests, and this
report.

## Live all-column acceptance follow-up

A fresh real-database run exposed a dialect batching regression after the
review fix: applying SQLite's 400-ID chunk to MySQL repeated relation-table
queries enough to return only 127 partial edges in 119.05 seconds. A focused
RED/GREEN follow-up now keeps SQLite at 400 parameters while using a
MySQL-safe 10,000-ID batch.

The same four real tables with every column selected then completed in
13.94 seconds with 7,056 entities, 186 unique directed relations, 195
connected entities, 6,861 isolated entities, five table relationships, and
zero warnings. Family counts remained 35/87/41/22/1. Full verification after
the correction passed: backend 240, frontend 160, lint, build, and diff check.
