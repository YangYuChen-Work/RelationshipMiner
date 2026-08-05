# 图谱节点模糊定位 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持按一个或多个关键词模糊定位图谱节点，并在多个命中之间循环跳转。

**Architecture:** 新建纯函数模块处理搜索词规范化、OR 匹配、稳定排序和循环索引。GraphCanvas 基于当前投影图谱派生命中项，负责呈现匹配计数和“下一个”操作，并继续调用既有 requestNodeFocus 完成画布、选中状态和详情面板联动。

**Tech Stack:** React 19、TypeScript、Vitest、Testing Library、Zustand、D3。

## Global Constraints

- 仅搜索当前投影图谱的实体节点；不修改后端接口、图谱数据或 Zustand store API。
- 多个关键词以空白分隔，任一关键词命中即满足（OR）。
- 忽略大小写、全半角、首尾空白和连续空白差异。
- 继续匹配业务显示名称、重复项次级名称和 class_name；保留精确实体 ID 定位兼容性。
- 命中列表按业务展示名称、再按实体 ID 稳定排序；“下一个”从最后一项循环到第一项。
- 空输入不定位；无匹配提示“未找到匹配节点”且禁用“下一个”。

---

## File Structure

- Create: frontend/src/graph/nodeSearch.ts — 纯粹且可独立测试的节点搜索、稳定排序与循环索引函数。
- Create: frontend/src/graph/nodeSearch.test.ts — 验证搜索契约的单元测试。
- Modify: frontend/src/components/GraphCanvas.tsx — 将旧的单结果定位替换为搜索结果导航和可访问控件。
- Modify: frontend/src/components/__tests__/GraphCanvas.test.tsx — 覆盖画布搜索提交、循环跳转、无结果反馈及旧 ID 查找回归。

### Task 1: 节点搜索纯函数

**Files:**

- Create: frontend/src/graph/nodeSearch.ts
- Test: frontend/src/graph/nodeSearch.test.ts

**Interfaces:**

- Consumes: SearchableNode（id、primary、secondary、className）。
- Produces: searchNodes(nodes, query): SearchableNode[] 和 nextSearchIndex(currentIndex, resultCount): number。

- [ ] **Step 1: 写入 OR 匹配、规范化和稳定排序的失败测试**

```ts
import { describe, expect, it } from "vitest";
import { searchNodes } from "./nodeSearch";

it("matches any normalized keyword and sorts matches by business name then ID", () => {
  const results = searchNodes([
    { id: "b", primary: "订单", secondary: "", className: "Order" },
    { id: "a", primary: "客户账户", secondary: "A-1", className: "Customer" },
    { id: "c", primary: "发票", secondary: "", className: "Invoice" },
  ], "  ＣＵＳＴＯＭＥＲ   发票 ");

  expect(results.map((node) => node.id)).toEqual(["c", "a"]);
});
```

- [ ] **Step 2: 写入循环索引与空查询的失败测试**

```ts
import { nextSearchIndex, searchNodes } from "./nodeSearch";

it("wraps navigation after the final result and keeps empty queries empty", () => {
  expect(nextSearchIndex(1, 3)).toBe(2);
  expect(nextSearchIndex(2, 3)).toBe(0);
  expect(nextSearchIndex(0, 0)).toBe(-1);
  expect(searchNodes([{ id: "a", primary: "客户", secondary: "", className: null }], "  ")).toEqual([]);
});
```

- [ ] **Step 3: 运行单元测试并确认因模块缺失失败**

Run: `cd frontend && npm test -- src/graph/nodeSearch.test.ts`

Expected: FAIL，错误指出无法解析 ./nodeSearch。

- [ ] **Step 4: 实现最小搜索 API**

```ts
export interface SearchableNode {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
  readonly className: string | null;
}

export function searchNodes(
  nodes: readonly SearchableNode[],
  query: string,
): SearchableNode[] {
  const keywords = normalizedKeywords(query);
  if (keywords.length === 0) return [];
  return nodes.filter((node) => {
    const text = normalize([node.primary, node.secondary, node.className, node.id].filter(Boolean).join(" "));
    return keywords.some((keyword) => text.includes(keyword));
  }).toSorted((left, right) =>
    normalize(left.primary).localeCompare(normalize(right.primary)) || left.id.localeCompare(right.id)
  );
}

export function nextSearchIndex(currentIndex: number, resultCount: number): number {
  return resultCount > 0 ? (Math.max(currentIndex, -1) + 1) % resultCount : -1;
}
```

Implement normalize with NFKC, trim, whitespace collapsing and lowercase; implement normalizedKeywords by splitting the normalized query on one space.

- [ ] **Step 5: 运行单元测试并确认通过**

Run: `cd frontend && npm test -- src/graph/nodeSearch.test.ts`

Expected: PASS，且三个错误变更会被捕获：把 some 改为 every、移除 NFKC、取消模运算循环。

- [ ] **Step 6: 提交纯函数实现与测试**

```powershell
git add -- frontend/src/graph/nodeSearch.ts frontend/src/graph/nodeSearch.test.ts
git commit -m "feat: add fuzzy graph node search"
```

### Task 2: 画布搜索结果导航

**Files:**

- Modify: frontend/src/components/GraphCanvas.tsx
- Test: frontend/src/components/__tests__/GraphCanvas.test.tsx

**Interfaces:**

- Consumes: searchNodes 和 nextSearchIndex，以及现有 businessPresentations、projectedGraph、layout 和 requestNodeFocus。
- Produces: 搜索表单中的匹配计数、无结果状态和“下一个”循环聚焦行为。

- [ ] **Step 1: 写入多个关键词命中与“下一个”循环的失败组件测试**

在 GraphCanvas 默认 fixture 中，以可观测 store 行为验证：

```tsx
const search = screen.getByRole("searchbox", { name: "查找实体" });
fireEvent.change(search, { target: { value: "客户 发票" } });
fireEvent.submit(search.closest("form")!);

expect(screen.getByText("1 / 2")).toBeInTheDocument();
expect(useAnalysisStore.getState().selectedNodeId).toBe("invoice");

fireEvent.click(screen.getByRole("button", { name: "下一个匹配节点" }));
expect(screen.getByText("2 / 2")).toBeInTheDocument();
expect(useAnalysisStore.getState().selectedNodeId).toBe("a");

fireEvent.click(screen.getByRole("button", { name: "下一个匹配节点" }));
expect(useAnalysisStore.getState().selectedNodeId).toBe("invoice");
```

Use a dedicated fixture whose business names are 客户 and 发票, and whose IDs sort differently, so the test proves the user-visible stable ordering rather than fixture order.

- [ ] **Step 2: 写入无结果与兼容实体 ID 的失败组件测试**

```tsx
fireEvent.change(search, { target: { value: "不存在" } });
fireEvent.submit(search.closest("form")!);
expect(screen.getByText("未找到匹配节点")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "下一个匹配节点" })).toBeDisabled();

fireEvent.change(search, { target: { value: "entity-6999" } });
fireEvent.submit(search.closest("form")!);
expect(useAnalysisStore.getState().selectedNodeId).toBe("entity-6999");
```

- [ ] **Step 3: 运行组件测试并确认因控件和行为缺失失败**

Run: `cd frontend && npm test -- src/components/__tests__/GraphCanvas.test.tsx`

Expected: FAIL，错误指向缺少 1 / 2 或“下一个匹配节点”；现有单结果 locateEntity 不会产生循环导航。

- [ ] **Step 4: 在 GraphCanvas 接入派生匹配与聚焦**

Replace the rank-first locateEntity branch with:

```tsx
const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
const searchResults = useMemo(
  () => searchNodes(searchableEntities.map(({ entity, presentation }) => ({
    id: entity.id,
    primary: presentation.primary,
    secondary: presentation.secondary,
    className: entity.class_name,
  })), searchQuery),
  [searchQuery, searchableEntities],
);
```

Add focusSearchResult(index) that finds the matching layout node, invokes setKeyboardTarget, requestNodeFocus(result.id), and records activeSearchIndex. Make form submission focus index 0; make the next button call focusSearchResult(nextSearchIndex(activeSearchIndex, searchResults.length)). Reset the active index to -1 in the input onChange.

Render a count only for a non-empty query; render 未找到匹配节点 if it has no results. Add the accessible button:

```tsx
<button
  type="button"
  aria-label="下一个匹配节点"
  disabled={searchResults.length === 0}
  onClick={focusNextSearchResult}
>
  下一个
</button>
```

- [ ] **Step 5: 运行组件测试并确认通过**

Run: `cd frontend && npm test -- src/components/__tests__/GraphCanvas.test.tsx`

Expected: PASS。旧的精确业务名称、重复码与实体 ID 查找测试均继续通过。

- [ ] **Step 6: 提交画布交互与回归测试**

```powershell
git add -- frontend/src/components/GraphCanvas.tsx frontend/src/components/__tests__/GraphCanvas.test.tsx
git commit -m "feat: navigate fuzzy graph node matches"
```

### Task 3: 完整验证

**Files:**

- Verify: frontend/src/graph/nodeSearch.ts
- Verify: frontend/src/components/GraphCanvas.tsx

**Interfaces:**

- Consumes: Tasks 1 and 2 的完整搜索导航契约。
- Produces: 可发布的前端变更，无类型、lint 或回归测试失败。

- [ ] **Step 1: 运行完整前端测试**

Run: `cd frontend && npm test`

Expected: PASS，且无未处理异常。

- [ ] **Step 2: 运行静态检查**

Run: `cd frontend && npm run lint`

Expected: exit code 0。

- [ ] **Step 3: 运行生产构建**

Run: `cd frontend && npm run build`

Expected: TypeScript 和 Vite 构建成功。

- [ ] **Step 4: 检查最终差异**

Run: `git diff HEAD~2 --check; git status --short`

Expected: git diff --check 无输出，且仅存在本功能涉及的已提交文件。
