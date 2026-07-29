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
