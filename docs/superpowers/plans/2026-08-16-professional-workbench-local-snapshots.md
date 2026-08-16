# 专业关系图谱工作台与本地快照实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 将现有一次性分析页面升级为统一的专业工作台，加入本地保存与图谱库，并把最终图谱改造成无外圈、无泳道的 Obsidian 式自由关系宇宙。

**Architecture:** 前端新增持久化 WorkbenchShell，通过轻量页面状态 store 统一承载工作台首页、新建分析、图谱库、数据连接和图谱详情；后端 REST/WebSocket 契约保持不变。图谱快照使用浏览器 IndexedDB 保存，快照序列化、存储、视图状态和布局恢复分别由独立模块负责；Canvas 仍由现有 D3/Worker 链路渲染，但默认采用实体优先的自由力导向画布。

**Tech Stack:** React 19, TypeScript 6, Canvas 2D, D3.js 7, Tailwind CSS 4, Zustand 5, Vitest, Testing Library, IndexedDB。

## Global Constraints

- 前端技术栈保持 React 19 + TypeScript 6 + Canvas 2D + D3.js + Tailwind CSS 4 + Zustand 5。
- 不修改现有 FastAPI REST 端点、WebSocket 消息格式、后端分析算法或数据库行为。
- 用户界面保持中文；业务名称优先于表名、内部 ID 和模型元数据。
- 本地快照使用 IndexedDB，保存完整图谱、原始字段值、分析配置和视图状态；不保存数据库密码、API Key、WebSocket 实例或后端任务句柄。
- 第一阶段全局导航只包含：工作台、新建分析、图谱库、数据连接；不加入权限管理、模型管理、数据目录、团队协作或探索查询。
- 生成前、生成中、生成后共用同一左侧导航、顶部上下文栏、字体、颜色、间距、按钮语义和业务数据。
- 最终图谱使用开放画布中的自由力导向布局，不显示外圈、圆形边界、同心环、径向背景、横向泳道或矩形分区。
- 图谱默认实体优先；表节点和表级边保留在数据模型与技术依据中，不作为默认画布的独立视觉层。
- 强关系使用高对比实线，弱关系使用低对比虚线；节点颜色区分数据来源，节点大小表达关系度数或业务重要性。
- 保留当前工作区中用户已有的未提交改动；每个任务只提交本任务新增或明确修改的文件。
- 视觉参考位于 docs/superpowers/specs/assets/local-snapshot-workbench/，实现使用真实状态和真实快照数据，不复制视觉稿中的伪统计。

## File Map

### New files

- frontend/src/workbench/navigation.ts — 工作台页面 union 类型、导航元数据和页面标题。
- frontend/src/store/workbench.ts — 当前工作台页面和导航操作。
- frontend/src/store/database.ts — 数据库安全摘要的共享加载状态。
- frontend/src/store/snapshots.ts — 图谱快照列表、当前快照和未保存状态。
- frontend/src/store/graphView.ts — Canvas 当前节点坐标、viewport 和快照恢复状态。
- frontend/src/snapshots/types.ts — GraphSnapshot、快照列表项、视图状态和恢复载荷类型。
- frontend/src/snapshots/storage.ts — IndexedDB 初始化、CRUD、索引查询和存储错误映射。
- frontend/src/snapshots/serializer.ts — 当前 Zustand 状态与快照之间的序列化、校验和恢复转换。
- frontend/src/components/WorkbenchShell.tsx — 统一页面外壳和中央内容切换。
- frontend/src/components/WorkbenchNav.tsx — 左侧全局导航。
- frontend/src/components/WorkbenchHeader.tsx — 顶部上下文栏、面包屑和页面级操作区。
- frontend/src/components/WorkbenchHome.tsx — 工作台首页和最近图谱摘要。
- frontend/src/components/DatabaseConnectionPage.tsx — 数据连接状态页面。
- frontend/src/components/GraphLibrary.tsx — 图谱库搜索、列表和记录操作。
- frontend/src/components/SnapshotList.tsx — 可复用的快照摘要列表和空状态。
- frontend/src/components/SnapshotNameDialog.tsx — 保存/另存为名称输入对话框。
- frontend/src/components/GraphSnapshotActions.tsx — 保存、另存为、导出和保存状态。
- frontend/src/snapshots/storage.test.ts — IndexedDB CRUD、排序和错误映射测试。
- frontend/src/snapshots/serializer.test.ts — 快照序列化、校验和恢复测试。
- frontend/src/store/graphView.test.ts — 视图状态更新和恢复测试。
- frontend/src/components/__tests__/WorkbenchShell.test.tsx — 外壳导航与页面切换测试。
- frontend/src/components/__tests__/GraphLibrary.test.tsx — 图谱库列表、搜索、打开和删除测试。
- frontend/src/components/__tests__/SnapshotNameDialog.test.tsx — 保存/另存为输入测试。

### Existing files to modify

- frontend/src/App.tsx — 从按 phase 整屏切换改为始终渲染 WorkbenchShell。
- frontend/src/store/analysis.ts — 增加历史快照恢复、重置活动快照和未保存状态协作接口。
- frontend/src/components/DatabaseInfoCard.tsx — 改为消费共享数据库状态。
- frontend/src/components/SelectionWorkspace.tsx — 保留选择语义，接入统一外壳和生成前布局。
- frontend/src/components/ProgressIndicator.tsx — 改造成统一工作台中的阶段轨道、业务解释和实时统计。
- frontend/src/components/GraphWorkbench.tsx — 保留图谱主区域，接入顶部上下文栏和实体优先画布。
- frontend/src/components/GraphToolbar.tsx — 只保留画布控制；保存、另存为、导出移动到顶部上下文栏。
- frontend/src/components/GraphCanvas.tsx — 发布布局/viewport 状态，接收快照恢复状态，默认隐藏表级视觉层。
- frontend/src/components/NodeDetailPanel.tsx — 承载业务详情、直接关系、数据链路、技术依据和原始数据折叠区。
- frontend/src/components/DataChainStrip.tsx — 将链路内容拆成详情面板内可复用区块。
- frontend/src/components/ExportButton.tsx — 同时支持实时任务导出和本地快照导出。
- frontend/src/graph/layout.ts — 保持确定性自由布局，增加快照坐标恢复和边端点重算。
- frontend/src/graph/scene.ts — 增加实体优先的场景构建选项。
- frontend/src/graph/renderer.ts — 默认只绘制实体关系宇宙。
- frontend/src/graph/layout.test.ts、scene.test.ts、renderer.test.ts — 图谱布局和绘制回归测试。
- frontend/src/index.css — 统一外壳、图谱库、保存状态、生成进度和响应式样式。
- frontend/src/__tests__/integration.test.tsx — 新建分析、生成中、图谱详情和本地图谱打开流程。
- frontend/src/components/__tests__/ — 更新现有组件回归测试。
- frontend/package.json、frontend/package-lock.json — 增加 fake-indexeddb 测试依赖。

---

### Task 1: 建立本地快照类型、IndexedDB 存储和序列化边界

**Files:**
- Create: frontend/src/snapshots/types.ts
- Create: frontend/src/snapshots/storage.ts
- Create: frontend/src/snapshots/serializer.ts
- Create: frontend/src/snapshots/storage.test.ts
- Create: frontend/src/snapshots/serializer.test.ts
- Modify: frontend/package.json
- Modify: frontend/package-lock.json

**Interfaces:**
- storage.ts produces SnapshotStorage with list(): Promise<SnapshotListItem[]>, get(id: string): Promise<GraphSnapshot | null>, put(snapshot: GraphSnapshot): Promise<void>, and delete(id: string): Promise<void>.
- serializer.ts consumes current analysis data, selected table maps and PersistedGraphViewState; it produces GraphSnapshot, SnapshotListItem, and SnapshotHydration.
- Later tasks use validateGraphSnapshot(payload: unknown): GraphSnapshot as the only boundary for untrusted IndexedDB data.

- [ ] Step 1: Add the IndexedDB test dependency.

Run from frontend:

~~~powershell
npm install --save-dev fake-indexeddb
~~~

Expected: package.json and package-lock.json contain the same fake-indexeddb version; no runtime dependency is added.

- [ ] Step 2: Write failing CRUD and ordering tests.

Use import "fake-indexeddb/auto" and cover newest-first ordering, missing IDs and deletion:

~~~ts
it("stores and lists snapshots newest first", async () => {
  const storage = createSnapshotStorage();
  await storage.put(snapshot("older", "2026-08-16T10:00:00.000Z"));
  await storage.put(snapshot("newer", "2026-08-16T11:00:00.000Z"));

  await expect(storage.list()).resolves.toMatchObject([
    { name: "newer" },
    { name: "older" },
  ]);
});

it("returns null for an unknown id and removes an existing snapshot", async () => {
  const storage = createSnapshotStorage();
  await expect(storage.get("missing")).resolves.toBeNull();
  await storage.put(snapshot("saved", "2026-08-16T10:00:00.000Z"));
  await storage.delete("saved-id");
  await expect(storage.get("saved-id")).resolves.toBeNull();
});
~~~

Run: npm test -- --run src/snapshots/storage.test.ts  
Expected: FAIL because the storage module and factory do not exist.

- [ ] Step 3: Define the versioned snapshot types.

Implement GraphSnapshot with schemaVersion: 1, identity, safe database metadata, selected table names and fields, selection mode/source, graph result, diagnostics, warnings and:

~~~ts
export interface PersistedGraphViewState {
  nodePositions: Record<string, { x: number; y: number }>;
  viewport: { x: number; y: number; scale: number };
  confidenceThreshold: number;
  showIsolatedNodes: boolean;
  selectedNodeId: string | null;
  selectedEntityEdgeId: string | null;
  selectedTableEdgeId: string | null;
}
~~~

Define SnapshotListItem with id, name, savedAt, databaseName, tableCount, entityCount, relationshipCount and status.

- [ ] Step 4: Implement IndexedDB storage with explicit error mapping.

Create database ai-graph-local, object store snapshots, primary key id, and indexes savedAt and name. Map failures to SnapshotStorageError codes unavailable, quota, corrupt and unknown. list() sorts by savedAt descending in code.

- [ ] Step 5: Write and implement serializer round-trip tests.

Cover Set<string> to sorted string[], raw field values, view state, null diagnostics, warnings and unknown schema rejection:

~~~ts
it("round-trips raw dimensions and view state", () => {
  const saved = createGraphSnapshot(sourceFixture(), {
    id: "snapshot-1",
    savedAt: "2026-08-16T11:00:00.000Z",
  });
  const restored = hydrateGraphSnapshot(saved);

  expect(restored.graph.entity_nodes[0].dimensions).toEqual({ name: "订单" });
  expect(restored.viewState.viewport).toEqual({ x: 20, y: -10, scale: 1.2 });
  expect(restored.selectedTables[0].selectedFields).toEqual(["email", "name"]);
});

it("rejects an unsupported snapshot schema", () => {
  expect(() => validateGraphSnapshot({ schemaVersion: 99 })).toThrow(/schema/i);
});
~~~

Validation rejects missing IDs, invalid statuses, non-finite viewport numbers and invalid confidence thresholds without mutating Zustand state.

- [ ] Step 6: Run focused tests and commit.

Run: npm test -- --run src/snapshots/storage.test.ts src/snapshots/serializer.test.ts  
Expected: PASS.

~~~powershell
git add frontend/package.json frontend/package-lock.json frontend/src/snapshots
git commit -m "feat: add local graph snapshot storage"
~~~

### Task 2: Persist Canvas view state and restore saved positions

**Files:**
- Create: frontend/src/graph/viewState.ts
- Create: frontend/src/store/graphView.ts
- Create: frontend/src/store/graphView.test.ts
- Modify: frontend/src/graph/layout.ts
- Modify: frontend/src/graph/layout.test.ts
- Modify: frontend/src/components/GraphCanvas.tsx

**Interfaces:**
- useGraphViewStore produces recordLayout(layout: GraphLayout), setViewport(transform: GraphTransform), hydrate(viewState: PersistedGraphViewState), clear(), and selectors for nodePositions, viewport and pendingHydration.
- layout.ts produces applyPersistedNodePositions(layout: GraphLayout, positions: Record<string, LayoutPoint>): GraphLayout.
- GraphCanvas consumes pendingHydration and publishes every completed layout, zoom transform and committed drag position.

- [ ] Step 1: Write failing store and coordinate restoration tests.

~~~ts
it("records entity and table positions from a completed layout", () => {
  useGraphViewStore.getState().recordLayout(layoutFixture());
  expect(useGraphViewStore.getState().nodePositions).toMatchObject({
    "table:orders": { x: 40, y: 20 },
    "entity:order-1": { x: 120, y: 80 },
  });
});

it("applies persisted positions and reroutes incident edges", () => {
  const restored = applyPersistedNodePositions(layoutFixture(), {
    "entity:order-1": { x: 500, y: 300 },
  });
  expect(restored.entityNodes.find((node) => node.id === "entity:order-1"))
    .toMatchObject({ x: 500, y: 300 });
  expect(restored.entityEdges[0].from).toEqual({ x: 500, y: 300 });
});
~~~

Run: npm test -- --run src/store/graphView.test.ts src/graph/layout.test.ts  
Expected: FAIL because the store and restoration helper do not exist.

- [ ] Step 2: Implement the serializable graph view store.

Keep D3's internal GraphTransform.k private to Canvas; convert it to the public snapshot shape { x, y, scale }. hydrate() must not mark the graph dirty and must expose a one-shot pendingHydration payload.

- [ ] Step 3: Implement applyPersistedNodePositions.

Clone table/entity nodes by ID, merge only finite persisted coordinates, rebuild tableEdges and entityEdges from resulting position maps, then run the existing finite-layout assertion. New node IDs use generated positions.

- [ ] Step 4: Publish live Canvas state and consume hydration.

At existing layout completion, zoom handler and drag commit points, call:

~~~ts
useGraphViewStore.getState().recordLayout(nextLayout);
useGraphViewStore.getState().setViewport({
  x: event.transform.x,
  y: event.transform.y,
  scale: event.transform.k,
});
~~~

When pendingHydration exists, apply saved coordinates after the Worker returns and restore the saved viewport instead of always using the default fitTransform. Invalid or partial saved state falls back to generated positions.

- [ ] Step 5: Run graph/store tests and commit.

Run: npm test -- --run src/store/graphView.test.ts src/graph/layout.test.ts src/components/__tests__/GraphCanvas.test.tsx  
Expected: PASS.

~~~powershell
git add frontend/src/graph/viewState.ts frontend/src/store/graphView.ts frontend/src/store/graphView.test.ts frontend/src/graph/layout.ts frontend/src/graph/layout.test.ts frontend/src/components/GraphCanvas.tsx
git commit -m "feat: persist graph viewport and layout state"
~~~

### Task 3: Introduce the persistent WorkbenchShell and global navigation

**Files:**
- Create: frontend/src/workbench/navigation.ts
- Create: frontend/src/store/workbench.ts
- Create: frontend/src/store/database.ts
- Create: frontend/src/components/WorkbenchShell.tsx
- Create: frontend/src/components/WorkbenchNav.tsx
- Create: frontend/src/components/WorkbenchHeader.tsx
- Create: frontend/src/components/WorkbenchHome.tsx
- Create: frontend/src/components/DatabaseConnectionPage.tsx
- Create: frontend/src/components/__tests__/WorkbenchShell.test.tsx
- Modify: frontend/src/App.tsx
- Modify: frontend/src/components/DatabaseInfoCard.tsx
- Modify: frontend/src/index.css

**Interfaces:**
- navigation.ts produces WorkbenchPage = "home" | "analysis" | "library" | "connection" | "graph" and WORKBENCH_NAV_ITEMS in fixed order home, analysis, library, connection.
- useWorkbenchStore produces page, navigate(page) and openGraph(); openGraph() is a no-op when no graph exists.
- WorkbenchHeader consumes { breadcrumb: string[]; title: string; status?: string; actions?: ReactNode } and renders the shared top context bar.

- [ ] Step 1: Write failing navigation tests.

~~~tsx
it("keeps the global shell while navigating to new analysis", async () => {
  render(<WorkbenchShell />);
  await userEvent.click(screen.getByRole("link", { name: "新建分析" }));
  expect(screen.getByRole("navigation")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /选择要分析/ })).toBeInTheDocument();
});
~~~

Run: npm test -- --run src/components/__tests__/WorkbenchShell.test.tsx  
Expected: FAIL because the shell and page store do not exist.

- [ ] Step 2: Implement the page union, navigation store, shared nav and header.

Keep navigation in client state rather than adding a routing dependency. Use one nav width, one active state and one header height across all pages. The header reads safe database information from useDatabaseStore.

- [ ] Step 3: Centralize database info loading.

Move fetchDatabaseInfo() ownership from DatabaseInfoCard local state into useDatabaseStore.load(). DatabaseInfoCard, WorkbenchHeader and DatabaseConnectionPage consume the same request state.

- [ ] Step 4: Refactor App.tsx to render one shell.

Replace the current phase-based full-screen branch with:

~~~tsx
export default function App() {
  return <WorkbenchShell />;
}
~~~

WorkbenchShell selects home, selection/progress, library, connection or graph content. Preserve existing phase and WebSocket behavior.

- [ ] Step 5: Add real home and connection states.

Render “暂无已保存图谱” with a “新建分析” action when the list is empty. Render existing safe database information and retry/unavailable states in the connection page. Do not add unconfirmed dashboard modules.

- [ ] Step 6: Run shell/App tests and commit.

Run: npm test -- --run src/components/__tests__/WorkbenchShell.test.tsx src/__tests__/integration.test.tsx src/components/__tests__/DatabaseInfoCard.test.tsx  
Expected: PASS after updating assertions for the persistent shell.

~~~powershell
git add frontend/src/workbench frontend/src/store/workbench.ts frontend/src/store/database.ts frontend/src/components/WorkbenchShell.tsx frontend/src/components/WorkbenchNav.tsx frontend/src/components/WorkbenchHeader.tsx frontend/src/components/WorkbenchHome.tsx frontend/src/components/DatabaseConnectionPage.tsx frontend/src/components/DatabaseInfoCard.tsx frontend/src/App.tsx frontend/src/index.css frontend/src/components/__tests__/WorkbenchShell.test.tsx
git commit -m "feat: add persistent relationship workbench shell"
~~~

### Task 4: Add the local 图谱库 and save/rename/delete actions

**Files:**
- Create: frontend/src/store/snapshots.ts
- Create: frontend/src/components/SnapshotList.tsx
- Create: frontend/src/components/GraphLibrary.tsx
- Create: frontend/src/components/SnapshotNameDialog.tsx
- Create: frontend/src/components/GraphSnapshotActions.tsx
- Create: frontend/src/components/__tests__/GraphLibrary.test.tsx
- Create: frontend/src/components/__tests__/SnapshotNameDialog.test.tsx
- Modify: frontend/src/store/analysis.ts
- Modify: frontend/src/components/WorkbenchHome.tsx
- Modify: frontend/src/components/WorkbenchHeader.tsx
- Modify: frontend/src/components/ExportButton.tsx
- Modify: frontend/src/components/GraphWorkbench.tsx
- Modify: frontend/src/index.css

**Interfaces:**
- useSnapshotStore produces items, activeSnapshotId, activeSnapshotName, dirty, status, error, refresh(), setActive(id, name), markDirty(), clearActive(), create(snapshot), update(snapshot), rename(id, name) and remove(id).
- GraphSnapshotActions consumes current analysis, graph view, database and snapshot stores; it produces save/rename/duplicate/export UI and never calls the backend for a local snapshot.
- useAnalysisStore.restoreSnapshot(hydration) consumes SnapshotHydration and sets phase: done, taskId: null, activeSocket: null, graph result, selected table metadata and analysis filters.

- [ ] Step 1: Write failing tests for snapshot store and dialog.

Cover list refresh, active record, dirty state, required name validation and “另存为” creating a new ID:

~~~tsx
it("requires a non-empty name before saving", async () => {
  render(<SnapshotNameDialog mode="save" onConfirm={vi.fn()} onCancel={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请输入图谱名称");
});
~~~

- [ ] Step 2: Implement snapshot store actions.

A failed save leaves dirty true and does not alter activeSnapshotId. A successful create or update refreshes the list and clears dirty.

- [ ] Step 3: Add analysis-store snapshot restoration.

Implement one restoreSnapshot(hydration) action. It closes the active WebSocket, clears transient errors, sets restored graph/status/diagnostics/warnings, creates selected table entries with stored field names and an empty columns array, sets taskId null and leaves the database connection untouched.

- [ ] Step 4: Implement save and “另存为” actions.

GraphSnapshotActions opens SnapshotNameDialog only when a completed or partial graph exists. “保存” uses the active ID when present; “另存为” always generates a new ID. Show 未保存, 已保存 HH:mm, 保存失败 and the local-storage warning in the same top context action area.

- [ ] Step 5: Implement GraphLibrary and reusable SnapshotList.

Load on mount, search by name with useDeferredValue, use storage output ordering, and render empty/error states from storage error codes. Opening a record validates it, restores analysis, hydrates graph view, sets it active and navigates to graph.

- [ ] Step 6: Add rename/delete confirmation and unsaved navigation guard.

Rename updates only the selected record name. Delete requires confirmation and keeps the list item if storage deletion fails. Before new analysis, opening another snapshot or leaving a dirty graph, show “保存并继续”, “放弃更改” and “取消”.

- [ ] Step 7: Support local and live JSON export.

A local snapshot serializes a GraphSnapshot Blob in the browser. A live task with taskId continues using /api/export/{task_id}. Local filenames use ai-graph-snapshot-<safe-name>-<timestamp>.json and contain no credentials.

- [ ] Step 8: Run focused library tests and commit.

Run: npm test -- --run src/components/__tests__/GraphLibrary.test.tsx src/components/__tests__/SnapshotNameDialog.test.tsx src/components/__tests__/GraphWorkbench.test.tsx src/components/__tests__/ExportButton.test.tsx  
Expected: PASS.

~~~powershell
git add frontend/src/store/snapshots.ts frontend/src/store/analysis.ts frontend/src/components/SnapshotList.tsx frontend/src/components/GraphLibrary.tsx frontend/src/components/SnapshotNameDialog.tsx frontend/src/components/GraphSnapshotActions.tsx frontend/src/components/WorkbenchHome.tsx frontend/src/components/WorkbenchHeader.tsx frontend/src/components/ExportButton.tsx frontend/src/components/GraphWorkbench.tsx frontend/src/index.css frontend/src/components/__tests__/GraphLibrary.test.tsx frontend/src/components/__tests__/SnapshotNameDialog.test.tsx
git commit -m "feat: add local graph library and snapshot actions"
~~~

### Task 5: Refactor the pre-analysis, progress and graph surfaces into one visual system

**Files:**
- Modify: frontend/src/components/SelectionWorkspace.tsx
- Modify: frontend/src/components/ProgressIndicator.tsx
- Modify: frontend/src/components/GraphWorkbench.tsx
- Modify: frontend/src/components/GraphToolbar.tsx
- Modify: frontend/src/components/NodeDetailPanel.tsx
- Modify: frontend/src/components/DataChainStrip.tsx
- Modify: frontend/src/components/GraphLegend.tsx
- Modify: frontend/src/index.css
- Modify: existing component tests for these modules

**Interfaces:**
- SelectionWorkspace continues to call existing selection store actions and AnalysisLauncher; only layout and copy hierarchy change.
- ProgressIndicator continues to consume currentPhase, progressValue, progressMessage, diagnostics and selectedTables; it never fabricates missing diagnostic numbers.
- GraphToolbar produces canvas controls only: confidence filter, isolated-node toggle, fit view and relayout. GraphSnapshotActions owns save/export actions.

- [ ] Step 1: Update component assertions for shared state semantics.

Keep tests focused on behavior: selection sends the same table/field payload, progress stages map to the same backend phase keys, and graph controls call requestFitView/requestRelayout.

- [ ] Step 2: Move graph title and save actions into WorkbenchHeader.

The graph detail header shows 图谱库 / 图谱名称, current save state and 保存 / 另存为 / 导出. Do not render a second product brand or second save control inside the canvas toolbar.

- [ ] Step 3: Restyle the pre-analysis surface without changing data flow.

Use the shared graphite shell, mineral-ivory summary surface, copper primary action and signal-cyan active state. Keep natural-language selection, manual selection, field refinement, table limits and existing error messages.

- [ ] Step 4: Restyle the progress surface as a phase rail and evidence panel.

Show the six existing phases in the same order; current phase is cyan, completed phases are positive/copper and pending phases are quiet. Use “等待数据” for missing diagnostics and keep the technical-details disclosure.

- [ ] Step 5: Fold the current data chain into the inspector.

Extract the chain calculation from DataChainStrip.tsx into a reusable detail section consumed by NodeDetailPanel. Remove the full-width bottom strip from GraphWorkbench so the graph canvas remains the primary surface.

- [ ] Step 6: Apply the shared CSS contract.

Use the existing CSS variables from index.css; define one nav width, one header height, one primary button treatment, one active navigation treatment and responsive rules for desktop, narrow tablet and mobile. Do not add gradients, glass, neon glow or extra equal-size card grids.

- [ ] Step 7: Run pre-analysis and graph component tests and commit.

Run: npm test -- --run src/components/__tests__/SelectionWorkspace.test.tsx src/components/__tests__/ProgressIndicator.test.tsx src/components/__tests__/GraphWorkbench.test.tsx src/components/__tests__/GraphToolbar.test.tsx  
Expected: PASS.

~~~powershell
git add frontend/src/components/SelectionWorkspace.tsx frontend/src/components/ProgressIndicator.tsx frontend/src/components/GraphWorkbench.tsx frontend/src/components/GraphToolbar.tsx frontend/src/components/NodeDetailPanel.tsx frontend/src/components/DataChainStrip.tsx frontend/src/components/GraphLegend.tsx frontend/src/index.css frontend/src/components/__tests__
git commit -m "feat: unify workbench analysis surfaces"
~~~

### Task 6: Implement the Obsidian-style entity-first graph

**Files:**
- Modify: frontend/src/graph/layout.ts
- Modify: frontend/src/graph/scene.ts
- Modify: frontend/src/graph/renderer.ts
- Modify: frontend/src/components/GraphCanvas.tsx
- Modify: frontend/src/components/GraphLegend.tsx
- Modify: frontend/src/graph/layout.test.ts
- Modify: frontend/src/graph/scene.test.ts
- Modify: frontend/src/graph/renderer.test.ts
- Modify: frontend/src/components/__tests__/GraphCanvas.test.tsx

**Interfaces:**
- BuildSceneInput gains showTableContext?: boolean, defaulting to false in the runtime graph view.
- computeNebulaLayout continues to return a deterministic GraphLayout; no table-based axis or lane assignment may be introduced.
- drawGraphScene consumes the entity-first scene and draws no outer circle, ring or radial backdrop.

- [ ] Step 1: Write failing layout tests for one organic coordinate space.

Use a fixture with entities from at least four source tables and assert deterministic finite positions without assigning a fixed y-band per table:

~~~ts
it("keeps entities in one deterministic organic coordinate space", () => {
  const first = computeNebulaLayout(graphFixture(), { width: 1200, height: 800 });
  const second = computeNebulaLayout(graphFixture(), { width: 1200, height: 800 });
  expect(first).toEqual(second);
  expect(first.entityNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  expect(new Set(first.entityNodes.map((node) => Math.round(node.y / 120))).size).toBeGreaterThan(1);
});
~~~

- [ ] Step 2: Remove visual table-band assumptions from the layout path.

Keep tableNodes and table edge coordinates for compatibility and technical context, but drive entity positions from one global force space using stable seeds, strong/weak link distances, collision forces and component separation only. Do not calculate positions from table order, domain order, columns or rows.

- [ ] Step 3: Write scene tests for entity-first rendering.

Assert that buildScene with showTableContext false still returns entity dots and entity edges but no visible table commands; showTableContext true remains available for technical regression tests. Assert source-table colors and solid/dashed strong/weak styles.

- [ ] Step 4: Implement the entity-first scene option.

In scene.ts, keep table data available for technical semantics but gate table node/table edge scene creation behind showTableContext. Keep business presentation labels, duplicate disambiguation and confidence filtering unchanged.

- [ ] Step 5: Write renderer regression tests for final visual rules.

Use the existing Canvas mock and assert the drawing path does not call arc() for an outer graph boundary, does not render table nodes when table context is disabled, and still renders grid, entity nodes, strong/weak edges, focused labels and drag previews.

- [ ] Step 6: Implement renderer and legend changes.

Keep only the existing low-contrast workspace grid as spatial assistance. Remove table-layer drawing from the default path, keep the legend for source color and strong/weak relation meaning, and preserve hover focus, search focus, edge selection, drag and keyboard interactions.

- [ ] Step 7: Verify the graph manually at representative sizes.

Use the existing visual harness with a small graph, a four-source graph, an empty graph, isolated nodes and a large graph. Confirm one open Obsidian-style universe: no lanes, no outer circle, no radial backdrop, no central pile-up and readable business labels at semantic zoom levels.

- [ ] Step 8: Run graph tests and commit.

Run: npm test -- --run src/graph/layout.test.ts src/graph/scene.test.ts src/graph/renderer.test.ts src/components/__tests__/GraphCanvas.test.tsx  
Expected: PASS.

~~~powershell
git add frontend/src/graph/layout.ts frontend/src/graph/scene.ts frontend/src/graph/renderer.ts frontend/src/components/GraphCanvas.tsx frontend/src/components/GraphLegend.tsx frontend/src/graph/*.test.ts frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "feat: render entity-first relationship universe"
~~~

### Task 7: Connect the complete workflow and verify responsive behavior

**Files:**
- Modify: frontend/src/__tests__/integration.test.tsx
- Modify: frontend/src/components/__tests__/GraphWorkbench.test.tsx
- Modify: frontend/src/components/__tests__/SelectionWorkspace.test.tsx
- Modify: frontend/src/index.css
- Modify: frontend/src/App.tsx

**Interfaces:**
- The integration test consumes existing mocked REST/WebSocket analysis flow plus the fake IndexedDB snapshot adapter.
- The completed workflow uses only useWorkbenchStore, useAnalysisStore, useGraphViewStore and useSnapshotStore as sources of truth for page, graph, view and snapshot state.

- [ ] Step 1: Add an integration test for the four workbench states.

Exercise: open home → click 新建分析 → choose mocked tables → start analysis → receive WebSocket progress → receive graph → save → navigate to 图谱库 → open the saved graph. Assert the same graph title, selected table count, node/relationship counts, taskId null for the local snapshot and restored view state.

- [ ] Step 2: Add failure-path integration coverage.

Cover IndexedDB unavailable, malformed snapshot, storage quota failure, delete failure, analysis error and partial analysis. Assert the current graph stays visible on local storage failure and JSON export remains available.

- [ ] Step 3: Add responsive and accessibility assertions.

Assert the global navigation has an accessible label, active page state, keyboard-focusable controls, dialog labels, live progress status and no hidden primary action at the narrow breakpoint.

- [ ] Step 4: Run full frontend verification.

Run from frontend:

~~~powershell
npm run lint
npm test -- --run
npm run build
~~~

Expected: lint, all Vitest tests and TypeScript/Vite build pass. From repository root also run:

~~~powershell
git diff --check
~~~

- [ ] Step 5: Perform visual acceptance against attached references.

Compare the implementation with:
- docs/superpowers/specs/assets/local-snapshot-workbench/01-workbench-library.png
- docs/superpowers/specs/assets/local-snapshot-workbench/02-analysis-before.png
- docs/superpowers/specs/assets/local-snapshot-workbench/03-analysis-progress.png
- docs/superpowers/specs/assets/local-snapshot-workbench/04-graph-detail-no-circle.png

Reject the implementation if any screen invents new navigation, changes shell width/header rhythm, uses conflicting sample data, reintroduces a graph outer circle, uses business lanes, hides the save action or promotes technical identifiers over business labels.

- [ ] Step 6: Commit the integrated workflow.

~~~powershell
git add frontend/src/App.tsx frontend/src/index.css frontend/src/__tests__/integration.test.tsx frontend/src/components/__tests__
git commit -m "test: verify local snapshot workbench workflow"
~~~

## Plan Self-Review

- Spec coverage: local IndexedDB persistence is covered by Task 1; view/layout restore by Task 2; persistent shell and four-page IA by Task 3; save/library actions by Task 4; consistent pre/progress/post surfaces by Task 5; no-circle entity-first graph by Task 6; responsive/error/integration verification by Task 7.
- Type consistency: PersistedGraphViewState is defined in Task 1 and consumed by graphView, serializer, GraphSnapshotActions and GraphCanvas; SnapshotHydration is defined in Task 1 and consumed by restoreSnapshot in Task 4; WorkbenchPage is defined in Task 3 and consumed by shell, nav and snapshot-open behavior.
- No placeholders: every task names exact files, interfaces, tests, commands, expected results and commit boundaries.
- Scope: no backend/API/database changes, no cloud sync, no collaboration, no annotations, no comparison and no unconfirmed navigation modules.
- Visual constraints: attached references are review assets, while the final graph rule explicitly removes the outer circle and preserves an open entity-first canvas.
