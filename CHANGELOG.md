# CHANGELOG

## v1.0.0 — MVP (2026-07-31)

### 核心功能

- MySQL 数据库连接，自动反射表与字段元数据
- 表与字段多选界面（≤10 表，class_name 字段自动识别）
- 三层关系发现引擎：
  - Schema 层 — 外键约束追踪
  - 数据层 — 全量精确值相等比较（NumPy 向量化）
  - 语义层 — DeepSeek AI 判定字段匹配 + BGE 嵌入向量检索
- WebSocket 实时推送五阶段分析进度
- Canvas 2D 力导向星云图谱渲染：
  - 确定性星云布局（D3 forceSimulation + Web Worker）
  - 缩放、拖拽、拖拽锁定节点
  - 悬停一跳邻域聚焦（节点 0.16 不透明度、边 0.06）
  - 单击居中、双击详情面板
  - 置信度连续滑块筛选边
  - 语义缩放三层（概述/工作/详情）
  - 曲线关系渲染 + 自环 + 方向箭头
- 节点详情面板：全部字段原始值 + 关联节点列表
- JSON 一键导出完整快照（图谱 + 原始数据 + 配置 + 布局）
- 友好中文错误提示：数据库连接失败、AI 服务不可用、分析超时
- 未发现关系时的空状态提示 + 仅节点图谱
- `prefers-reduced-motion` 响应

### 技术架构

- 前端：React 19 + TypeScript 6 + Canvas 2D + D3.js + Tailwind CSS 4 + Zustand 5
- 后端：Python 3.12 + FastAPI + SQLAlchemy + NumPy + Sentence Transformers
- AI 引擎：DeepSeek API (deepseek-v4-flash) + BAAI/bge-small-zh-v1.5
- 测试：481 tests (Pytest 240 + Vitest 241)

### 已知限制

- 仅支持 MySQL 数据库
- 最大 10 张表、每表约 1000 行
- 分析超时上限 3 分钟
- 不支持参数调整重新生成（需后续版本）
- 不支持手动创建/删除关系
- JSON 不支持导入恢复（仅导出）
