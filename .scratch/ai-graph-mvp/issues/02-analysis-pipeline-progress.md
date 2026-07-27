# 02 — 分析流水线 + 实时进度

**What to build:** 用户勾选表和字段后点击"开始分析"，通过 WebSocket 实时看到 5 个阶段的进度，最终获得包含 FK 关系和精确值匹配关系的图谱 JSON 结果。此工单的流水线阶段 3（AI 决策）为空占位——AI 逻辑由工单 03 后续插入。

**Blocked by:** 01 — 项目脚手架 + 数据库浏览

**Status:** ready-for-agent

- [ ] `POST /api/analyze` 端点接收分析配置 `{tables: [{name, fields: []}]}`，返回 `{task_id}`
- [ ] 分析流水线完整串联 5 阶段：数据读取 → Schema 分析 → AI 决策（空占位）→ 关系计算 → 图谱生成
- [ ] Schema 分析阶段提取外键约束、索引、字段类型元数据
- [ ] 关系计算阶段输出 FK 追踪结果 + 精确值相等匹配结果
- [ ] 多重关系（FK + 值相等同时命中同一对记录）合并为单条边、标签拼接
- [ ] NULL 值不参与匹配，两个 NULL 不视为相等
- [ ] WebSocket `/ws/analyze/{task_id}` 实时推送 `{phase: int, message: string, progress: float}`，阶段顺序正确、进度单调递增
- [ ] 分析完成时 WebSocket 推送包含 graph JSON（nodes + edges）的消息
- [ ] 前端 AnalysisLauncher 校验选择（至少 1 张表、class_name 必选），通过后启用按钮
- [ ] 前端 ProgressIndicator 组件消费 WebSocket，展示当前阶段文本 + 进度条
- [ ] WebSocket 进度消息序列的测试覆盖
- [ ] 关系计算引擎纯函数的单元测试覆盖（输入记录集 → 输出节点/边）
