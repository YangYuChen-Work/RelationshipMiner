# Handoff — ai-graph Issue #03 完成

**日期:** 2026-07-27
**分支:** master
**提交:** `1c8d7fc` — feat: integrate AI decision maker (DeepSeek) into analysis pipeline
**状态:** Issue #03 全部完成，经过 Code Review 并修复了所有发现项

---

## 本会话完成的工作

实施了 **03-ai-decision-maker** — 将 DeepSeek API 集成进分析流水线阶段 3：

### 后端新增

| 文件 | 用途 |
|------|------|
| `backend/engine/ai_decision_maker.py` | AI 决策者纯函数编排 — `decide_matches()` + 提示词构建 + 响应解析 + 校验 |
| `backend/engine/deepseek_client.py` | DeepSeek API 封装 — OpenAI 兼容 SDK |
| `backend/tests/test_ai_decision_maker.py` | 15 个单元测试 — mock DeepSeek API |

### 后端修改

| 文件 | 变更 |
|------|------|
| `backend/config.py` | 新增 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL` |
| `backend/engine/pipeline.py` | 阶段 3 替换空占位 → `decide_matches()` 调用 + `dataclasses.asdict()` 序列化 + 优雅降级 |
| `backend/requirements.txt` | 新增 `openai>=1.0,<2.0` |

---

## 关键设计决策

1. **依赖注入** — `decide_matches(table_schemas, sample_values, client=None)`，测试时注入 mock client，生产从环境变量创建 `DeepSeekClient`。

2. **优雅降级** — `decide_matches()` 内部 `try/except Exception` 捕获所有异常返回 `[]`，流水线继续执行 FK 分析。用户看到 "AI 服务暂不可用，跳过语义分析"。

3. **置信度程序级强制**（Code Review 修复）— `exact_match` 算法强制置信度为 1.0（确定性）；语义匹配（`edit_distance` / `numeric_difference`）若 AI 返回 ≥1.0 则截断至 0.95。不仅在提示词层面，在 `_validate_decisions()` 中硬编码保证。

4. **上下文感知提示词** — 系统提示明确：`users.name ≠ products.name`，基于表名+字段名组合判定语义。

5. **算法推荐存储但未执行** — AI 返回的 `algorithm` 字段（`edit_distance` / `numeric_difference`）传递至 `compute_relationships()`，但当前阶段 4 仅执行精确值相等匹配。相似度矩阵计算（编辑距离、数值差值比例）属于后续版本的扩展功能，MVP 的 Out of Scope 已注明。

6. **采样值** — 每表取 1 行作为 AI 上下文，避免 token 膨胀。类型标注为 `list[dict]` 保留未来扩展多行采样的空间。

7. **Markdown 代码块解析**（Code Review 修复）— 使用正则 `r"```(?:json)?\s*\n(.*?)```"` 提取 fence 内容，比原来的逐行 split 更稳健。

---

## 测试结果

```
50 passed (原有 35 + 新增 15 AI 决策者)
TypeScript: 编译通过
Vite build: 通过
```

新测试覆盖的接缝：
- 基本输入/输出契约（空输入、FieldMatchDecision 结构、必填字段）
- 上下文感知匹配（同名字段不同表区分、表名包含在 prompt 中）
- 算法推荐（已知算法白名单、语义置信度 < 1.0）
- 优雅降级（API 异常、无效 JSON、未配置 API Key、空响应）
- 提示词构建（字段类型、采样值、系统指令）

---

## 剩余 Issues

| Issue | 文件 | 状态 |
|-------|------|------|
| 01 | `01-project-scaffold-db-browse.md` | ✅ 完成 |
| 02 | `02-analysis-pipeline-progress.md` | ✅ 完成 |
| 03 | `03-ai-decision-maker.md` | ✅ 完成（本会话） |
| **04** | `04-graph-visualization-interactions.md` | **待开始** |
| 05 | `05-export-error-handling.md` | 待开始 |

---

## Issue #04 启动说明

Issue #04 需要构建前端 D3 力导向图谱与交互功能。关键集成点：

- **入口**: 前端 `GraphCanvas` 组件（尚未创建），消费 Zustand store 中的 `graph: GraphData`
- **数据来源**: WebSocket 最终消息中的 `{phase: 5, graph: {nodes, edges}}`，已在 store 中保存
- **依赖**: 后端已完成，`/api/analyze` + WebSocket 推送完整的 nodes + edges 数据
- **UI 模块**（来自 Spec）: `GraphCanvas`（D3 forceSimulation）、`NodeDetailPanel`（双击详情抽屉）、`StrengthFilter`（置信度滑块）

### 已知可改进项（不阻塞 #04）

- 前端 spinner 样式重复（`AnalysisLauncher` 和 `ProgressIndicator`），可提取 `<Spinner />` 组件
- `App.tsx` 中 `phase` 字符串联合类型被 4 处 switch，可考虑 phase-to-component map
- `test_ai_decision_maker.py` 中 AI 响应 fixture dict 重复出现在 4+ 测试中，可提取 `_make_ai_match()` 工厂函数

---

## 注意事项

- `.env` 已配置 MySQL 连接（`levault` 数据库），密码已由用户填入
- **需要添加 `DEEPSEEK_API_KEY`** 到 `.env` 才能启用 AI 语义分析
- Python 3.14.5 — 版本较新，部分包可能没有预编译 wheel
- 前端测试尚未建立（目前仅有后端 pytest）
- git 仓库已初始化，当前仅有一个根提交

---

## 建议的下一个会话

按顺序继续 Issue #04（图谱可视化与交互）。启动方式：

```
/implement @.scratch/ai-graph-mvp/issues/04-graph-visualization-interactions.md @docs/specs/0001-ai-graph-mvp.md
```

## 建议的技能

1. **`/implement`** — 实施 Issue #04
2. **`/tdd`** — 前端组件测试（Vitest + Testing Library）
3. **`/code-review`** — 完成后审查 diff
4. **`dataviz`** — D3 力导向图谱属于数据可视化，dataviz 技能提供图表颜色、无障碍、交互规范
