# Task 8 Report — RelationshipAnalyzer orchestration and API integration

## Takeover

This task was taken over from an unfinished dirty worktree based on
`cc64d53780e40ce30c41ed349087a5440c438551`. The prior work already added the
analyzer and its focused tests, but had not migrated the API tests and had
removed important compatibility/error behaviour while replacing the legacy
pipeline.

## RED → GREEN

- Initial focused run: analyzer tests passed (5), while the unchanged
  `test_analyze.py` had 16 failures and 10 passes. The failures covered the
  terminal WebSocket contract, graph shape, progress protocol, export, and
  legacy error messages.
- Migrated every original `test_analyze.py` test function (21 retained) to the
  Task 8 semantic graph contract; added 3 API contract tests for
  `dimensions`/`fields`, optional `class_name`, and terminal failed results.
- Updated the three obsolete pipeline-bound corpus tests to exercise the new
  public analyzer behaviour rather than removed legacy collaborators.
- Final focused run (`test_corpus`, `test_analyzer`, `test_analyze`): 38 passed.
- Final backend run: **151 passed**. This is the 143-test baseline plus Task 8
  coverage (including 5 analyzer orchestration tests and 3 new API contract
  tests). `test_analyze.py` now contains 24 test functions.

## Production diff audit

- The old five-stage equality pipeline is intentionally replaced by the deep
  `RelationshipAnalyzer` boundary. The compatibility entry point and legacy
  `fields` input remain; it maps selections to `dimensions`.
- Removed mock-only legacy branches from `pipeline.py`; they bypassed the
  semantic analyzer and were not valid production behavior.
- Preserved the Chinese timeout text and API validation/error messages, unknown
  task WebSocket error plus close, export 404/400 behavior, and final socket
  close.
- The final WebSocket payload is exactly the semantic contract:
  `phase=complete`, `progress=1`, `status`, four graph collections,
  diagnostics, and warnings. Unexpected failures also produce that terminal
  failed payload rather than a silent close.
- The task registry stores the same `AnalysisResult` object used for the final
  message. Export serializes that result as a projection, so it cannot diverge
  from the streamed graph.
- The analyzer keeps one monotonic deadline, checks each bounded stage,
  preserves representative-to-concrete signature expansion, and reports
  failed/pending judgement work as partial/failed rather than successful empty
  analysis.

## Verification

```text
.\.venv\Scripts\python.exe -m pytest backend\tests\semantic\test_corpus.py backend\tests\semantic\test_analyzer.py backend\tests\test_analyze.py -q  # 38 passed
.\.venv\Scripts\python.exe -m pytest backend\tests -q  # 151 passed
.\.venv\Scripts\python.exe -m compileall -q backend
git diff --check cc64d53780e40ce30c41ed349087a5440c438551 --
```

## Commit and concerns

- Task 8 commit: this report is committed together with the implementation;
  its final SHA is supplied by `git rev-parse HEAD` after commit.
- No real BGE model or DeepSeek request is used in tests. In an unconfigured
  production environment, planner/judgement failures are surfaced as a
  `partial` or `failed` result with warnings; deterministic FK work is kept.

## Fix round 1 — deadline and terminal delivery audit

- Added one cooperative `DeadlineExceeded` contract and threaded its callback
  through per-table corpus reads, keyword/vector target indexing, source query
  batches, retrieval loops, and the graph builder's document/node/edge loops.
  Checks occur before and after each unavoidable synchronous external call, so
  an overrun is reported immediately on return without leaving background CPU
  work behind.
- Planner calls now receive the true remaining budget through `asyncio.timeout`.
  A planner timeout cancels the await and returns a Chinese `failed` result
  without starting deterministic, retrieval, judgement, or graph stages.
- Actual deadline tests cover a slow first table read (the second read and
  planner do not start), a slow planner, deadline before graph assembly, a
  retrieval target batch that prevents query encoding, and graph-loop checks.
- The terminal WebSocket send is outside execution handling. The completed
  `AnalysisResult` is stored before `status=done`, then exactly one final send
  is attempted. Send failure records a delivery error and closes the socket;
  it cannot overwrite the computed result or emit a second failed terminal
  payload. A test observes export at send time to prove no `done` task lacks a
  result.
- Export error contracts are again structured and exact: missing/expired is
  `404 {detail, suggestion}`, pending is `400 {detail, suggestion}`.
- Removed the unused `AnalysisTimeoutError`; real timeout behavior is now
  exercised through the analyzer's terminal `partial`/`failed` result.

Verification for this round: focused deadline/API suites **57 passed**;
full backend **158 passed**; `compileall` and `git diff --check` passed.
