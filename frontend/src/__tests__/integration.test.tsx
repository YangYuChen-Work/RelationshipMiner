/** 前端集成测试 — mock 后端 API 和 WebSocket，验证完整用户流程。 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import * as d3 from "d3";
import App from "../App";
import type {
  AnalysisDiagnostics,
  AnalysisStatus,
  SemanticGraphData,
} from "../api/analysis";
import { computeGroupedLayout } from "../graph/layout";
import { useAnalysisStore } from "../store/analysis";

// ── Mock 数据 ──

const MOCK_TABLES = [
  { name: "users" },
  { name: "orders" },
];

const MOCK_COLUMNS = {
  table_name: "users",
  columns: [
    { name: "id", type: "int", is_class_name: false, is_primary_key: true },
    { name: "class_name", type: "varchar", is_class_name: true, is_primary_key: false },
    { name: "name", type: "varchar", is_class_name: false, is_primary_key: false },
    { name: "email", type: "varchar", is_class_name: false, is_primary_key: false },
  ],
};

const MOCK_COLUMNS_ORDERS = {
  table_name: "orders",
  columns: [
    { name: "id", type: "int", is_class_name: false, is_primary_key: true },
    { name: "class_name", type: "varchar", is_class_name: true, is_primary_key: false },
    { name: "user_id", type: "int", is_class_name: false, is_primary_key: false },
    { name: "total", type: "decimal", is_class_name: false, is_primary_key: false },
  ],
};

const MOCK_GRAPH: SemanticGraphData = {
  table_nodes: [
    { id: "users", display_name: "Users", entity_count: 1 },
    { id: "orders", display_name: "Orders", entity_count: 1 },
  ],
  entity_nodes: [
    {
      id: "users|1",
      table_id: "users",
      display_name: "Alice",
      class_name: "com.example.User",
      dimensions: { name: "Alice", email: "alice@example.com" },
    },
    {
      id: "orders|1",
      table_id: "orders",
      display_name: "Order #1",
      class_name: "com.example.Order",
      dimensions: { user_id: 1, total: "42.50" },
    },
  ],
  table_edges: [
    {
      id: "users--orders",
      source_table: "users",
      target_table: "orders",
      relation_types: ["placed_order"],
      strong_count: 1,
      weak_count: 0,
      entity_edge_count: 1,
      average_confidence: 0.98,
      supporting_entity_edges: ["users|1--orders|1"],
    },
  ],
  entity_edges: [
    {
      id: "users|1--orders|1",
      source: "users|1",
      target: "orders|1",
      relations: [
        {
          source: "users|1",
          target: "orders|1",
          relation_type: "placed_order",
          direction: "source_to_target",
          strength: "strong",
          confidence: 0.98,
          explanation: "订单通过 user_id 指向用户主键。",
          evidence: [
            {
              source_field: "id",
              source_value: 1,
              target_field: "user_id",
              target_value: 1,
              method: "foreign_key",
              reason: "orders.user_id 外键引用 users.id",
            },
          ],
          model_id: "semantic-model-v1",
          task_id: "test-task-1",
        },
      ],
    },
  ],
};

const EMPTY_GRAPH: SemanticGraphData = {
  table_nodes: [],
  entity_nodes: [],
  table_edges: [],
  entity_edges: [],
};

const MOCK_DIAGNOSTICS: AnalysisDiagnostics = {
  entities_read: 2,
  plans_created: 1,
  candidates_retrieved: 1,
  candidates_completed: 1,
  candidates_pending: 0,
  strong_edges_created: 1,
  weak_edges_created: 0,
};

function terminalMessage(
  status: AnalysisStatus,
  graph: SemanticGraphData = MOCK_GRAPH,
  warnings: string[] = [],
  diagnostics: AnalysisDiagnostics = MOCK_DIAGNOSTICS,
) {
  return {
    phase: "complete" as const,
    progress: 1,
    status,
    graph,
    diagnostics,
    warnings,
  };
}

// ── Fake WebSocket ──

class FakeWebSocket {
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;
  closeCalls = 0;
  static instances: FakeWebSocket[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  async sendMessage(data: object) {
    await act(async () => {
      this.onmessage?.({ data: JSON.stringify(data) });
      await Promise.resolve();
    });
  }

  close() {
    this.closeCalls += 1;
    if (this.onclose) this.onclose();
  }

  async serverClose() {
    const callback = this.onclose;
    await act(async () => {
      callback?.();
      await Promise.resolve();
    });
  }
}

function canvasContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: "",
    font: "",
    lineWidth: 1,
    strokeStyle: "",
    textBaseline: "alphabetic" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
}

class FakeLayoutWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();

  postMessage(message: {
    requestId: number;
    graph: SemanticGraphData;
    viewport: { width: number; height: number };
  }) {
    this.onmessage?.({
      data: {
        requestId: message.requestId,
        layout: computeGroupedLayout(message.graph, message.viewport),
      },
    } as MessageEvent);
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();

    // Reset store
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      tables: [],
      tablesLoading: false,
      tablesError: null,
      selectedTables: new Map(),
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      tableErrors: new Map(),
      maxTables: 10,
      currentPhase: "",
      progressMessage: "",
      progressValue: 0,
      graph: null,
      analysisStatus: null,
      warnings: [],
      diagnostics: null,
      taskId: null,
      activeSocket: null,
      analysisGeneration: 0,
      hoveredNodeId: null,
      selectedNodeId: null,
      confidenceThreshold: 0,
      fitViewRequest: 0,
      relayoutRequest: 0,
      focusNodeRequest: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
    });

    FakeWebSocket.instances = [];
    vi.stubGlobal("Worker", FakeLayoutWorker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext(),
    );
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      x: 0,
      y: 0,
      width: 960,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 960,
      toJSON: () => ({}),
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    const fetchMock = setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("users").closest("label")!);

    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });

    const primaryKey = screen.getByRole("checkbox", { name: "字段 id" });
    const classMetadata = screen.getByRole("checkbox", {
      name: "字段 class_name",
    });
    expect(primaryKey).toBeDisabled();
    expect(primaryKey).not.toBeChecked();
    expect(classMetadata).toBeDisabled();
    expect(classMetadata).not.toBeChecked();
    expect(screen.getByText("自动用于实体 ID")).toBeInTheDocument();
    expect(screen.getByText("用于节点展示")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 name" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 email" }));

    fireEvent.click(screen.getByText("orders").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("user_id")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 user_id" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 total" }));

    const startBtn = screen.getByText("开始分析");
    expect(startBtn).not.toBeDisabled();
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const analyzeCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : input.toString();
      return url === "/api/analyze";
    });
    expect(analyzeCall).toBeDefined();
    expect(JSON.parse(String(analyzeCall?.[1]?.body))).toEqual({
      tables: [
        { name: "users", fields: ["name", "email"] },
        { name: "orders", fields: ["user_id", "total"] },
      ],
    });

    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toMatch(/\/api\/ws\/analyze\/test-task-1$/);

    await ws.sendMessage({
      phase: "schema",
      message: "正在读取表结构...",
      progress: 0.1,
    });

    await waitFor(() => {
      expect(screen.getByText("读取表结构")).toBeInTheDocument();
      expect(screen.getByText("10%")).toBeInTheDocument();
    });

    await ws.sendMessage({
      phase: "entities",
      message: "正在读取实体...",
      progress: 0.25,
    });

    await waitFor(() => {
      expect(screen.getByText("读取实体")).toBeInTheDocument();
    });

    await ws.sendMessage({
      phase: "planning",
      message: "正在规划关系...",
      progress: 0.4,
    });

    await ws.sendMessage({
      phase: "candidates",
      message: "正在检索候选关系...",
      progress: 0.6,
    });

    await ws.sendMessage({
      phase: "semantic_judging",
      message: "正在判断语义关系...",
      progress: 0.8,
    });

    await waitFor(() => {
      expect(screen.getByText("语义判断")).toBeInTheDocument();
      expect(screen.getByText("80%")).toBeInTheDocument();
    });

    await ws.sendMessage(terminalMessage("complete"));

    await waitFor(() => {
      expect(screen.getByText("分析完成")).toBeInTheDocument();
    });

    const canvas = await screen.findByRole("img", { name: /语义关系图/ });
    await waitFor(() => {
      expect(canvas).toHaveAttribute("data-scene-ready", "true");
    });

    expect(screen.getByText("2 个实体")).toBeInTheDocument();
    expect(screen.getByText("1 条表关系")).toBeInTheDocument();
    expect(screen.getByText("1 条实体关系")).toBeInTheDocument();
    expect(screen.getByText("弱关系")).toBeInTheDocument();
    expect(screen.getByText("强关系")).toBeInTheDocument();
    expect(screen.getByText("导出 JSON")).toBeInTheDocument();
    expect(screen.getByText("开始新分析")).toBeInTheDocument();

    const layout = computeGroupedLayout(MOCK_GRAPH, {
      width: 960,
      height: 600,
    });
    const tableEdge = layout.tableEdges.find(
      (edge) => edge.id === "users--orders",
    )!;
    const transformBeforeTableFocus = d3.zoomTransform(canvas);
    const tableEdgeFrom = transformBeforeTableFocus.apply([
      tableEdge.from.x,
      tableEdge.from.y,
    ]);
    const tableEdgeTo = transformBeforeTableFocus.apply([
      tableEdge.to.x,
      tableEdge.to.y,
    ]);
    fireEvent.click(canvas, {
      clientX: (tableEdgeFrom[0] + tableEdgeTo[0]) / 2,
      clientY: (tableEdgeFrom[1] + tableEdgeTo[1]) / 2,
    });

    await waitFor(() => {
      expect(screen.getByText("表关系汇总")).toBeInTheDocument();
      expect(useAnalysisStore.getState().selectedTableEdgeId).toBe(
        "users--orders",
      );
    });
    expect(d3.zoomTransform(canvas)).not.toEqual(transformBeforeTableFocus);

    fireEvent.click(
      screen.getByRole("button", { name: "users|1--orders|1" }),
    );
    await waitFor(() => {
      expect(screen.getByText("实体关系详情")).toBeInTheDocument();
      expect(useAnalysisStore.getState().selectedEntityEdgeId).toBe(
        "users|1--orders|1",
      );
      expect(useAnalysisStore.getState().focusNodeRequest?.nodeId).toBe(
        "users|1",
      );
    });
    expect(screen.getByText("placed_order")).toBeInTheDocument();
    expect(screen.getByText("源 → 目标")).toBeInTheDocument();
    expect(screen.getByText("strong")).toBeInTheDocument();
    expect(screen.getByText("98%")).toBeInTheDocument();
    expect(
      screen.getByText("订单通过 user_id 指向用户主键。"),
    ).toBeInTheDocument();
    expect(screen.getByText("id = 1")).toBeInTheDocument();
    expect(screen.getByText("user_id = 1")).toBeInTheDocument();
    expect(screen.getByText(/foreign_key：orders\.user_id/)).toBeInTheDocument();
    expect(screen.getByText("semantic-model-v1")).toBeInTheDocument();
    expect(screen.getByText("test-task-1")).toBeInTheDocument();

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

    const ws = FakeWebSocket.instances[0];
    await ws.sendMessage(
      terminalMessage(
        "failed",
        EMPTY_GRAPH,
        ["分析失败：模型服务不可用，请稍后重试。"],
        {
          ...MOCK_DIAGNOSTICS,
          candidates_completed: 0,
          candidates_pending: 0,
          strong_edges_created: 0,
        },
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByText("分析失败，正在显示可用结果。"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("分析失败：模型服务不可用，请稍后重试。"),
    ).toBeInTheDocument();
    expect(useAnalysisStore.getState().analysisStatus).toBe("failed");
    expect(useAnalysisStore.getState().phase).toBe("error");
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
    await ws.sendMessage(terminalMessage("complete"));

    await waitFor(() => {
      expect(screen.getByText("分析完成")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /新分析/ }));

    await waitFor(() => {
      expect(screen.getByText("选择数据表与字段")).toBeInTheDocument();
    });
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

    const graphWithNoEdges: SemanticGraphData = {
      table_nodes: [
        { id: "users", display_name: "Users", entity_count: 2 },
      ],
      entity_nodes: [
        {
          id: "users|1",
          table_id: "users",
          display_name: "Alice",
          class_name: "com.example.User",
          dimensions: { name: "Alice" },
        },
        {
          id: "users|2",
          table_id: "users",
          display_name: "Bob",
          class_name: "com.example.Admin",
          dimensions: { name: "Bob" },
        },
      ],
      table_edges: [],
      entity_edges: [],
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
    await ws.sendMessage(
      terminalMessage("complete", graphWithNoEdges, [], {
        ...MOCK_DIAGNOSTICS,
        entities_read: 2,
        plans_created: 0,
        candidates_retrieved: 0,
        candidates_completed: 0,
        strong_edges_created: 0,
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("分析完成")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/完整分析未发现关系/)
      ).toBeInTheDocument();
    });

    expect(screen.getByText("2 个实体")).toBeInTheDocument();
    expect(screen.getByText("0 条表关系")).toBeInTheDocument();
    expect(screen.getByText("0 条实体关系")).toBeInTheDocument();
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
    await ws.sendMessage(
      terminalMessage(
        "partial",
        MOCK_GRAPH,
        ["分析超时（180 秒），仍有候选关系待处理。"],
        {
          ...MOCK_DIAGNOSTICS,
          candidates_retrieved: 4,
          candidates_completed: 1,
          candidates_pending: 3,
        },
      ),
    );

    await waitFor(() => {
      expect(
        screen.getByText("分析未完成，正在显示可用关系。"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByText("候选关系：已完成 1 · 待处理 3 · 失败 0"),
    ).toBeInTheDocument();
    expect(screen.getByText(/分析超时（180 秒）/)).toBeInTheDocument();
    expect(useAnalysisStore.getState().analysisStatus).toBe("partial");
    expect(useAnalysisStore.getState().phase).toBe("done");
  });

  it("keeps the 7000-entity workbench DOM structurally bounded", async () => {
    const entityNodes = Array.from({ length: 7_000 }, (_, index) => ({
      id: `bulk|${index}`,
      table_id: "bulk",
      display_name: `Entity ${index}`,
      class_name: null,
      dimensions: { ordinal: index },
    }));
    const graph: SemanticGraphData = {
      table_nodes: [
        {
          id: "bulk",
          display_name: "Bulk",
          entity_count: entityNodes.length,
        },
      ],
      entity_nodes: entityNodes,
      table_edges: [],
      entity_edges: [],
    };

    act(() => {
      useAnalysisStore.setState({
        phase: "done",
        graph,
        analysisStatus: "complete",
        warnings: [],
        diagnostics: {
          ...MOCK_DIAGNOSTICS,
          entities_read: entityNodes.length,
          plans_created: 0,
          candidates_retrieved: 0,
          candidates_completed: 0,
          strong_edges_created: 0,
        },
      });
    });

    const { container } = render(<App />);
    await waitFor(() => {
      expect(
        screen.getByRole("img", { name: /7000 个实体/ }),
      ).toHaveAttribute("data-scene-ready", "true");
    });

    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(0);
  });

  it("reports a pure server close after progress and cleans up the active socket", async () => {
    setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);
    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("users").closest("label")!);
    await waitFor(() => {
      expect(screen.getByText("email")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("开始分析"));

    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
    const socket = FakeWebSocket.instances[0];
    await socket.sendMessage({
      phase: "candidates",
      message: "正在检索候选关系...",
      progress: 0.6,
    });
    await waitFor(() => {
      expect(screen.getByText("检索候选关系")).toBeInTheDocument();
      expect(screen.getByText("60%")).toBeInTheDocument();
    });
    expect(useAnalysisStore.getState().activeSocket).toBe(socket);

    await socket.serverClose();

    await waitFor(() => {
      expect(screen.getByText("分析连接意外断开")).toBeInTheDocument();
    });
    expect(useAnalysisStore.getState()).toMatchObject({
      phase: "error",
      errorMessage: "分析连接意外断开",
      activeSocket: null,
    });
    expect(socket.closeCalls).toBe(1);
    expect(socket.onmessage).toBeNull();
    expect(socket.onerror).toBeNull();
    expect(socket.onclose).toBeNull();
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
  });
});
