/** 前端集成测试 — mock 后端 API 和 WebSocket，验证完整用户流程。 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import * as d3 from "d3";
import App from "../App";
import type {
  AnalysisDiagnostics,
  AnalysisStatus,
  SemanticGraphData,
} from "../api/analysis";
import { computeGroupedLayout, type GraphLayout } from "../graph/layout";
import { quadraticPoint } from "../graph/edgeGeometry";
import { buildScene } from "../graph/scene";
import { useAnalysisStore } from "../store/analysis";

// ── Mock 数据 ──

const MOCK_TABLES = [
  { name: "users" },
  { name: "orders" },
];

const MOCK_COLUMNS = {
  table_name: "users",
  columns: [
    { name: "id", type: "int", is_name: false, is_class_name: false, is_primary_key: true },
    { name: "class_name", type: "varchar", is_name: false, is_class_name: true, is_primary_key: false },
    { name: "name", type: "varchar", is_name: true, is_class_name: false, is_primary_key: false },
    { name: "email", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
  ],
};

const MOCK_COLUMNS_ORDERS = {
  table_name: "orders",
  columns: [
    { name: "id", type: "int", is_name: false, is_class_name: false, is_primary_key: true },
    { name: "name", type: "varchar", is_name: true, is_class_name: false, is_primary_key: false },
    { name: "class_name", type: "varchar", is_name: false, is_class_name: true, is_primary_key: false },
    { name: "user_id", type: "int", is_name: false, is_class_name: false, is_primary_key: false },
    { name: "total", type: "decimal", is_name: false, is_class_name: false, is_primary_key: false },
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

const BUSINESS_SELECTION = [
  {
    name: "requirements",
    fields: ["title", "creator_name", "creator_employee_no"],
  },
  {
    name: "operations",
    fields: ["action", "operator_name", "operator_employee_no"],
  },
  {
    name: "processes",
    fields: ["process_name", "description"],
  },
  {
    name: "parts",
    fields: ["part_name", "part_code", "description"],
  },
];

const BUSINESS_TABLES = BUSINESS_SELECTION.map(({ name }) => ({ name }));
const BUSINESS_COLUMNS = {
  requirements: {
    table_name: "requirements",
    columns: [
      { name: "id", type: "int", is_name: false, is_class_name: false, is_primary_key: true },
      { name: "name", type: "varchar", is_name: true, is_class_name: false, is_primary_key: false },
      { name: "class_name", type: "varchar", is_name: false, is_class_name: true, is_primary_key: false },
      { name: "title", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "creator_name", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "creator_employee_no", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "private_note", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
    ],
  },
  operations: {
    table_name: "operations",
    columns: [
      { name: "id", type: "int", is_name: false, is_class_name: false, is_primary_key: true },
      { name: "name", type: "varchar", is_name: true, is_class_name: false, is_primary_key: false },
      { name: "class_name", type: "varchar", is_name: false, is_class_name: true, is_primary_key: false },
      { name: "action", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "operator_name", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "operator_employee_no", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "private_note", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
    ],
  },
  processes: {
    table_name: "processes",
    columns: [
      { name: "id", type: "int", is_name: false, is_class_name: false, is_primary_key: true },
      { name: "name", type: "varchar", is_name: true, is_class_name: false, is_primary_key: false },
      { name: "class_name", type: "varchar", is_name: false, is_class_name: true, is_primary_key: false },
      { name: "process_name", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "description", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "private_note", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
    ],
  },
  parts: {
    table_name: "parts",
    columns: [
      { name: "id", type: "int", is_name: false, is_class_name: false, is_primary_key: true },
      { name: "name", type: "varchar", is_name: true, is_class_name: false, is_primary_key: false },
      { name: "class_name", type: "varchar", is_name: false, is_class_name: true, is_primary_key: false },
      { name: "part_name", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "part_code", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "description", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
      { name: "private_note", type: "varchar", is_name: false, is_class_name: false, is_primary_key: false },
    ],
  },
};

const PROCESS_DESCRIPTION =
  "依次安装转轴、轴承与转子铁芯，并完成动平衡检查。";
const PROCESS_TABLE_EDGE_ID = "table:5:parts9:processes";
const PROCESS_SUPPORTING_EDGE_IDS = [
  "entity:9:parts:20112:processes:10",
  "entity:9:parts:20212:processes:10",
  "entity:9:parts:20312:processes:10",
];

function personnelEdge(
  operationId: string,
  action: string,
): SemanticGraphData["entity_edges"][number] {
  return {
    id: `entity:14:operations:${operationId}14:requirements:1`,
    source: `operations:${operationId}`,
    target: "requirements:1",
    relations: [
      {
        source: "requirements:1",
        target: `operations:${operationId}`,
        relation_type: "人员行为",
        direction: "source_to_target",
        strength: "weak",
        confidence: 0.97,
        explanation:
          `需求创建人张三（工号 EMP-001）与“${action}”的操作人姓名、工号均一致，` +
          "确认属于同一人员的业务行为。",
        evidence: [
          {
            source_field: "creator_name",
            source_value: "张三",
            target_field: "operator_name",
            target_value: "张三",
            method: "llm_semantic_reasoning",
            reason: "创建人与操作人的姓名一致。",
          },
          {
            source_field: "creator_employee_no",
            source_value: "EMP-001",
            target_field: "operator_employee_no",
            target_value: "EMP-001",
            method: "llm_semantic_reasoning",
            reason: "姓名相同且员工工号一致，可排除同名人员。",
          },
        ],
        model_id: "fixture-semantic-model-v1",
        task_id: "integration-task-1",
      },
    ],
  };
}

function processPartEdge(
  partId: string,
  partName: string,
  partCode: string,
): SemanticGraphData["entity_edges"][number] {
  return {
    id: `entity:9:parts:${partId}12:processes:10`,
    source: `parts:${partId}`,
    target: "processes:10",
    relations: [
      {
        source: "processes:10",
        target: `parts:${partId}`,
        relation_type: "工艺涉及零件",
        direction: "source_to_target",
        strength: "weak",
        confidence: 0.94,
        explanation:
          `转子装配工艺说明明确包含${partName}，` +
          "该记录是实际装配零件而不是名称相似的工艺文件。",
        evidence: [
          {
            source_field: "description",
            source_value: PROCESS_DESCRIPTION,
            target_field: "part_name",
            target_value: partName,
            method: "llm_semantic_reasoning",
            reason: "工艺描述明确列出该零件名称。",
          },
          {
            source_field: "process_name",
            source_value: "转子装配工艺",
            target_field: "part_code",
            target_value: partCode,
            method: "llm_semantic_reasoning",
            reason: "零件编码属于转子装配零件系列。",
          },
        ],
        model_id: "fixture-semantic-model-v1",
        task_id: "integration-task-1",
      },
    ],
  };
}

const BUSINESS_GRAPH: SemanticGraphData = {
  table_nodes: [
    { id: "operations", display_name: "operations", entity_count: 4 },
    { id: "parts", display_name: "parts", entity_count: 4 },
    { id: "processes", display_name: "processes", entity_count: 1 },
    { id: "requirements", display_name: "requirements", entity_count: 1 },
  ],
  entity_nodes: [
    {
      id: "operations:101",
      table_id: "operations",
      display_name: "创建转子装配工单",
      class_name: null,
      dimensions: {
        action: "创建转子装配工单",
        operator_name: "张三",
        operator_employee_no: "EMP-001",
      },
    },
    {
      id: "operations:102",
      table_id: "operations",
      display_name: "复核转子装配工艺",
      class_name: null,
      dimensions: {
        action: "复核转子装配工艺",
        operator_name: "张三",
        operator_employee_no: "EMP-001",
      },
    },
    {
      id: "operations:103",
      table_id: "operations",
      display_name: "批准转子装配放行",
      class_name: null,
      dimensions: {
        action: "批准转子装配放行",
        operator_name: "张三",
        operator_employee_no: "EMP-001",
      },
    },
    {
      id: "operations:104",
      table_id: "operations",
      display_name: "查看转子装配工单",
      class_name: null,
      dimensions: {
        action: "查看转子装配工单",
        operator_name: "张三",
        operator_employee_no: "EMP-999",
      },
    },
    {
      id: "parts:201",
      table_id: "parts",
      display_name: "转轴",
      class_name: null,
      dimensions: {
        part_name: "转轴",
        part_code: "RTR-SHAFT-01",
        description: "转子装配使用的传动转轴。",
      },
    },
    {
      id: "parts:202",
      table_id: "parts",
      display_name: "轴承",
      class_name: null,
      dimensions: {
        part_name: "轴承",
        part_code: "RTR-BEARING-02",
        description: "转子装配使用的支撑轴承。",
      },
    },
    {
      id: "parts:203",
      table_id: "parts",
      display_name: "转子铁芯",
      class_name: null,
      dimensions: {
        part_name: "转子铁芯",
        part_code: "RTR-CORE-03",
        description: "转子装配使用的叠片铁芯。",
      },
    },
    {
      id: "parts:204",
      table_id: "parts",
      display_name: "转子装配工艺卡片",
      class_name: null,
      dimensions: {
        part_name: "转子装配工艺卡片",
        part_code: "DOC-ROTOR-99",
        description: "记录转子装配工艺的纸质文件，不是装配零件。",
      },
    },
    {
      id: "processes:10",
      table_id: "processes",
      display_name: "转子装配工艺",
      class_name: null,
      dimensions: {
        process_name: "转子装配工艺",
        description: PROCESS_DESCRIPTION,
      },
    },
    {
      id: "requirements:1",
      table_id: "requirements",
      display_name: "转子装配质量需求",
      class_name: null,
      dimensions: {
        title: "转子装配质量需求",
        creator_name: "张三",
        creator_employee_no: "EMP-001",
      },
    },
  ],
  table_edges: [
    {
      id: "table:10:operations12:requirements",
      source_table: "operations",
      target_table: "requirements",
      relation_types: ["人员行为"],
      strong_count: 0,
      weak_count: 3,
      entity_edge_count: 3,
      average_confidence: 0.97,
      supporting_entity_edges: [
        "entity:14:operations:10114:requirements:1",
        "entity:14:operations:10214:requirements:1",
        "entity:14:operations:10314:requirements:1",
      ],
    },
    {
      id: PROCESS_TABLE_EDGE_ID,
      source_table: "parts",
      target_table: "processes",
      relation_types: ["工艺涉及零件"],
      strong_count: 0,
      weak_count: 3,
      entity_edge_count: 3,
      average_confidence: 0.94,
      supporting_entity_edges: PROCESS_SUPPORTING_EDGE_IDS,
    },
  ],
  entity_edges: [
    personnelEdge("101", "创建转子装配工单"),
    personnelEdge("102", "复核转子装配工艺"),
    personnelEdge("103", "批准转子装配放行"),
    processPartEdge("201", "转轴", "RTR-SHAFT-01"),
    processPartEdge("202", "轴承", "RTR-BEARING-02"),
    processPartEdge("203", "转子铁芯", "RTR-CORE-03"),
  ],
};

const BUSINESS_DIAGNOSTICS: AnalysisDiagnostics = {
  entities_read: 10,
  plans_created: 2,
  candidates_retrieved: 8,
  candidates_completed: 8,
  candidates_pending: 0,
  strong_edges_created: 0,
  weak_edges_created: 6,
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
  static latestLayout: GraphLayout | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();

  postMessage(message: {
    requestId: number;
    graph: SemanticGraphData;
    viewport: { width: number; height: number };
  }) {
    const layout = computeGroupedLayout(message.graph, message.viewport);
    FakeLayoutWorker.latestLayout = layout;
    this.onmessage?.({
      data: {
        requestId: message.requestId,
        layout,
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

      if (url === "/api/table-summaries") {
        return {
          ok: true,
          json: () =>
            Promise.resolve([
              {
                table_name: "users",
                semantic_name: "用户数据",
                row_count: 1,
                name_samples: ["Alice"],
                status: "inferred",
              },
              {
                table_name: "orders",
                semantic_name: "订单数据",
                row_count: 1,
                name_samples: ["Order #1"],
                status: "inferred",
              },
            ]),
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

function setupBusinessFetchMock() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/tables") {
      return {
        ok: true,
        json: () => Promise.resolve(BUSINESS_TABLES),
      } as Response;
    }

    if (url === "/api/table-summaries") {
      return {
        ok: true,
        json: () =>
          Promise.resolve(
            BUSINESS_TABLES.map(({ name }) => ({
              table_name: name,
              semantic_name: `${name} 业务数据`,
              row_count: 1,
              name_samples: [],
              status: "inferred",
            }))),
      } as Response;
    }

    const fieldsMatch = url.match(/^\/api\/tables\/([^/]+)\/fields$/);
    if (fieldsMatch) {
      const tableName = fieldsMatch[1] as keyof typeof BUSINESS_COLUMNS;
      const fields = BUSINESS_COLUMNS[tableName];
      return {
        ok: Boolean(fields),
        json: () => Promise.resolve(fields ?? {}),
      } as Response;
    }

    if (url === "/api/analyze") {
      return {
        ok: true,
        json: () => Promise.resolve({ task_id: "test-task-1" }),
      } as Response;
    }

    return { ok: false, json: () => Promise.resolve({}) } as Response;
  });
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
      tableSummaries: new Map(),
      tableSummariesWarning: null,
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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );

    // FieldSelector should appear with the table's fields
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });
  });

  it("shows '生成业务关系图' button disabled when no tables selected", async () => {
    setupFetchMock();

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    const btn = screen.getByText("生成业务关系图");
    expect(btn).toBeDisabled();
  });

  it("completes full analysis flow with progress", async () => {
    const fetchMock = setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("checkbox", { name: "字段 id" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "字段 name" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "字段 class_name" }),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "users 主要判断信息" }),
      ).getByText("系统将使用名称和对象类型判断关系。"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 email" }));

    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 orders" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 user_id" }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 user_id" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "字段 total" }));

    const startBtn = screen.getByText("生成业务关系图");
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
        { name: "users", fields: ["email"] },
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

    const layout = FakeLayoutWorker.latestLayout!;
    const tableEdge = layout.tableEdges.find(
      (edge) => edge.id === "users--orders",
    )!;
    const transformBeforeTableFocus = d3.zoomTransform(canvas);
    const scene = buildScene({
      graph: useAnalysisStore.getState().graph!,
      layout,
      transform: transformBeforeTableFocus,
      confidenceThreshold: useAnalysisStore.getState().confidenceThreshold,
    });
    const tableEdgePoint = quadraticPoint(
      scene.tableEdges.find((edge) => edge.id === tableEdge.id)!.geometry,
      0.5,
    );
    fireEvent.click(canvas, {
      clientX: tableEdgePoint.x,
      clientY: tableEdgePoint.y,
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

  it("renders representative semantic results and exposes process evidence", async () => {
    const fetchMock = setupBusinessFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("requirements")).toBeInTheDocument();
    });

    for (const selection of BUSINESS_SELECTION) {
      const tableCheckbox = screen.getByRole("checkbox", {
          name: `选择业务数据 ${selection.name}`,
      });
      const tableCard = tableCheckbox.closest("article")!;
      fireEvent.click(tableCheckbox);
      await waitFor(() => {
        expect(
          within(tableCard).getByRole("checkbox", {
            name: `字段 ${selection.fields[0]}`,
          }),
        ).toBeInTheDocument();
      });
      for (const field of selection.fields) {
        fireEvent.click(
          within(tableCard).getByRole("checkbox", {
            name: `字段 ${field}`,
          }),
        );
      }
    }

    fireEvent.click(
      screen.getByRole("button", { name: "生成业务关系图" }),
    );
    await waitFor(() => {
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const analyzeCall = fetchMock.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : input.toString();
      return url === "/api/analyze";
    });
    expect(JSON.parse(String(analyzeCall?.[1]?.body))).toEqual({
      tables: BUSINESS_SELECTION,
    });

    await FakeWebSocket.instances[0].sendMessage(
      terminalMessage(
        "complete",
        BUSINESS_GRAPH,
        [],
        BUSINESS_DIAGNOSTICS,
      ),
    );

    const canvas = await screen.findByRole("img", {
      name: /10 个实体，8 条关系/,
    });
    await waitFor(() => {
      expect(canvas).toHaveAttribute("data-scene-ready", "true");
    });
    expect(screen.getByText("2 条表关系")).toBeInTheDocument();
    expect(screen.getByText("6 条实体关系")).toBeInTheDocument();

    act(() => {
      useAnalysisStore.getState().selectTableEdge(PROCESS_TABLE_EDGE_ID);
    });

    await waitFor(() => {
      expect(screen.getByText("表关系汇总")).toBeInTheDocument();
      expect(screen.getByText("工艺涉及零件")).toBeInTheDocument();
      expect(useAnalysisStore.getState().selectedTableEdgeId).toBe(
        PROCESS_TABLE_EDGE_ID,
      );
    });
    for (const edgeId of PROCESS_SUPPORTING_EDGE_IDS) {
      expect(
        screen.getByRole("button", { name: edgeId }),
      ).toBeInTheDocument();
    }

    fireEvent.click(
      screen.getByRole("button", {
        name: PROCESS_SUPPORTING_EDGE_IDS[0],
      }),
    );
    await waitFor(() => {
      expect(screen.getByText("实体关系详情")).toBeInTheDocument();
    });
    expect(screen.getByText("weak")).toBeInTheDocument();
    expect(screen.getByText("94%")).toBeInTheDocument();
    expect(
      screen.getByText(
        "转子装配工艺说明明确包含转轴，该记录是实际装配零件而不是名称相似的工艺文件。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "description = 依次安装转轴、轴承与转子铁芯，并完成动平衡检查。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("part_name = 转轴")).toBeInTheDocument();
    expect(screen.getByText("fixture-semantic-model-v1")).toBeInTheDocument();
    expect(screen.getByText("integration-task-1")).toBeInTheDocument();
  });

  it("handles analysis error from WebSocket", async () => {
    setupFetchMock();
    vi.stubGlobal("WebSocket", FakeWebSocket);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("users")).toBeInTheDocument();
    });

    // Select table and start analysis
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("生成业务关系图"));

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
      screen.getByRole("checkbox", { name: "选择业务数据 overflow" })
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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("生成业务关系图"));

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
      expect(screen.getByText("选择要分析的业务数据")).toBeInTheDocument();
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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("生成业务关系图"));

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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("生成业务关系图"));

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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("生成业务关系图"));

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
    fireEvent.click(
      screen.getByRole("checkbox", { name: "选择业务数据 users" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: "字段 email" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("生成业务关系图"));

    // Should show connection error
    await waitFor(() => {
      expect(screen.getByText("分析失败")).toBeInTheDocument();
    });

    expect(
      screen.getAllByText(/WebSocket 连接失败/).length
    ).toBeGreaterThanOrEqual(1);
  });
});
