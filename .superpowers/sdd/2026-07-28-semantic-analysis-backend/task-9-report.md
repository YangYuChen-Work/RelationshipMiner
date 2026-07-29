# Task 9 Report - Backend migration verification and cleanup

## RED / Green result

The new focused migration test was initially **Green**: Task 8 had already
migrated the public path to `router -> run_analysis_pipeline ->
RelationshipAnalyzer`. No artificial Red was created. The test proves this via
a real HTTP task submission and WebSocket completion while both legacy
functions (`decide_matches` and `compute_relationships`) are patched to raise.
It injects a real `RelationshipAnalyzer` with deterministic test adapters and
asserts a `complete` terminal graph result.

## Production call-path audit

- `routers/analyze.py` calls `engine.pipeline.run_analysis_pipeline` only.
- `engine/pipeline.py` constructs and awaits `RelationshipAnalyzer` only.
- `schema_analyzer.FKConstraint` is now the production schema metadata type;
  `semantic/deterministic.py` imports it from that module.
- `git grep` found no production imports of `ai_decision_maker` or
  `relationship_computer`, and no production calls to `decide_matches` or
  `compute_relationships`.
- The legacy modules remain explicitly marked `__deprecated__` for direct
  pure-function compatibility tests. They are not a router/pipeline fallback.

## Tests and checks

```text
.venv\\Scripts\\python.exe -m pytest backend\\tests\\test_analyze.py -k semantic_analyzer_only -q  # 1 passed
.venv\\Scripts\\python.exe -m pytest backend\\tests\\test_relationship_computer.py backend\\tests\\semantic\\test_deterministic.py -q  # 28 passed
.venv\\Scripts\\python.exe -m pytest backend\\tests -q  # 162 passed
.venv\\Scripts\\python.exe -m compileall -q backend  # passed
git diff --check  # passed
```

## Documentation and concerns

README now documents BAAI/bge-small-zh-v1.5 first download/cache and Torch
cold start, DeepSeek `deepseek-v4-flash` JSON Output/API key, the 180-second
`complete`/`partial`/`failed` contract, optional `class_name`, focused
`dimensions`, and capacity considerations near 7,000 entities.

No network model or DeepSeek API call is made by tests. Production deployments
still need `DEEPSEEK_API_KEY`, model cache access, and capacity appropriate to
the selected data size. The Task 9 commit SHA is the commit containing this
report (obtain it with `git rev-parse HEAD`).
