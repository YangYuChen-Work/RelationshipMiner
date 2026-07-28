/** 前端集成测试 — mock 后端 API 和 WebSocket，验证完整用户流程。 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "../App";
import { useAnalysisStore } from "../store/analysis";

// ── Mock 数据 ──

const MOCK_TABLES = [
  { name: "users" },
  { name: "orders" },
];

const MOCK_COLUMNS = {
  table_name: "users",
  columns: [
    { name: "id", type: "int", is_class_name: false, is_primary_key: false },
    { name: "class_name", type: "varchar", is_class_name: true, is_primary_key: false },
    { name: "name", type: "varchar", is_class_name: false, is_primary_key: false },
    { name: "email", type: "varchar", is_class_name: false, is_primary_key: false },
  ],
};

const MOCK_COLUMNS_ORDERS = {
  table_name: "orders",
  columns: [
    { name: "id", type: "int", is_class_name: false, is_primary_key: false },
    { name: "class_name", type: "varchar", is_class_name: true, is_primary_key: false },
    { name: "user_id", type: "int", is_class_name: false, is_primary_key: false },
    { name: "total", type: "decimal", is_class_name: false, is_primary_key: false },
  ],
};

const MOCK_GRAPH = {
  nodes: [
    {
      id: "users|1",
      source_table: "users",
      class_name: "com.example.User",
      field_values: { id: 1, name: "Alice" },
      degree: 1,
    },
    {
      id: "orders|1",
      source_table: "orders",
      class_name: "com.example.Order",
      field_values: { id: 1, user_id: 1 },
      degree: 1,
    },
  ],
  edges: [
    {
      source: "users|1",
      target: "orders|1",
      labels: ["外键关联"],
      confidence: 1,
    },
  ],
};

// ── Fake WebSocket ──

class FakeWebSocket {
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  static instances: FakeWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  // Helper: simulate server sending messages
  sendMessage(data: object) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  close() {
    if (this.onclose) this.onclose();
  }
}

// ── Test Setup ──

function setupFetchMock() {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/tables") {
        return {
          ok: true,
          json: () => Promise.resolve(MOCK_TABLES),
        } as Response;
      }

      if (url === "/api/tables/users/fields") {
        return {
          ok: true,
          json: () => Promise.resolve(MOCK_COLUMNS),
        } as Response;
      }

      if (url === "/api/tables/orders/fields") {
        return {
          ok: true,
          json: () => Promise.resolve(MOCK_COLUMNS_ORDERS),
        } as Response;
      }

      if (url === "/api/analyze") {
        return {
          ok: true,
          json: () => Promise.resolve({ task_id: "test-task-1" }),
        } as Response;
      }

      return { ok: false, json: () => Promise.resolve({}) } as Response;
    }
  );

  return fetchMock;
}

describe("Integration: full user flow", () => {
  beforeEach(() => {
    // Reset store
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      tables: [],
      tablesLoading: false,
      tablesError: null,
      selectedTables: new Map(),
      tableErrors: new Map(),
      maxTables: 10,
      currentPhase: 0,
      progressMessage: "",
      progressValue: 0,
      graph: null,
      taskId: null,
      hoveredNodeId: null,
      selectedNodeId: null,
      confidenceThreshold: 0,
    });

    // Reset WebSocket instances
    FakeWebSocket.instances = [];
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the app with title", async () => {
    setupFetchMock();

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "AI 关系图谱分析" })
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "选择数据库表与字段，AI 自动发现数据间的隐藏关联"
        )
      ).toBeInTheDocument();
    });
  });

  it("loads tables on mount", async () => {
    setupFetchMock();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });
    expect(screen.getByText("orders")).toBeInTheDocument();
  });

  it("allows selecting a table and loads its fields", async () => {
    setupFetchMock();

    render(<App />);

    // Wait for tables to load
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Click on users table to select it
    const usersLabel = screen.getByText("users").closest("label");
    expect(usersLabel).not.toBeNull();
    fireEvent.click(usersLabel!);

    // FieldSelector should appear with the table's fields
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });
  });

  it("shows '开始分析' button disabled when no tables selected", async () => {
    setupFetchMock();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    const btn = screen.getByText("开始分析");
    expect(btn).toBeDisabled();
  });

  it("completes full analysis flow with progress", async () => {
    setupFetchMock();
    // Mock WebSocket
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    // Wait for tables to load and select "users"
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select users table
    fireEvent.click(screen.getByText("users").closest("label")!);

    // Wait for fields to load
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    // "开始分析" should now be enabled
    const startBtn = screen.getByText("开始分析");
    expect(startBtn).not.toBeDisabled();

    // Click start analysis
    fireEvent.click(startBtn);

    // Should show analyzing state
    await waitFor(() => {
      expect(screen.getByText(/阶段/)).toBeInTheDocument();
    });

    // Simulate WebSocket progress
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    ws.sendMessage({
      phase: 1,
      message: "正在读取数据...",
      progress: 0.2,
    });

    await waitFor(() => {
      expect(screen.getByText("阶段 1/5：数据读取")).toBeInTheDocument();
    });

    ws.sendMessage({
      phase: 2,
      message: "正在分析 Schema...",
      progress: 0.4,
    });

    await waitFor(() => {
      expect(screen.getByText("阶段 2/5：Schema 分析")).toBeInTheDocument();
    });

    ws.sendMessage({
      phase: 3,
      message: "AI 决策中...",
      progress: 0.6,
    });

    ws.sendMessage({
      phase: 4,
      message: "正在计算关系...",
      progress: 0.8,
    });

    // Send completion message
    ws.sendMessage({
      phase: 5,
      message: "图谱生成完成",
      progress: 1.0,
      graph: MOCK_GRAPH,
    });

    // Should show completion
    await waitFor(() => {
      expect(screen.getByText("分析完成")).toBeInTheDocument();
    });

    // Should show node count
    await waitFor(() => {
      expect(
        screen.getAllByText(/2 个节点.*1 条关系/).length
      ).toBeGreaterThan(0);
    });

    // Should show StrengthFilter and ExportButton
    expect(screen.getByText("弱关系")).toBeInTheDocument();
    expect(screen.getByText("强关系")).toBeInTheDocument();
    expect(screen.getByText("导出 JSON")).toBeInTheDocument();
    expect(screen.getByText("开始新分析")).toBeInTheDocument();

    // TODO: GraphCanvas SVG rendering is hard to test in jsdom
    // (D3 requires SVG namespace which jsdom partially supports)

    vi.unstubAllGlobals();
  });

  it("handles analysis error from WebSocket", async () => {
    setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select table and start analysis
    fireEvent.click(screen.getByText("users").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("开始分析"));

    // Wait for the WS to be created
    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });

    // Send error via WebSocket
    const ws = FakeWebSocket.instances[0];
    ws.sendMessage({
      phase: 0,
      message: "分析超时",
      progress: 0,
      error: "分析超时，建议减少表数量或行数后重试",
    });

    await waitFor(() => {
      expect(screen.getByText("分析失败")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("checkbox", { name: "选择表 users" })
    ).toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  it("disables unselected tables when the workspace has reached its limit", () => {
    // This fails if the workspace does not derive the disabled state from all ten selections.
    const selectedTables = new Map(
      Array.from({ length: 10 }, (_, index) => [
        `table_${index}`,
        {
          name: `table_${index}`,
          columns: MOCK_COLUMNS.columns,
          selectedFields: new Set(["class_name"]),
        },
      ])
    );
    useAnalysisStore.setState({
      tables: [{ name: "overflow" }],
      tablesLoading: false,
      tablesError: null,
      selectedTables,
      maxTables: 10,
    });

    render(<App />);

    expect(
      screen.getByRole("checkbox", { name: "选择表 overflow" })
    ).toBeDisabled();
    expect(
      screen.getByText("已达到十表上限，取消选择后可继续添加。")
    ).toBeVisible();
  });

  it("resets to select phase when '开始新分析' is clicked", async () => {
    setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select table and run through analysis to completion
    fireEvent.click(screen.getByText("users").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("开始分析"));

    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = FakeWebSocket.instances[0];
    ws.sendMessage({
      phase: 5,
      message: "完成",
      progress: 1.0,
      graph: MOCK_GRAPH,
    });

    await waitFor(() => {
      expect(screen.getByText("分析完成")).toBeInTheDocument();
    });

    // Click "开始新分析"
    fireEvent.click(screen.getByText("开始新分析"));

    // Should go back to select phase
    await waitFor(() => {
      expect(screen.getByText("选择数据表与字段")).toBeInTheDocument();
    });

    vi.unstubAllGlobals();
  });

  it("displays DB connection error when tables fetch fails", async () => {
    // Mock fetch to simulate database connection failure
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/tables") {
        return {
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({
              detail: {
                detail: "数据库连接失败，请检查 .env 文件中的数据库配置",
                suggestion: "确认 DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME 配置正确",
              },
            }),
        } as Response;
      }

      return { ok: false, json: () => Promise.resolve({}) } as Response;
    });

    render(<App />);

    // TableSelector shows inline error state with "加载失败" title
    await waitFor(() => {
      expect(screen.getByText("加载失败")).toBeInTheDocument();
    });

    // Should show the error message
    expect(
      screen.getByText(/数据库连接失败/)
    ).toBeInTheDocument();

    // Should show retry button (TableSelector's inline retry)
    expect(screen.getByText("重试")).toBeInTheDocument();

    vi.restoreAllMocks();
  });

  it("shows empty state when analysis completes with no edges", async () => {
    setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const graphWithNoEdges = {
      nodes: [
        {
          id: "users|1",
          source_table: "users",
          class_name: "com.example.User",
          field_values: { id: 1, name: "Alice" },
          degree: 0,
        },
        {
          id: "users|2",
          source_table: "users",
          class_name: "com.example.Admin",
          field_values: { id: 2, name: "Bob" },
          degree: 0,
        },
      ],
      edges: [],
    };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select users table and run analysis
    fireEvent.click(screen.getByText("users").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("开始分析"));

    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = FakeWebSocket.instances[0];
    ws.sendMessage({
      phase: 5,
      message: "分析完成",
      progress: 1.0,
      graph: graphWithNoEdges,
    });

    // Should still reach done phase
    await waitFor(() => {
      expect(screen.getByText("分析完成")).toBeInTheDocument();
    });

    // Should show empty state prompt
    await waitFor(() => {
      expect(
        screen.getByText(/未发现任何关系/)
      ).toBeInTheDocument();
    });

    // Should show node count (2 nodes, 0 edges)
    expect(
      screen.getAllByText(/0 条关系/).length
    ).toBeGreaterThan(0);

    vi.unstubAllGlobals();
  });

  it("displays timeout error when analysis times out via WebSocket", async () => {
    setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select users table and run analysis
    fireEvent.click(screen.getByText("users").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("开始分析"));

    await waitFor(() => {
      expect(FakeWebSocket.instances.length).toBeGreaterThan(0);
    });

    const ws = FakeWebSocket.instances[0];
    ws.sendMessage({
      phase: -1,
      message: "分析超时（180 秒），建议减少表数量或行数后重试",
      progress: 0,
      error: "分析超时（180 秒），建议减少表数量或行数后重试",
    });

    // Should show error banner
    await waitFor(() => {
      expect(screen.getByText("分析失败")).toBeInTheDocument();
    });

    // Should show timeout message (may appear in both App banner and TableSelector error state)
    const timeoutMatches = screen.getAllByText(/分析超时/);
    expect(timeoutMatches.length).toBeGreaterThanOrEqual(1);
    const suggestionMatches = screen.getAllByText(/建议减少表数量或行数后重试/);
    expect(suggestionMatches.length).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();
  });

  it("handles WebSocket onError connection failure", async () => {
    setupFetchMock();

    // Override WebSocket to simulate immediate error
    class ErrorWebSocket {
      url: string;
      onmessage: ((event: { data: string }) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: (() => void) | null = null;

      constructor(url: string) {
        this.url = url;
        // Fire error immediately after construction
        setTimeout(() => {
          if (this.onerror) this.onerror(new Event("error"));
          if (this.onclose) this.onclose();
        }, 0);
      }
    }
    vi.stubGlobal("WebSocket", ErrorWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select users table and run analysis
    fireEvent.click(screen.getByText("users").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("开始分析"));

    // Should show connection error
    await waitFor(() => {
      expect(screen.getByText("分析失败")).toBeInTheDocument();
    });

    expect(
      screen.getAllByText(/WebSocket 连接失败/).length
    ).toBeGreaterThanOrEqual(1);

    vi.unstubAllGlobals();
  });
});
