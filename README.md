# AI Graph — AI 驱动关系图谱分析

面向业务人员的 Web 应用：连接 MySQL 数据库，选择业务数据与辅助判断依据，AI 自动发现对象之间的隐藏关联，并以直观的业务名称和关系动词呈现。

## 功能概览

- **业务数据浏览** — 自动推测每张表的语义名称，同时保留原始表名、对象数量与名称示例供核对
- **判断依据分层** — `name` 与 `class_name` 始终作为主要关系判断上下文；用户只需选择其他辅助判断字段
- **三层关系发现** — Schema（外键）、数据（值精确相等）、语义（AI 推断字段匹配）
- **实时进度** — WebSocket 推送五阶段分析进度
- **业务关系图** — 浅色画布、实心彩色节点和节点下方名称，支持缩放、拖拽、拖拽锁定节点
- **悬停聚焦** — 鼠标悬停节点时高亮一跳邻域，其余节点/边淡出
- **业务优先详情** — 默认只展示对象名称、业务关系和说明，技术依据与原始数据按需展开
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
| 测试 | 571 tests (Pytest 277 + Vitest 294) |

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
2. 在“选择业务数据”中核对系统推测的语义名称、原始表名、对象数量和名称示例
3. 勾选要分析的业务数据（≤10 张），再选择用于辅助判断关系的字段
4. 点击“生成业务关系图”，等待分析完成（≤3 分钟）
5. 在业务关系图中按对象名称或业务代码查找并探索关系

完整流程：**选择业务数据 → 选择辅助判断依据 → 生成业务关系图**。

## 业务展示原则

- `name` 与 `class_name` 是主要关系分析上下文：`name` 标识业务对象，`class_name` 帮助系统判断对象类型。
- 正常界面只把 `name` 作为节点名称；`class_name`、表名、内部 ID 和模型任务信息不会作为普通节点标题。
- 用户勾选的其他字段仅作为辅助证据，用来支持或排除两个名称之间的关系。
- 同名对象仅在需要区分时显示第二行：优先使用推测出的业务代码，否则使用稳定的“同名 N”。唯一名称不显示代码。
- 关系边使用“用于检验”“包含”等简短业务动词；原始关系类型继续保留在“技术依据”中。
- 旧版快照缺少 `display_code` 或 `display_label` 时，系统优先读取安全的 `dimensions.name`，同名对象使用“同名 N”，未知关系显示“相关”。

## 测试

```powershell
# 后端 (277 tests)
uv run --directory backend pytest

# 前端 (294 tests)
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
| `/api/table-summaries` | GET | 返回表的语义名称、对象数量和名称示例 |
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
