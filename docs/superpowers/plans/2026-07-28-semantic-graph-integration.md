# Semantic Relationship Graph Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the backend analyzer and Canvas frontend work together on representative business relationships, expose model/index readiness, and lock down the 7000-entity performance and completeness guarantees.

**Architecture:** Add a deterministic end-to-end fixture using fake embedding/LLM adapters at the production seams, plus separate opt-in benchmarks for local BGE retrieval and a real configured DeepSeek account. Extend health and runbook output so missing model files, model failures, partial completion, and true zero-relation results are operationally distinguishable.

**Tech Stack:** pytest, FastAPI TestClient/WebSocket, Vitest/Testing Library, PowerShell-compatible benchmark scripts, existing React/FastAPI application.

## Global Constraints

- Execute only after the backend and frontend plans are complete.
- Deterministic CI tests must not call external DeepSeek or download Hugging Face models.
- Real-model benchmarks are opt-in and must never expose database values in logs.
- 7000-entity acceptance target is 180 seconds; budget exhaustion must return `partial`.
- A true empty graph is valid only when every candidate group completed.

---

### Task 1: Representative end-to-end semantic fixtures

**Files:**
- Create: `backend/tests/fixtures/semantic_business_data.py`
- Create: `backend/tests/fixtures/semantic_llm_responses.py`
- Create: `backend/tests/semantic/test_end_to_end.py`
- Modify: `frontend/src/__tests__/integration.test.tsx`

**Interfaces:**
- Consumes: production `RelationshipAnalyzer` interface and final WS JSON.
- Produces: deterministic proof of creator/operator and process/part relationships.

- [ ] **Step 1: Define the exact fixture**

Include:

- requirement created by 张三;
- operation performed by 张三;
- a different 张三 with a different employee number;
- one rotor assembly process;
- three related rotor parts;
- one textually similar but unrelated part.

Fake planner output must create `人员行为` and `工艺涉及零件` plans. Fake judge output must accept the correct person/action and three process/part links, while rejecting the different person and unrelated part.

- [ ] **Step 2: Write the backend E2E test**

Submit selected dimensions through `/api/analyze`, consume WS until terminal status, and assert:

```python
assert result["status"] == "complete"
assert len(result["graph"]["table_edges"]) == 2
assert relation_types(result) == {"人员行为", "工艺涉及零件"}
assert every_weak_relation_has_evidence(result)
```

- [ ] **Step 3: Run E2E tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_end_to_end.py -q`

Expected: PASS.

- [ ] **Step 4: Mirror the final payload in frontend integration**

Assert table edges render at overview zoom and focusing `工艺涉及零件` makes the three supporting entity relations available in the evidence panel.

- [ ] **Step 5: Commit**

```powershell
git add backend/tests/fixtures backend/tests/semantic/test_end_to_end.py frontend/src/__tests__/integration.test.tsx
git commit -m "test: cover semantic relationship workflow"
```

---

### Task 2: Readiness and safe diagnostics

**Files:**
- Modify: `backend/main.py`
- Modify: `backend/config.py`
- Create: `backend/engine/semantic/readiness.py`
- Modify: `backend/tests/test_analyze.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: configured embedding model and DeepSeek adapter.
- Produces: `/api/health` readiness details without secrets or entity values.

- [ ] **Step 1: Write health-contract tests**

Assert the response distinguishes:

```json
{
  "status": "degraded",
  "database": "ready",
  "embedding_model": "missing",
  "llm": "configured"
}
```

No API key, DB URL, prompt, response text, or field value may appear.

- [ ] **Step 2: Run health tests**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests\test_analyze.py -k health -q`

Expected: FAIL until readiness reporting exists.

- [ ] **Step 3: Implement readiness and runbook**

Check configuration and local model cache without making a paid LLM call. Document first model download, cache directory, DeepSeek model, JSON mode, `LLM_CONCURRENCY=4`, `EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`, and partial-result troubleshooting.

- [ ] **Step 4: Run health tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/main.py backend/config.py backend/engine/semantic/readiness.py backend/tests/test_analyze.py README.md
git commit -m "feat: report semantic analysis readiness"
```

---

### Task 3: 7000-entity retrieval and rendering benchmarks

**Files:**
- Create: `scripts/benchmark_semantic_backend.py`
- Create: `frontend/src/graph/scaling.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: retrieval module, grouped layout, scene builder.
- Produces: repeatable local performance evidence without external APIs.

- [ ] **Step 1: Implement the backend benchmark**

Generate 7000 synthetic documents across seven tables, ten relationship plans, and deterministic fake embeddings. Measure corpus build, index build, and Top-K retrieval. Assert candidate count is bounded by:

```python
assert candidates <= entities * max_plans_per_source * top_k
assert explicit_pair_count == 0
```

Print timings and counts only.

- [ ] **Step 2: Implement the frontend scaling test**

Build layout and scene for 7000 entities. Assert table regions are at most 10, overview scene has zero entity labels, and the renderer contract requires one canvas rather than entity DOM elements.

- [ ] **Step 3: Run benchmarks**

Run:

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_semantic_backend.py
Set-Location frontend
npm test -- --run src/graph/scaling.test.ts
```

Expected: both exit 0 and report bounded candidate/scene sizes.

- [ ] **Step 4: Document the repeatable commands**

Add a “性能验收” section to README with the commands and clarify that real DeepSeek latency is measured separately because it depends on account/service conditions.

- [ ] **Step 5: Commit**

```powershell
git add scripts/benchmark_semantic_backend.py frontend/src/graph/scaling.test.ts README.md
git commit -m "perf: verify 7000-entity graph scaling"
```

---

### Task 4: Final cross-stack verification

**Files:**
- Verify: `backend/tests/`
- Verify: `frontend/src/`
- Verify: `scripts/benchmark_semantic_backend.py`

**Interfaces:**
- Consumes: completed backend, frontend, and integration tasks.
- Produces: a release-ready verification record.

- [ ] **Step 1: Run backend verification**

Run: `.\.venv\Scripts\python.exe -m pytest backend\tests -q`

Expected: PASS.

- [ ] **Step 2: Run frontend verification**

Run:

```powershell
Set-Location frontend
npm test
npm run lint
npm run build
```

Expected: PASS for all commands.

- [ ] **Step 3: Run scaling verification**

Run the two commands from Task 3 Step 3.

Expected: PASS with 7000 entities and bounded candidates.

- [ ] **Step 4: Run repository checks**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; status contains only intentional changes for this task.

- [ ] **Step 5: Record the verification result**

Add the exact commands, pass counts, build result, and benchmark counts to the implementation handoff message. If a command fails, stop this task and create a bounded fix task naming the failing command and exact files before changing source; do not make opportunistic fixes inside verification.
