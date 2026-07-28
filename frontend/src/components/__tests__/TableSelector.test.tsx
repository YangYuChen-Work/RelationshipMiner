import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import TableSelector from "../TableSelector";
import { useAnalysisStore } from "../../store/analysis";
import type { ColumnInfo } from "../../api/tables";

const MOCK_COLUMNS: ColumnInfo[] = [
  { name: "id", type: "int", is_class_name: false },
  { name: "class_name", type: "varchar", is_class_name: true },
];

/** Mock fetch to return empty tables (component calls loadTables on mount). */
function mockFetchTables(tables: { name: string }[] = []) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url === "/api/tables") {
      return { ok: true, json: () => Promise.resolve(tables) } as Response;
    }
    if (url.includes("/fields")) {
      return {
        ok: true,
        json: () => Promise.resolve({ table_name: url.split("/")[2], columns: MOCK_COLUMNS }),
      } as Response;
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response;
  });
}

describe("TableSelector", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      tables: [],
      tablesLoading: false,
      selectedTables: new Map(),
      maxTables: 10,
      errorMessage: null,
    });
    vi.restoreAllMocks();
  });

  it("shows loading spinner when tables are loading", () => {
    useAnalysisStore.setState({ tablesLoading: true });

    render(<TableSelector />);
    expect(screen.getByText("正在加载表列表...")).toBeInTheDocument();
  });

  it("renders table list from store", async () => {
    mockFetchTables([]);
    useAnalysisStore.setState({ tablesLoading: false });
    // Set tables AFTER render so loadTables doesn't overwrite them,
    // or mock fetch to return them.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ name: "users" }, { name: "orders" }, { name: "products" }]),
    } as Response);

    render(<TableSelector />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.getByText("products")).toBeInTheDocument();
  });

  it("shows empty state when no tables found", async () => {
    mockFetchTables([]);

    render(<TableSelector />);

    await waitFor(() => {
      expect(
        screen.getByText("未发现任何表，请检查数据库连接")
      ).toBeInTheDocument();
    });
  });

  it("shows selection count badge", async () => {
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

    render(<TableSelector />);

    await waitFor(() => {
      expect(screen.getByText("1 / 10")).toBeInTheDocument();
    });
  });

  it("shows error message when load fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("数据库连接失败")
    );

    render(<TableSelector />);

    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });
  });

  it("disabled checkboxes show visual feedback when at max", async () => {
    // Create 10 selected tables (at max)
    const selectedMap = new Map<string, {
      name: string;
      columns: ColumnInfo[];
      selectedFields: Set<string>;
    }>();
    for (let i = 0; i < 10; i++) {
      selectedMap.set(`t${i}`, {
        name: `t${i}`,
        columns: MOCK_COLUMNS,
        selectedFields: new Set(["class_name"]),
      });
    }

    mockFetchTables(Array.from({ length: 12 }, (_, i) => ({ name: `t${i}` })));
    useAnalysisStore.setState({
      selectedTables: selectedMap,
      maxTables: 10,
    });

    render(<TableSelector />);

    // Wait for the table list to render
    await waitFor(() => {
      expect(screen.getByText("10 / 10")).toBeInTheDocument();
    });
  });

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
});
