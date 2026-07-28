# 数据库表搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在“选择数据表”区域增加按表名忽略大小写的实时模糊搜索，并在约 3000 张表时保持输入响应。

**Architecture:** 搜索词保留在 `TableSelector` 本地，不进入 Zustand store。组件通过 `useDeferredValue` 生成低优先级搜索词，再用 `useMemo` 从现有完整表列表派生可见列表，因此不会改变加载接口、表选择状态或字段选择状态。

**Tech Stack:** React 19、TypeScript、Zustand、Tailwind CSS、Vitest、Testing Library

## Global Constraints

- 仅按表名匹配，不搜索字段名。
- 匹配忽略大小写，搜索词匹配前去除首尾空格。
- 输入时实时刷新结果，不增加固定时间防抖或提交按钮。
- 搜索只改变可见列表，不改变已选表及其字段状态。
- 使用 `useDeferredValue` 和 `useMemo`；本次不增加虚拟列表依赖。
- 不修改后端接口或 Zustand store 接口。

---

## File Structure

- Modify: `frontend/src/components/TableSelector.tsx` — 保存搜索词、派生过滤结果、渲染搜索框与搜索空状态。
- Modify: `frontend/src/components/__tests__/TableSelector.test.tsx` — 验证匹配规则、实时刷新、清空恢复、空状态和选择状态保持。

### Task 1: 实时表名过滤

**Files:**
- Modify: `frontend/src/components/TableSelector.tsx`
- Test: `frontend/src/components/__tests__/TableSelector.test.tsx`

**Interfaces:**
- Consumes: Zustand store 的 `tables: TableInfo[]` 与现有 `selectedTables`。
- Produces: 组件本地 `searchQuery: string`、`deferredSearchQuery: string`、`filteredTables: TableInfo[]`；不导出新接口。

- [ ] **Step 1: 写入过滤、清空恢复与选择状态保持的失败测试**

将 Testing Library 导入改为：

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
```

在 `TableSelector` 测试组中加入：

```tsx
it("filters table names in real time ignoring case and surrounding spaces", async () => {
  mockFetchTables([
    { name: "UserAccounts" },
    { name: "audit_users" },
    { name: "orders" },
  ]);
  const user = userEvent.setup();

  render(<TableSelector />);

  const searchInput = await screen.findByRole("searchbox", {
    name: "搜索表名",
  });
  await user.type(searchInput, "  USER  ");

  await waitFor(() => {
    expect(screen.getByText("UserAccounts")).toBeInTheDocument();
    expect(screen.getByText("audit_users")).toBeInTheDocument();
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });
});

it("restores the complete table list when the search is cleared", async () => {
  mockFetchTables([{ name: "users" }, { name: "orders" }]);
  const user = userEvent.setup();

  render(<TableSelector />);

  const searchInput = await screen.findByRole("searchbox", {
    name: "搜索表名",
  });
  await user.type(searchInput, "users");
  await waitFor(() => {
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });

  await user.clear(searchInput);

  await waitFor(() => {
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
  });
});

it("keeps a selected table selected while search hides it", async () => {
  mockFetchTables([{ name: "users" }, { name: "orders" }]);
  useAnalysisStore.setState({
    selectedTables: new Map([
      [
        "users",
        {
          name: "users",
          columns: MOCK_COLUMNS,
          selectedFields: new Set(["class_name"]),
        },
      ],
    ]),
  });
  const user = userEvent.setup();

  render(<TableSelector />);

  const searchInput = await screen.findByRole("searchbox", {
    name: "搜索表名",
  });
  await user.type(searchInput, "orders");

  await waitFor(() => {
    expect(screen.queryByText("users")).not.toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });

  await user.clear(searchInput);

  const usersCheckbox = await screen.findByRole("checkbox", {
    name: "users",
  });
  expect(usersCheckbox).toBeChecked();
});
```

- [ ] **Step 2: 运行测试并确认它因缺少搜索框而失败**

Run:

```powershell
cd frontend
npm test -- src/components/__tests__/TableSelector.test.tsx
```

Expected: FAIL，错误指出找不到名称为“搜索表名”的 `searchbox`。

- [ ] **Step 3: 加入搜索状态和派生过滤列表**

将 React 导入改为：

```tsx
import { useDeferredValue, useEffect, useMemo, useState } from "react";
```

在读取 store 状态后加入：

```tsx
const [searchQuery, setSearchQuery] = useState("");
const deferredSearchQuery = useDeferredValue(searchQuery);
const normalizedSearchQuery = deferredSearchQuery.trim().toLocaleLowerCase();
const filteredTables = useMemo(
  () =>
    normalizedSearchQuery
      ? tables.filter((table) =>
          table.name.toLocaleLowerCase().includes(normalizedSearchQuery)
        )
      : tables,
  [normalizedSearchQuery, tables]
);
```

在表列表前加入输入框：

```tsx
<div className="relative">
  <input
    type="search"
    aria-label="搜索表名"
    placeholder="搜索表名"
    value={searchQuery}
    onChange={(event) => setSearchQuery(event.target.value)}
    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
  />
</div>
```

将列表映射从 `tables.map` 改为：

```tsx
{filteredTables.map((t) => {
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
cd frontend
npm test -- src/components/__tests__/TableSelector.test.tsx
```

Expected: 三个新测试与原有 `TableSelector` 测试全部 PASS。

- [ ] **Step 5: 提交实时过滤功能**

```powershell
git add -- frontend/src/components/TableSelector.tsx frontend/src/components/__tests__/TableSelector.test.tsx
git commit -m "feat: add real-time table name search"
```

### Task 2: 搜索空状态

**Files:**
- Modify: `frontend/src/components/TableSelector.tsx`
- Test: `frontend/src/components/__tests__/TableSelector.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 `searchQuery`、`normalizedSearchQuery` 和 `filteredTables`。
- Produces: 搜索无匹配结果时的“未找到匹配的数据表”状态。

- [ ] **Step 1: 写入搜索无结果的失败测试**

```tsx
it("shows a search-specific empty state when no table name matches", async () => {
  mockFetchTables([{ name: "users" }, { name: "orders" }]);
  const user = userEvent.setup();

  render(<TableSelector />);

  const searchInput = await screen.findByRole("searchbox", {
    name: "搜索表名",
  });
  await user.type(searchInput, "products");

  expect(
    await screen.findByText("未找到匹配的数据表")
  ).toBeInTheDocument();
  expect(
    screen.queryByText("未发现任何表，请检查数据库连接")
  ).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试并确认缺少搜索空状态**

Run:

```powershell
cd frontend
npm test -- src/components/__tests__/TableSelector.test.tsx
```

Expected: FAIL，错误指出找不到“未找到匹配的数据表”。

- [ ] **Step 3: 加入搜索专用空状态**

保留现有 `tables.length === 0` 空状态，并在其后加入：

```tsx
{tables.length > 0 &&
  normalizedSearchQuery &&
  filteredTables.length === 0 && (
    <p className="text-gray-400 text-sm">未找到匹配的数据表</p>
  )}
```

- [ ] **Step 4: 运行测试并确认通过**

Run:

```powershell
cd frontend
npm test -- src/components/__tests__/TableSelector.test.tsx
```

Expected: 新增空状态测试与所有既有测试 PASS。

- [ ] **Step 5: 提交空状态与回归测试**

```powershell
git add -- frontend/src/components/TableSelector.tsx frontend/src/components/__tests__/TableSelector.test.tsx
git commit -m "test: cover table search states"
```

### Task 3: 全量验证

**Files:**
- Verify: `frontend/src/components/TableSelector.tsx`
- Verify: `frontend/src/components/__tests__/TableSelector.test.tsx`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的完整搜索行为。
- Produces: 通过测试、静态检查和生产构建验证的前端功能。

- [ ] **Step 1: 运行全部前端测试**

Run:

```powershell
cd frontend
npm test
```

Expected: 所有 Vitest 测试 PASS，无未处理异常。

- [ ] **Step 2: 运行 lint**

Run:

```powershell
cd frontend
npm run lint
```

Expected: oxlint 退出码为 0。

- [ ] **Step 3: 运行生产构建**

Run:

```powershell
cd frontend
npm run build
```

Expected: TypeScript 与 Vite 构建成功，退出码为 0。

- [ ] **Step 4: 检查最终差异**

Run:

```powershell
git diff HEAD~2 --check
git status --short
```

Expected: `git diff --check` 无输出；工作区不包含未提交的功能文件。
