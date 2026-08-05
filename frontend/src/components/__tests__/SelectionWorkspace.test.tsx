import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SelectionWorkspace from "../SelectionWorkspace";
import { useAnalysisStore } from "../../store/analysis";

const columns = [
  {
    name: "class_name",
    type: "varchar",
    is_name: false,
    is_class_name: true,
    is_primary_key: false,
    is_foreign_key: false,
  },
];

describe("SelectionWorkspace table search", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      tables: [
        { name: "UserAccounts" },
        { name: "audit_users" },
        { name: "orders" },
      ],
      tablesLoading: false,
      tablesError: null,
      tableSummaries: new Map(),
      tableSummariesWarning: null,
      selectedTables: new Map(),
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      tableErrors: new Map(),
      maxTables: 10,
      selectionMode: "manual",
      selectionDirty: false,
      pendingAIReplacement: null,
      previousSelection: null,
    });
  });

  it("filters table names in real time ignoring case and surrounding spaces", async () => {
    const user = userEvent.setup();
    render(<SelectionWorkspace />);

    await user.type(
      screen.getByRole("searchbox", { name: "搜索表名" }),
      "  USER  "
    );

    await waitFor(() => {
      expect(screen.getByText("UserAccounts")).toBeInTheDocument();
      expect(screen.getByText("audit_users")).toBeInTheDocument();
      expect(screen.queryByText("orders")).not.toBeInTheDocument();
    });
  });

  it("uses natural language mode by default while retaining the manual tab", () => {
    useAnalysisStore.setState({ selectionMode: "natural" });
    render(<SelectionWorkspace />);
    expect(
      screen.getByRole("tab", { name: "\u81ea\u7136\u8bed\u8a00\u9009\u53d6" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "\u624b\u52a8\u9009\u53d6" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "\u63cf\u8ff0\u8981\u5206\u6790\u7684\u4e1a\u52a1\u5173\u7cfb" })).toBeVisible();
  });

  it("restores the complete table list when the search is cleared", async () => {
    const user = userEvent.setup();
    render(<SelectionWorkspace />);
    const searchInput = screen.getByRole("searchbox", { name: "搜索表名" });

    await user.type(searchInput, "orders");
    await waitFor(() => {
      expect(screen.queryByText("UserAccounts")).not.toBeInTheDocument();
    });

    await user.clear(searchInput);

    await waitFor(() => {
      expect(screen.getByText("UserAccounts")).toBeInTheDocument();
      expect(screen.getByText("orders")).toBeInTheDocument();
    });
  });

  it("shows a search-specific empty state when no table name matches", async () => {
    const user = userEvent.setup();
    render(<SelectionWorkspace />);

    await user.type(
      screen.getByRole("searchbox", { name: "搜索表名" }),
      "products"
    );

    expect(await screen.findByText("未找到匹配的数据表")).toBeInTheDocument();
    expect(
      screen.queryByText("未发现任何表，请检查数据库连接。")
    ).not.toBeInTheDocument();
  });

  it("keeps a selected table selected while search hides it", async () => {
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "UserAccounts",
          {
            name: "UserAccounts",
            columns,
            selectedFields: new Set(),
          },
        ],
      ]),
    });
    const user = userEvent.setup();
    render(<SelectionWorkspace />);
    const searchInput = screen.getByRole("searchbox", { name: "搜索表名" });

    await user.type(searchInput, "orders");
    await waitFor(() => {
      expect(screen.queryByText("UserAccounts")).not.toBeInTheDocument();
      expect(screen.getByText("1 / 10 表")).toBeInTheDocument();
    });

    await user.clear(searchInput);

    expect(
      await screen.findByRole("checkbox", {
        name: "选择业务数据 UserAccounts",
      }),
    ).toBeChecked();
  });

  it("does not claim system fields are retained as user selections", () => {
    render(<SelectionWorkspace />);

    expect(screen.queryByText("主键与类名字段会始终保留。")).not.toBeInTheDocument();
  });

  it("uses business selection copy while retaining original names without summaries", () => {
    useAnalysisStore.setState({
      tableSummariesWarning: "获取业务数据摘要失败 (HTTP 503)",
    });

    render(<SelectionWorkspace />);

    expect(
      screen.getByRole("heading", { name: "选择要分析的业务数据" }),
    ).toBeVisible();
    expect(screen.getByText("UserAccounts")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "选择业务数据 UserAccounts" }),
    ).toBeEnabled();
    expect(screen.queryByText("加载失败")).not.toBeInTheDocument();
  });

  it("shows safe database connection facts in the selection workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          connection_status: "connected",
          database_name: "operations",
          connection_address: "db.internal:3307/operations",
          table_count: 4,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    render(<SelectionWorkspace />);

    const databaseInfo = await screen.findByRole("region", {
      name: "数据库信息",
    });
    expect(databaseInfo).toHaveTextContent("已连接");
    expect(databaseInfo).toHaveTextContent("operations");
    expect(databaseInfo).toHaveTextContent("db.internal:3307/operations");
    expect(databaseInfo).toHaveTextContent("4 张表");
    expect(databaseInfo).not.toHaveTextContent("root");
    expect(fetch).toHaveBeenCalledWith("/api/database-info");
  });
});
