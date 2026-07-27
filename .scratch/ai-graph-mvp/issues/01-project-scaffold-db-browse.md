# 01 — 项目脚手架 + 数据库浏览

**What to build:** 打开浏览器即可看到 MySQL 中所有表，勾选表后展开字段列表，class_name 字段被自动识别并标记。

**Blocked by:** 无 — 可立即开始

**Status:** ready-for-agent

- [ ] FastAPI 项目骨架可启动，`.env` 中配置的 MySQL 能通过 SQLAlchemy 连通
- [ ] `GET /api/tables` 返回数据库中所有表名列表
- [ ] `GET /api/tables/{table_name}/fields` 返回表的字段名和类型，约定命名匹配到的 class_name 候选字段被标记
- [ ] React + TypeScript + Tailwind + Zustand 项目骨架可启动
- [ ] TableSelector 组件展示表列表，支持多选勾选，显示已选数量与上限（10）
- [ ] FieldSelector 组件按表分组展示字段，class_name 字段自动标记并强制选中，其余字段支持多选 + 全选
- [ ] 后端 API 端点有测试覆盖（HTTP 请求/响应契约断言）
