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
