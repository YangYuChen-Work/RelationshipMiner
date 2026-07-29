# ai-graph

## 环境安装

本项目使用 uv 管理 Python 3.12 虚拟环境和后端依赖。请在项目根目录执行：

```powershell
uv sync
```

uv 会读取 `.python-version`，自动使用 Python 3.12 并创建 `.venv`。不要使用全局
`pip install -r backend/requirements.txt`，否则 Windows 上的默认 Python 3.14 会尝试
从源码编译旧版 `pydantic-core` 并失败。

## 启动

后端：

```powershell
# 在项目根目录运行
uv run --directory backend uvicorn main:app --reload --port 8001
```

如果终端已经位于 `backend` 目录，则不要再次指定 `--directory backend`：

```powershell
uv run uvicorn main:app --reload --port 8001
```

如果命令提示当前激活的 `venv` 与项目的 `.venv` 不匹配，请先执行
`deactivate`。`uv run` 会自动使用项目根目录的 `.venv`，不要求手动激活环境。

前端：

```powershell
cd frontend
npm ci
npm run dev
```

后端健康检查地址为 <http://127.0.0.1:8001/api/health>，前端开发地址为
<http://127.0.0.1:5173>。

## 测试

```powershell
uv run --directory backend pytest
cd frontend
npm test
```

## Semantic relationship analysis prerequisites

HTTP/WebSocket analysis has one supported production path:
`RelationshipAnalyzer`. The old `decide_matches` and `compute_relationships`
helpers are deprecated, non-production pure-function compatibility code only.
Routers and the production pipeline do not call them, so there is no silent
legacy fallback.

- Semantic retrieval uses `BAAI/bge-small-zh-v1.5` by default. The first run
  downloads the model into the Hugging Face cache (set `HF_HOME` to choose its
  location), and Torch model loading has a cold-start cost. Pre-warm this cache
  in production.
- Planning and judgement use DeepSeek `deepseek-v4-flash` with JSON Output.
  Set `DEEPSEEK_API_KEY`; `DEEPSEEK_MODEL` and `DEEPSEEK_BASE_URL` can override
  the default model and endpoint.
- A complete analysis has a single 180-second budget and returns `complete`,
  `partial`, or `failed`. Timeouts and recoverable stage failures are explicit
  in the terminal WebSocket `warnings`; analysis never falls back silently.
- `class_name` metadata is optional. Select only semantic-analysis fields in
  `dimensions`; the service adds primary/foreign keys internally for identity
  and deterministic evidence.
- Around 7,000 entities, model loading, embedding, and LLM judgement need
  meaningful CPU/memory/network headroom. Keep dimensions focused, pre-warm
  BGE, and tune `EMBEDDING_BATCH_SIZE` and `LLM_CONCURRENCY` for the host.
