import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SelectionWorkspace from "../SelectionWorkspace";
import { useAnalysisStore } from "../../store/analysis";

const columns = [
  {
    name: "class_name",
    type: "varchar",
    is_class_name: true,
    is_primary_key: false,
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
      selectedTables: new Map(),
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      tableErrors: new Map(),
      maxTables: 10,
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
            selectedFields: new Set(["class_name"]),
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
      await screen.findByRole("checkbox", { name: "选择表 UserAccounts" })
    ).toBeChecked();
  });
});
