# 沉浸式关系图谱工作台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有关系分析前端改造成中文正常、字段选择高效、节点清晰且铺满浏览器内容区的沉浸式图谱工作台。

**Architecture:** 保持现有 React、Zustand、D3 SVG、Tailwind 和后端 API 协议。选择阶段由表级折叠组件统一管理表与字段；结果阶段由 `GraphWorkbench` 组合工具栏、纯 D3 画布和常驻详情栏，跨组件命令通过 Zustand 中的递增请求标记传递。

**Tech Stack:** React 19、TypeScript 6、Zustand 5、D3 7、Tailwind CSS 4、Vitest、Testing Library。

## Global Constraints

- 结果页使用 `100dvh` 铺满浏览器内容区域，不使用 Fullscreen API。
- 图谱继续使用 SVG，不引入 Canvas 或 WebGL。
- 不修改后端分析协议、关系算法或数据库接口。
- 全站使用冷灰中性色与单一青绿色交互强调色。
- 主键与类名字段始终选中且不可取消。
- 所有受影响源码、提示与测试数据使用 UTF-8 中文。
- 尊重 `prefers-reduced-motion`，并清理 D3 simulation、定时器和 ResizeObserver。
- 保留并绕开当前工作区中与本计划无关的用户改动。

---

## File Structure

- `frontend/src/App.tsx`：只负责按分析阶段选择页面级工作区。
- `frontend/src/components/SelectionWorkspace.tsx`：选择页布局、统计与启动入口。
- `frontend/src/components/DatabaseTableAccordion.tsx`：单张表的选择、折叠、字段状态和表内全选。
- `frontend/src/components/GraphWorkbench.tsx`：结果页沉浸式三段布局。
- `frontend/src/components/GraphToolbar.tsx`：图谱统计、阈值筛选、画布命令、导出和新分析。
- `frontend/src/components/GraphCanvas.tsx`：D3 图层、实体卡片节点、边、布局和画布交互。
- `frontend/src/components/graphGeometry.ts`：可独立测试的矩形节点几何与可见关系计算。
- `frontend/src/components/NodeDetailPanel.tsx`：桌面常驻详情栏和移动端抽屉内容。
- `frontend/src/store/analysis.ts`：跨组件分析与工作台交互状态。
- `frontend/src/index.css`：全局色彩、排版、画布和表单控件基础样式。

---

### Task 1: 恢复 UTF-8 中文与可靠测试基线

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/analysis.ts`
- Modify: `frontend/src/api/tables.ts`
- Modify: `frontend/src/components/AnalysisLauncher.tsx`
- Modify: `frontend/src/components/ExportButton.tsx`
- Modify: `frontend/src/components/ProgressIndicator.tsx`
- Modify: `frontend/src/components/StrengthFilter.tsx`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/__tests__/integration.test.tsx`
- Modify: `frontend/src/components/__tests__/*.test.tsx`

**Interfaces:**
- Consumes: 现有公开组件和 Zustand action 签名。
- Produces: UTF-8 中文界面与使用 `is_primary_key` 完整字段数据的测试夹具。

- [ ] **Step 1: 写入正确中文的失败断言**

在集成测试中将首页断言改为：

```tsx
expect(screen.getByRole("heading", { name: "AI 关系图谱分析" })).toBeInTheDocument();
expect(screen.getByText("选择数据库表与字段，AI 自动发现数据间的隐藏关联")).toBeInTheDocument();
```

并为启动按钮、进度阶段、错误状态、导出按钮和无关系状态改用正确中文断言。

- [ ] **Step 2: 运行测试并确认乱码断言失败**

Run: `npm test -- --run src/__tests__/integration.test.tsx`

Expected: FAIL，页面仍渲染乱码文本。

- [ ] **Step 3: 修复所有可见中文和错误回退值**

将组件、API 层和 store 中的乱码字符串恢复为明确中文。例如：

```ts
const PHASE_LABELS: Record<number, string> = {
  1: "数据读取",
  2: "Schema 分析",
  3: "AI 决策",
  4: "关系计算",
  5: "图谱生成",
};
```

所有测试字段夹具补充 `is_primary_key: boolean`，避免类型与真实 API 不一致。

- [ ] **Step 4: 扫描残留乱码并运行全量测试**

Run: `Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '鍏|绯|瀛|娑|璇|锛|鈥|€'`

Expected: 无命中。

Run: `npm test`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add frontend/src
git commit -m "fix: restore frontend utf-8 copy"
```

---

### Task 2: 合并表与字段为折叠选择器

**Files:**
- Create: `frontend/src/components/SelectionWorkspace.tsx`
- Create: `frontend/src/components/DatabaseTableAccordion.tsx`
- Create: `frontend/src/components/__tests__/DatabaseTableAccordion.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/store/analysis.test.ts`
- Delete: `frontend/src/components/TableSelector.tsx`
- Delete: `frontend/src/components/FieldSelector.tsx`
- Delete: `frontend/src/components/__tests__/TableSelector.test.tsx`
- Delete: `frontend/src/components/__tests__/FieldSelector.test.tsx`

**Interfaces:**
- Consumes: `toggleTable(tableName)`, `toggleField(tableName, fieldName)`, `selectAllFields(tableName)`, `deselectAllFields(tableName)`。
- Produces: `DatabaseTableAccordion({ tableName, disabled })` 和 `SelectionWorkspace()`。

- [ ] **Step 1: 写折叠和全选行为测试**

覆盖以下行为：

```tsx
expect(screen.getByRole("button", { name: "展开 users 字段" })).toHaveAttribute("aria-expanded", "false");
await user.click(screen.getByRole("checkbox", { name: "选择表 users" }));
expect(await screen.findByRole("region", { name: "users 字段列表" })).toBeVisible();
await user.click(screen.getByRole("button", { name: "全选 users 字段" }));
expect(screen.getByRole("checkbox", { name: "字段 email" })).toBeChecked();
await user.click(screen.getByRole("button", { name: "取消全选 users 字段" }));
expect(screen.getByRole("checkbox", { name: "字段 id" })).toBeChecked();
expect(screen.getByRole("checkbox", { name: "字段 class_name" })).toBeChecked();
```

另测加载失败重试、十表上限禁用和取消表选择后折叠。

- [ ] **Step 2: 运行新测试并确认组件不存在**

Run: `npm test -- --run src/components/__tests__/DatabaseTableAccordion.test.tsx`

Expected: FAIL，无法导入 `DatabaseTableAccordion`。

- [ ] **Step 3: 实现单表折叠组件**

组件本地维护 `expanded`，选中完成后自动展开；表头包含原生复选框、表名、已选计数、全选按钮和 `aria-expanded` 下拉按钮。字段行显示名称、类型及“主键/类名”标签，强制字段保持 disabled 和 checked。

- [ ] **Step 4: 实现选择工作区并替换 App 旧组件**

`SelectionWorkspace` 负责加载表列表、显示选择统计、渲染全部 `DatabaseTableAccordion`、错误/骨架状态和 `AnalysisLauncher`。`App` 的 select/error 分支只渲染该工作区与错误提示。

- [ ] **Step 5: 更新 store 测试并运行选择流程**

Run: `npm test -- --run src/store/analysis.test.ts src/components/__tests__/DatabaseTableAccordion.test.tsx src/__tests__/integration.test.tsx`

Expected: PASS。

- [ ] **Step 6: 删除旧组件并运行全量测试**

Run: `npm test`

Expected: PASS，且没有旧组件导入。

- [ ] **Step 7: 提交**

```powershell
git add frontend/src
git commit -m "feat: add accordion database field selector"
```

---

### Task 3: 建立沉浸式结果工作台和工具栏

**Files:**
- Create: `frontend/src/components/GraphWorkbench.tsx`
- Create: `frontend/src/components/GraphToolbar.tsx`
- Create: `frontend/src/components/__tests__/GraphToolbar.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/store/analysis.test.ts`
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/components/StrengthFilter.tsx`

**Interfaces:**
- Consumes: `graph`, `confidenceThreshold`, `setConfidenceThreshold`, `resetAnalysis`。
- Produces: store 字段 `fitViewRequest: number`、`relayoutRequest: number`；actions `requestFitView()`、`requestRelayout()`；组件 `GraphWorkbench()` 和 `GraphToolbar()`。

- [ ] **Step 1: 写工具栏与 store 命令测试**

```ts
const before = useAnalysisStore.getState().fitViewRequest;
useAnalysisStore.getState().requestFitView();
expect(useAnalysisStore.getState().fitViewRequest).toBe(before + 1);
```

组件测试验证节点总数、关系总数、阈值过滤后的可见关系数，以及“适应画布”“重新布局”“导出 JSON”“新分析”按钮。

- [ ] **Step 2: 运行测试并确认请求字段缺失**

Run: `npm test -- --run src/store/analysis.test.ts src/components/__tests__/GraphToolbar.test.tsx`

Expected: FAIL，store 不存在工作台命令。

- [ ] **Step 3: 实现 store 命令与工具栏**

可见关系数使用：

```ts
const visibleEdgeCount = graph.edges.filter(
  (edge) => edge.confidence >= confidenceThreshold,
).length;
```

工具栏复用 `ExportButton`，将 `StrengthFilter` 改为紧凑型、有正确 label 的阈值控件。

- [ ] **Step 4: 实现工作台布局**

`GraphWorkbench` 输出 `min-h-[100dvh] h-[100dvh] overflow-hidden` 容器，内部为固定工具栏与 `minmax(0,1fr) 360px` 两列主体；窄屏时详情栏由 `NodeDetailPanel` 自行覆盖显示。

- [ ] **Step 5: 接入 App 并运行测试**

Run: `npm test -- --run src/components/__tests__/GraphToolbar.test.tsx src/__tests__/integration.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add frontend/src
git commit -m "feat: add immersive graph workbench shell"
```

---

### Task 4: 将 D3 圆点图重构为实体卡片图

**Files:**
- Create: `frontend/src/components/graphGeometry.ts`
- Create: `frontend/src/components/__tests__/graphGeometry.test.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx`

**Interfaces:**
- Consumes: `GraphData`、`fitViewRequest`、`relayoutRequest`、节点选择与悬停 actions。
- Produces:
  - `getDirectNeighborIds(nodeId: string, edges: EdgeData[]): Set<string>`
  - `getVisibleEdgeCount(edges: EdgeData[], threshold: number): number`
  - `getRectBoundaryPoint(source, target, halfWidth, halfHeight): { x: number; y: number }`

- [ ] **Step 1: 写几何与邻居失败测试**

```ts
expect(getDirectNeighborIds("a", [
  { source: "a", target: "b", labels: [], confidence: 1 },
  { source: "b", target: "c", labels: [], confidence: 1 },
])).toEqual(new Set(["a", "b"]));

expect(getRectBoundaryPoint(
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  84,
  32,
)).toEqual({ x: 84, y: 0 });
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `npm test -- --run src/components/__tests__/graphGeometry.test.ts`

Expected: FAIL，无法导入 `graphGeometry`。

- [ ] **Step 3: 实现纯几何函数**

矩形边界交点按方向向量缩放：

```ts
const scale = 1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);
return { x: source.x + dx * scale, y: source.y + dy * scale };
```

函数处理零距离节点并返回源点。

- [ ] **Step 4: 重建 GraphCanvas 图层**

使用 `viewBox` 和容器尺寸渲染深色网格画布。每个节点 `<g tabindex="0" role="button">` 内包含 168×64 的 `<rect>`、来源表文本、类名/ID 主标题和关联数。边端点调用矩形边界函数，边标签使用背景 rect 与文本组合。

- [ ] **Step 5: 重建布局和交互**

力导向参数以卡片尺寸计算碰撞；悬停仅高亮直接邻居。单击节点设置选中，单击 SVG 空白取消选择，Enter/Space 可选择节点。`fitViewRequest` 变化时读取节点包围盒并通过 `zoom.transform` 居中；`relayoutRequest` 变化时清除 `fx/fy` 并重启 simulation。

- [ ] **Step 6: 实现无关系网格布局和清理**

无边时按 `source_table` 排序后放入规则网格，不启动无意义的 link force。cleanup 中停止 simulation、取消自动适应定时器并断开 ResizeObserver。

- [ ] **Step 7: 运行几何测试、构建和 lint**

Run: `npm test -- --run src/components/__tests__/graphGeometry.test.ts`

Run: `npm run build`

Run: `npm run lint`

Expected: 全部成功。

- [ ] **Step 8: 提交**

```powershell
git add frontend/src/components/GraphCanvas.tsx frontend/src/components/graphGeometry.ts frontend/src/components/__tests__/graphGeometry.test.ts
git commit -m "feat: render readable entity card graph"
```

---

### Task 5: 将节点详情改为工作台常驻检查器

**Files:**
- Modify: `frontend/src/components/NodeDetailPanel.tsx`
- Modify: `frontend/src/components/__tests__/NodeDetailPanel.test.tsx`
- Modify: `frontend/src/store/analysis.ts`
- Modify: `frontend/src/components/GraphCanvas.tsx`

**Interfaces:**
- Consumes: `selectedNodeId`、`setSelectedNode(id)`、`requestFitView()`、完整 `graph`。
- Produces: 无节点时的图谱概览、选中节点字段与直接关系详情、移动端关闭行为。

- [ ] **Step 1: 写常驻面板失败测试**

验证未选中节点时显示“选择一个节点查看详情”；选中后显示完整 ID、来源表、字段值、`NULL`、直接关联节点、关系标签和格式化置信度。点击关联节点后断言 `selectedNodeId` 更新。

- [ ] **Step 2: 运行测试并确认旧抽屉行为不符合**

Run: `npm test -- --run src/components/__tests__/NodeDetailPanel.test.tsx`

Expected: FAIL，旧组件在未选中时返回 null，并使用遮罩抽屉。

- [ ] **Step 3: 实现桌面常驻详情栏**

移除桌面遮罩。详情内容按“节点概览 / 字段值 / 直接关系”分节；对象值使用 `JSON.stringify(value, null, 2)`，字符串允许换行。关系列表从原始 edge 同时取得另一端 ID、labels 和 confidence。

- [ ] **Step 4: 实现移动端抽屉语义**

在小于桌面断点时使用 fixed 右侧覆盖层，仅在选中节点时打开；关闭动作只清空 `selectedNodeId`。按钮具有 `aria-label="关闭节点详情"`。

- [ ] **Step 5: 运行详情与集成测试**

Run: `npm test -- --run src/components/__tests__/NodeDetailPanel.test.tsx src/__tests__/integration.test.tsx`

Expected: PASS。

- [ ] **Step 6: 提交**

```powershell
git add frontend/src/components/NodeDetailPanel.tsx frontend/src/components/GraphCanvas.tsx frontend/src/components/__tests__/NodeDetailPanel.test.tsx frontend/src/store/analysis.ts
git commit -m "feat: add persistent graph node inspector"
```

---

### Task 6: 完成响应式视觉、回归和浏览器验收

**Files:**
- Modify: `frontend/src/index.css`
- Modify: `frontend/src/__tests__/integration.test.tsx`
- Modify: `frontend/src/components/__tests__/GraphToolbar.test.tsx`
- Modify: `frontend/src/components/__tests__/DatabaseTableAccordion.test.tsx`
- Modify: `frontend/src/components/__tests__/NodeDetailPanel.test.tsx`

**Interfaces:**
- Consumes: 前五个任务的所有公开组件和 store action。
- Produces: 可构建、可测试、无乱码并通过桌面/窄屏视觉验收的最终前端。

- [ ] **Step 1: 补齐整体流程断言**

集成测试覆盖：加载表、展开字段、全选、开始分析、进度、结果工作台、无关系状态、阈值筛选、导出、新分析、WebSocket 错误与超时。

- [ ] **Step 2: 运行全量自动化检查**

Run: `npm test`

Run: `npm run build`

Run: `npm run lint`

Expected: 全部成功且零失败。

- [ ] **Step 3: 扫描乱码和遗留旧组件**

Run: `Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern '鍏|绯|瀛|娑|璇|锛|鈥|€'`

Expected: 无命中。

Run: `Get-ChildItem frontend/src -Recurse -Include *.ts,*.tsx | Select-String -Pattern 'TableSelector|FieldSelector'`

Expected: 无生产代码命中。

- [ ] **Step 4: 在浏览器验证桌面结果页**

使用本地后端或受控 mock 图谱进入结果页，在 1920×1080 和 1280×800 验证：工作台铺满内容区、20 个节点文字清晰、详情栏不遮挡画布、适应画布和重新布局有效、无关系节点规则排列。

- [ ] **Step 5: 在浏览器验证窄屏和可访问性**

在 768px 和 390px 宽度验证工具栏可用、详情显示为可关闭抽屉、表折叠可操作、焦点轮廓清晰；模拟 `prefers-reduced-motion: reduce` 后确认无非必要过渡。

- [ ] **Step 6: 检查工作区差异**

Run: `git status --short`

Run: `git diff --check`

Expected: 仅包含本任务相关变更和用户原有未提交变更，无空白错误。

- [ ] **Step 7: 提交**

```powershell
git add frontend/src
git commit -m "test: verify immersive graph workbench"
```

---

## Final Verification

- [ ] `npm test` 通过。
- [ ] `npm run build` 通过。
- [ ] `npm run lint` 通过。
- [ ] 源码乱码扫描无结果。
- [ ] 1920、1280、768 和 390 宽度下完成视觉验收。
- [ ] 结果页在浏览器内容区内使用完整 `100dvh`。
- [ ] 20 个节点全部有可读实体卡片标签。
- [ ] 每张表支持字段下拉、全选和取消全选。
- [ ] 主键与类名字段始终选中。
- [ ] 无关系结果不再使用遮挡画布的警告框。
- [ ] 当前用户未提交的后端和配置改动未被覆盖。
