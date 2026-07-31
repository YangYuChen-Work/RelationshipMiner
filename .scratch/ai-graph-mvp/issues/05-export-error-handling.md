# 05 — 导出 + 异常处理 + 收尾

**What to build:** 图谱可导出为 JSON 完整快照下载。三大异常（数据库连接失败、AI 服务不可用、分析超时）均返回友好中文提示与操作建议。未发现关系时展示空状态提示 + 仅节点图谱。

**Blocked by:** 04 — 图谱可视化 + 全部交互

**Status:** complete

- [x] `GET /api/export/{task_id}` 返回 JSON 完整快照：graph（节点+边） + raw_data（所有字段值） + config（表/字段选择 + AI 决策） + layout（x/y 坐标）
- [x] 前端 ExportButton 触发 JSON 下载
- [x] 数据库连接失败：友好中文提示 + 操作建议
- [x] DeepSeek API 不可用：友好中文提示 + 不影响已完成的部分结果
- [x] 分析超时（3 分钟）：友好中文提示
- [x] 未发现关系时：空状态提示 + 仅节点的散落图谱
- [x] 集成测试覆盖三类异常路径
