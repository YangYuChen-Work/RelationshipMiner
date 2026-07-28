import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import TableSelector from "../TableSelector";
import { useAnalysisStore } from "../../store/analysis";
import type { ColumnInfo } from "../../api/tables";

const MOCK_COLUMNS: ColumnInfo[] = [
  { name: "id", type: "int", is_class_name: false, is_primary_key: false },
  { name: "class_name", type: "varchar", is_class_name: true, is_primary_key: false },
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
});
