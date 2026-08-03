# Task 6 Report — Normalize business relationship labels and detail hierarchy

## Outcome

Implemented separate business relationship labels end to end while preserving raw `relation_type` for technical/export use. Planner output now carries `display_label`; the judge must echo it exactly; graph assembly normalizes the final public label without rewriting the raw type. The frontend uses one legacy-safe relationship presentation module in graph scenes and detail views, and the detail panel now mounts technical evidence and dimensions only after their respective disclosures are opened.

## RED

### Backend

Command:

```powershell
uv run --directory backend pytest tests/semantic/test_planner.py tests/semantic/test_judge.py tests/semantic/test_graph_builder.py -q
```

Observed expected failure: `7 failed, 56 passed`.

- `RelationshipPlan` and `EntityRelation` had no `display_label`.
- Judge response validation rejected the new label field and did not include it in the request contract.
- Graph assembly rewrote `business_relationship` to `语义关联`, violating raw-type preservation.
- No `normalize_relation_label()` existed.

### Frontend

Command:

```powershell
cd frontend
npm test -- --run src/graph/businessRelations.test.ts src/components/__tests__/NodeDetailPanel.test.tsx
```

Observed expected failure: both suites failed; the new business-relations module was absent and four detail-panel hierarchy assertions failed against the old technical-first UI.

## GREEN

### Focused backend

Command:

```powershell
uv run --directory backend pytest tests/semantic/test_planner.py tests/semantic/test_judge.py tests/semantic/test_graph_builder.py -q
```

Final output: `63 passed in 0.96s`.

### Focused frontend

Command:

```powershell
cd frontend
npm test -- --run src/graph/businessRelations.test.ts src/graph/scene.test.ts src/components/__tests__/NodeDetailPanel.test.tsx
```

Final output: `3 passed` test files, `29 passed` tests.

## Implementation notes

- Added `display_label: str = "相关"` to backend plan/decision/relation models.
- Updated planner example/instructions to keep `relation_type` stable and supply a 2–12-code-point Chinese business verb.
- Added a strict judge response field and equality validation against `group.plan.display_label`.
- Kept raw `relation_type` unchanged in graph output. The final display label is trimmed, capped at 12 code points, mapped for known structural categories, and falls back to `相关` for blank/generic/invalid values.
- Added optional `EntityRelationData.display_label` for legacy snapshots and included the backend-supported `relation_table` evidence method in the API type.
- Added `businessRelationLabel()` and `confidenceBand()`; raw snake_case/camelCase types never reach normal labels.
- Routed entity/table scene labels through business presentation and kept new generic labels from colliding with entity identities.
- Rebuilt `NodeDetailPanel` around shared entity presentations:
  - normal layer: business object names, business labels, explanation, confidence band, relation-local evidence;
  - `技术依据`: exact confidence, raw type, direction/strength, `class_name`, match method, model/task IDs, and supporting IDs;
  - `查看原始数据`: complete endpoint/node `dimensions`.
- Updated integration/renderer/canvas fixtures and assertions to the new business-first contract. One analyzer LLM fixture was updated to echo the planned label exactly.

## Files changed

### Backend production

- `backend/engine/semantic/models.py`
- `backend/engine/semantic/planner.py`
- `backend/engine/semantic/judge.py`
- `backend/engine/semantic/graph_builder.py`

### Backend tests

- `backend/tests/semantic/test_planner.py`
- `backend/tests/semantic/test_judge.py`
- `backend/tests/semantic/test_graph_builder.py`
- `backend/tests/semantic/test_analyzer.py`

### Frontend production

- `frontend/src/api/analysis.ts`
- `frontend/src/graph/businessRelations.ts`
- `frontend/src/graph/scene.ts`
- `frontend/src/components/NodeDetailPanel.tsx`

### Frontend tests

- `frontend/src/graph/businessRelations.test.ts`
- `frontend/src/graph/scene.test.ts`
- `frontend/src/graph/renderer.test.ts`
- `frontend/src/components/__tests__/NodeDetailPanel.test.tsx`
- `frontend/src/components/__tests__/GraphCanvas.test.tsx`
- `frontend/src/__tests__/App.graph-error.test.tsx`
- `frontend/src/__tests__/integration.test.tsx`

## Full verification

```powershell
uv run --directory backend pytest -q
```

Final output: `267 passed in 6.92s`.

```powershell
cd frontend
npm test -- --run
```

Final output: `26 passed` test files, `276 passed` tests.

```powershell
cd frontend
npm run lint
```

Output: exit 0, no lint findings.

```powershell
cd frontend
npm run build
```

Output: TypeScript build and Vite production build completed with exit 0; 610 modules transformed.

```powershell
uv run --directory backend python -m compileall -q engine
```

Output: exit 0.

```powershell
git diff --check
```

Output: exit 0, no whitespace errors.

## Self-review

- Confirmed raw `relation_type` is no longer rewritten in graph assembly.
- Confirmed planner label survives validation and judge substitution fails the entire group.
- Confirmed known deterministic categories receive Chinese labels and unknown categories fall back to `相关`.
- Confirmed legacy frontend normalization prefers `display_label`, recognizes explicit existing business labels, and never exposes unknown technical casing in the normal layer.
- Confirmed all normal connected-object text uses the shared Task 5 business presentation index.
- Confirmed technical fields are conditionally unmounted until `技术依据` opens and dimensions are conditionally unmounted until `查看原始数据` opens.
- Confirmed evidence rendering is scoped to each relation object.
- Confirmed unrelated `.superpowers/brainstorm/` remains untouched and unstaged.

## Concerns

No blocking concerns. The judge intentionally treats an omitted or substituted response `display_label` as invalid because the business label is now part of the planned contract. Legacy stored graph snapshots remain supported on the frontend because `display_label` is optional there.
