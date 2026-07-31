# AI Graph — AI 驱动关系图谱分析

Web 应用：连接 MySQL 数据库，选择表与字段，AI 自动发现数据间的隐藏关联，在交互式力导向星云图谱中探索。

## 功能概览

- **数据库浏览** — 连接 MySQL 后自动列出全部表与字段
- **灵活选择** — 勾选表（上限 10 张）与字段，系统自动识别主键、外键和 class_name 字段
- **三层关系发现** — Schema（外键）、数据（值精确相等）、语义（AI 推断字段匹配）
- **实时进度** — WebSocket 推送五阶段分析进度
- **交互式星云图谱** — Canvas 渲染的力导向布局，支持缩放、拖拽、拖拽锁定节点
- **悬停聚焦** — 鼠标悬停节点时高亮一跳邻域，其余节点/边淡出
- **节点详情** — 双击节点查看全部字段原始值及关联节点列表
- **置信度筛选** — 连续滑块（0.0–1.0）动态过滤边
- **JSON 导出** — 一键下载完整快照（图谱数据 + 原始数据 + 分析配置 + 布局坐标）
- **友好错误处理** — 数据库连接失败、AI 服务不可用、分析超时均返回中文提示

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript 6 + Canvas 2D + D3.js + Tailwind CSS 4 + Zustand 5 |
| 后端 | Python 3.12 + FastAPI + SQLAlchemy + NumPy + Sentence Transformers |
| AI | DeepSeek API (deepseek-v4-flash) + BAAI/bge-small-zh-v1.5 |
| 数据库 | MySQL (SQLAlchemy 反射) |
| 测试 | 481 tests (Pytest 240 + Vitest 241) |

## 快速开始

### 1. 配置环境

```powershell
cp .env.example .env
```

编辑 `.env`，填入数据库和 DeepSeek API 配置。

### 2. 安装依赖

需要 Python 3.12，使用 uv 管理后端依赖：

```powershell
uv sync
```

```powershell
cd frontend
npm ci
```

### 3. 启动

**后端**（端口 8001）：

```powershell
uv run --directory backend uvicorn main:app --reload --port 8001
```

**前端**（端口 5173）：

```powershell
cd frontend
npm run dev
```

### 4. 使用

1. 打开 http://127.0.0.1:5173
2. 左侧面板自动加载数据库表列表
3. 勾选要分析的表（≤10 张），展开后勾选参与分析的字段
4. 点击"开始分析"，等待分析完成（≤3 分钟）
5. 在星云图谱中交互探索关系

## 测试

```powershell
# 后端 (240 tests)
uv run --directory backend pytest

# 前端 (241 tests)
cd frontend
npm test

# 完整验证
uv run --directory backend pytest; cd frontend; npm test -- --run; npm run build
```

## 项目结构

```
ai-graph/
├── backend/                    # FastAPI 后端
│   ├── engine/                 # 分析引擎
│   │   └── semantic/           # 语义分析核心模块
│   ├── routers/                # API 路由（tables, analyze）
│   ├── models/                 # Pydantic 数据模型
│   ├── tests/                  # 后端测试（240 tests）
│   ├── config.py               # 环境配置加载
│   ├── database.py             # 数据库连接管理
│   └── main.py                 # FastAPI 应用入口
├── frontend/                   # React 前端
│   ├── src/
│   │   ├── api/                # 后端 API 客户端
│   │   ├── components/         # React 组件（13 个）
│   │   ├── graph/              # 图谱布局、渲染、命中测试
│   │   ├── store/              # Zustand 状态管理
│   │   └── test/               # 测试 Fixture
│   └── visual-test.html        # 可视化回归测试工具
├── docs/
│   ├── specs/                  # 产品规格说明
│   └── superpowers/            # 实现计划与设计文档
├── scripts/                    # 性能基准测试脚本
├── .env.example                # 环境变量模板
├── CONTEXT.md                  # 领域术语表
├── CHANGELOG.md                # 版本记录
└── pyproject.toml              # Python 项目配置
```

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 健康检查（就绪/降级） |
| `/api/tables` | GET | 返回数据库所有表名 |
| `/api/tables/{name}/fields` | GET | 返回指定表的字段列表 |
| `/api/analyze` | POST | 提交分析任务，返回 task_id |
| `/ws/analyze/{task_id}` | WS | 分析进度推送 + 最终图谱数据 |
| `/api/export/{task_id}` | GET | 导出 JSON 完整快照 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DB_HOST` | localhost | MySQL 主机地址 |
| `DB_PORT` | 3306 | MySQL 端口 |
| `DB_USER` | root | 数据库用户名 |
| `DB_PASSWORD` | | 数据库密码 |
| `DB_NAME` | test | 数据库名称 |
| `DEEPSEEK_API_KEY` | | DeepSeek API 密钥（必填） |
| `DEEPSEEK_MODEL` | deepseek-v4-flash | DeepSeek 模型名称 |
| `DEEPSEEK_BASE_URL` | https://api.deepseek.com | API 基础地址 |
| `HF_HOME` | | Hugging Face 模型缓存目录 |
| `EMBEDDING_MODEL` | BAAI/bge-small-zh-v1.5 | 嵌入模型名称 |
| `EMBEDDING_BATCH_SIZE` | 256 | 嵌入批处理大小 |
| `LLM_CONCURRENCY` | 4 | LLM 并发调用数 |
| `RELATIONSHIP_PLAN_LIMIT` | 20 | 关系计划数量上限 |

## 分析流水线（5 阶段）

1. **数据读取** — SQLAlchemy 全量拉取选中表与字段
2. **Schema 分析** — 解析外键约束、唯一索引、字段类型元数据
3. **AI 决策** — DeepSeek 规划关系探测计划、判定语义字段匹配
4. **关系计算** — 全量执行精确值比较、外键追踪、语义相似度匹配
5. **图谱生成** — 组装节点与边，通过 WebSocket 推送完成事件

## 语义分析进阶

嵌入模型预加载（生产环境建议）：

```powershell
uv run --directory backend python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('BAAI/bge-small-zh-v1.5')"
```

性能基准测试（使用确定性假数据，不调用外部 API）：

```powershell
.\.venv\Scripts\python.exe scripts\benchmark_semantic_backend.py
cd frontend
npm test -- --run src/graph/scaling.test.ts
```

`/api/health` 仅返回 `ready`/`degraded` 状态和固定依赖项。它不会返回 API 密钥、数据库 URL、异常信息、提示词、响应内容或实体/字段值。
