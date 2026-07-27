# Handoff — ai-graph Issue #02 完成

**日期:** 2026-07-27
**分支:** master（未初始化 git 仓库）
**状态:** Issue #02 全部完成，经过 Code Review 并修复了所有发现项

---

## 本会话完成的工作

实施了 **02-analysis-pipeline-progress** — 分析流水线 + 实时进度推送：

### 后端新增

| 文件 | 用途 |
|------|------|
| `backend/engine/__init__.py` | Engine 包 |
| `backend/engine/relationship_computer.py` | 关系计算引擎（纯函数）— FK 追踪 + 精确值相等 + NULL 处理 + 多重关系合并 |
| `backend/engine/schema_analyzer.py` | Schema 分析器 — FK 约束、索引、字段类型、class_name 识别 |
| `backend/engine/pipeline.py` | 5 阶段异步流水线 + 3 分钟超时 |
| `backend/routers/analyze.py` | `POST /api/analyze` + WebSocket `/api/ws/analyze/{task_id}` |
| `backend/tests/test_relationship_computer.py` | 关系计算引擎 16 个单元测试 |
| `backend/tests/test_analyze.py` | API + WebSocket 10 个集成测试 |

### 后端修改

| 文件 | 变更 |
|------|------|
| `backend/models/schemas.py` | 新增 `AnalyzeRequest/Response`、`TableSelection`、`NodeData`、`EdgeData`、`GraphData` |
| `backend/main.py` | 注册 analyze router |

### 前端新增

| 文件 | 用途 |
|------|------|
| `frontend/src/api/analysis.ts` | 分析任务提交 + WebSocket 连接 |
| `frontend/src/components/AnalysisLauncher.tsx` | 开始分析按钮（≥1 表 + class_name 校验） |
| `frontend/src/components/ProgressIndicator.tsx` | 5 阶段进度条 + 步骤指示器 |

### 前端修改

| 文件 | 变更 |
|------|------|
| `frontend/src/store/analysis.ts` | 新增分析生命周期状态、`patchSelectedTable` 辅助函数、class_name 验证 |
| `frontend/src/App.tsx` | 集成选择/分析中/完成/错误四种状态的渲染 |

---

## 关键设计决策

1. **WebSocket URL** — 实际路径为 `/api/ws/analyze/{task_id}`（router prefix `/api` 生效），前后端一致。Spec 中记为 `/ws/analyze/{task_id}`，属文档省略，非 bug。

2. **关系计算引擎** — 纯函数 `compute_relationships(records, pk_metadata, fk_constraints, ai_decisions)`，已预留 `ai_decisions` 参数供 Issue #03 接入。无 AI 决策时仅执行 FK 追踪，AI 决策到位后自动启用精确值相等匹配。

3. **AI 决策占位** — 阶段 3 当前返回空列表，前端展示 "语义分析完成（即将上线）"，不暴露内部实现细节。

4. **超时机制** — `pipeline.py` 内置 `AnalysisTimeoutError`，默认 180 秒，每个阶段之间检查 `check_timeout()`。

5. **class_name 验证** — 前端 store 层面强制 class_name 选中且不可取消；`startAnalysis()` 提交前二次校验。后端 POST 端点只验证表/字段存在性，不强制要求 class_name（允许无 class_name 的表参与其他关系发现，符合 Spec User Story 8）。

6. **跨数据库兼容** — 数据读取使用 SQLAlchemy `Table` 反射 + `select()`，避免原始 SQL 的反引号/双引号兼容问题。

7. **NULL 处理** — NULL 值不参与任何匹配，两个 NULL ≠ 相等。已通过 3 个单元测试验证。

---

## 测试结果

```
35 passed (原有 9 + 新增 16 关系计算 + 新增 10 API/WebSocket)
TypeScript: 编译通过
Vite build: 通过
```

---

## 剩余 Issues

| Issue | 文件 | 状态 |
|-------|------|------|
| 01 | `01-project-scaffold-db-browse.md` | ✅ 完成 |
| 02 | `02-analysis-pipeline-progress.md` | ✅ 完成（本会话） |
| **03** | `03-ai-decision-maker.md` | **待开始** |
| 04 | `04-graph-visualization-interactions.md` | 待开始 |
| 05 | `05-export-error-handling.md` | 待开始 |

---

## Issue #03 启动说明

Issue #03 需要接入 DeepSeek API 进行字段语义匹配。关键集成点：

- **入口**: `engine/pipeline.py` 阶段 3（行 ~98），当前 `ai_decisions = []`
- **消费者**: `engine/relationship_computer.py` 的 `ai_decisions` 参数，期望格式 `[{source_table, source_field, target_table, target_field, algorithm, confidence}]`
- **API**: DeepSeek API，通过 OpenAI 兼容 SDK 调用，配置在 `backend/.env`

### 已知未完成项（Code Review 发现但不阻塞 #03）

- 前端 spinner 样式重复（`AnalysisLauncher` 和 `ProgressIndicator`），可提取 `<Spinner />` 组件
- App.tsx 中 `phase` 字符串联合类型被 4 处 switch，可考虑 phase-to-component map

---

## 注意事项

- `.env` 已配置 MySQL 连接（`levault` 数据库），密码已由用户填入
- Python 3.14.5 — 版本较新，部分包可能没有预编译 wheel
- 项目尚未初始化 git 仓库（无 `.git` 目录）
- 前端测试尚未建立（目前仅有后端 pytest）

---

## 建议的下一个会话

按顺序继续 Issue #03（AI 决策者）。启动方式：

```
/implement @.scratch/ai-graph-mvp/issues/03-ai-decision-maker.md @docs/specs/0001-ai-graph-mvp.md
```

## 建议的技能

1. **`/implement`** — 实施 Issue #03
2. **`/tdd`** — AI 决策者模块的纯函数接口适合 TDD 驱动
3. **`/code-review`** — 完成后审查 diff
