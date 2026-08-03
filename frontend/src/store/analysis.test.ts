import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAnalysisSocket } from "../api/analysis";
import {
  isAuxiliaryColumn,
  isRequiredBusinessColumn,
  useAnalysisStore,
} from "./analysis";

const columns = [
  {
    name: "id",
    type: "int",
    is_name: false,
    is_class_name: false,
    is_primary_key: true,
    is_foreign_key: false,
  },
  {
    name: "name",
    type: "varchar",
    is_name: true,
    is_class_name: false,
    is_primary_key: false,
    is_foreign_key: false,
  },
  {
    name: "class_name",
    type: "varchar",
    is_name: false,
    is_class_name: true,
    is_primary_key: false,
    is_foreign_key: false,
  },
  {
    name: "email",
    type: "varchar",
    is_name: false,
    is_class_name: false,
    is_primary_key: false,
    is_foreign_key: false,
  },
];

const completedGraph = {
  nodes: [
    {
      id: "users:1",
      source_table: "users",
      class_name: "User",
      field_values: { id: 1 },
      degree: 0,
    },
  ],
  edges: [],
};

const semanticGraph = {
  table_nodes: [
    { id: "users", display_name: "Users", entity_count: 1 },
  ],
  entity_nodes: [
    {
      id: "users:1",
      table_id: "users",
      display_name: "Ada",
      class_name: "example.User",
      dimensions: { email: "ada@example.test" },
    },
  ],
  table_edges: [],
  entity_edges: [],
};

const diagnostics = {
  entities_read: 1,
  plans_created: 0,
  candidates_retrieved: 0,
  candidates_completed: 0,
  candidates_pending: 1,
  strong_edges_created: 0,
  weak_edges_created: 0,
};

class ControllableWebSocket {
  static instances: ControllableWebSocket[] = [];

  readonly url: string;
  readyState = 1;
  closeCalls = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    ControllableWebSocket.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = 3;
    this.onclose?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analysis selection store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      tables: [],
      tablesLoading: false,
      tablesError: null,
      selectedTables: new Map(),
      pendingTables: new Set(),
      tableSummaries: new Map(),
      tableSummariesWarning: null,
      maxTables: 10,
    });
  });

  it("exposes tables before non-blocking business summaries resolve", async () => {
    let resolveSummaries!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/tables")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: "assembly_process" }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/table-summaries")) {
        return new Promise<Response>((resolve) => {
          resolveSummaries = resolve;
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await useAnalysisStore.getState().loadTables();

    expect(useAnalysisStore.getState().tables).toEqual([
      { name: "assembly_process" },
    ]);
    expect(useAnalysisStore.getState().tablesLoading).toBe(false);
    expect(useAnalysisStore.getState().tableSummaries).toEqual(new Map());

    resolveSummaries(
      new Response(
        JSON.stringify([
          {
            table_name: "assembly_process",
            semantic_name: "装配工艺数据",
            row_count: 128,
            name_samples: ["通信卫星总装", "高增益天线装配"],
            status: "inferred",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    await vi.waitFor(() => {
      expect(useAnalysisStore.getState().tableSummaries.get("assembly_process"))
        .toEqual({
          table_name: "assembly_process",
          semantic_name: "装配工艺数据",
          row_count: 128,
          name_samples: ["通信卫星总装", "高增益天线装配"],
          status: "inferred",
        });
    });
  });

  it("keeps table selection available when business summaries fail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith("/tables")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: "legacy_table" }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/table-summaries")) {
        return Promise.resolve(
          new Response("unavailable", {
            status: 503,
            headers: { "content-type": "text/plain" },
          }),
        );
      }
      throw new Error(`unexpected request: ${url}`);
    });

    await useAnalysisStore.getState().loadTables();

    await vi.waitFor(() => {
      expect(useAnalysisStore.getState().tableSummariesWarning).toContain(
        "HTTP 503",
      );
    });
    expect(useAnalysisStore.getState().tables).toEqual([
      { name: "legacy_table" },
    ]);
    expect(useAnalysisStore.getState().tablesError).toBeNull();
  });

  it("keeps the newest business summaries when requests finish out of order", async () => {
    const resolvers: Array<(value: Response) => void> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const olderRequest = useAnalysisStore.getState().loadTableSummaries();
    const newerRequest = useAnalysisStore.getState().loadTableSummaries();

    resolvers[1](
      new Response(
        JSON.stringify([
          {
            table_name: "assembly_process",
            semantic_name: "最新业务名称",
            row_count: 128,
            name_samples: [],
            status: "inferred",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await newerRequest;

    resolvers[0](
      new Response(
        JSON.stringify([
          {
            table_name: "assembly_process",
            semantic_name: "过期业务名称",
            row_count: 128,
            name_samples: [],
            status: "inferred",
          },
        ]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    await olderRequest;

    expect(
      useAnalysisStore.getState().tableSummaries.get("assembly_process")
        ?.semantic_name,
    ).toBe("最新业务名称");
  });

  it("keeps required business fields and primary keys out of auxiliary selection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response);

    await useAnalysisStore.getState().toggleTable("users");

    expect(isRequiredBusinessColumn(columns[1])).toBe(true);
    expect(isRequiredBusinessColumn(columns[2])).toBe(true);
    expect(isAuxiliaryColumn(columns[0])).toBe(false);
    expect(isAuxiliaryColumn(columns[3])).toBe(true);
    expect(isAuxiliaryColumn({
      ...columns[3],
      name: "owner_id",
      is_foreign_key: true,
    })).toBe(false);
    expect(useAnalysisStore.getState().selectedTables.get("users")?.selectedFields).toEqual(
      new Set()
    );

    useAnalysisStore.getState().toggleField("users", "email");
    expect(useAnalysisStore.getState().selectedTables.get("users")?.selectedFields).toEqual(
      new Set(["email"])
    );

    useAnalysisStore.getState().toggleField("users", "id");
    useAnalysisStore.getState().toggleField("users", "name");
    useAnalysisStore.getState().toggleField("users", "class_name");
    useAnalysisStore.getState().toggleField("users", "stale_field");
    expect(useAnalysisStore.getState().selectedTables.get("users")?.selectedFields).toEqual(
      new Set(["email"])
    );

    useAnalysisStore.getState().selectAllFields("users");
    expect(
      useAnalysisStore.getState().selectedTables.get("users")?.selectedFields,
    ).toEqual(new Set(["email"]));
    useAnalysisStore.getState().deselectAllFields("users");
    expect(useAnalysisStore.getState().selectedTables.get("users")?.selectedFields).toEqual(
      new Set()
    );
  });

  it("keeps both table selections when their fields finish loading out of order", async () => {
    // This fails if a late field response commits from the selection snapshot taken before loading.
    let resolveUsers!: (value: Response) => void;
    let resolveOrders!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      return new Promise<Response>((resolve) => {
        if (url.includes("users")) resolveUsers = resolve;
        else resolveOrders = resolve;
      });
    });

    const users = useAnalysisStore.getState().toggleTable("users");
    const orders = useAnalysisStore.getState().toggleTable("orders");
    resolveOrders({
      ok: true,
      json: () => Promise.resolve({ table_name: "orders", columns }),
    } as Response);
    await orders;
    resolveUsers({
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response);
    await users;

    expect([...useAnalysisStore.getState().selectedTables.keys()]).toEqual([
      "orders",
      "users",
    ]);
  });

  it("blocks analysis while another selected table is loading and accepts its late selection", async () => {
    // This fails if a pending selected-table request is not authoritative for launch gating.
    let resolveOrders!: (value: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/orders/fields")) {
        return new Promise<Response>((resolve) => {
          resolveOrders = resolve;
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns,
            selectedFields: new Set(["id", "class_name"]),
          },
        ],
      ]),
    });

    const loadingOrders = useAnalysisStore.getState().toggleTable("orders");

    expect(useAnalysisStore.getState().pendingTables).toEqual(
      new Set(["orders"])
    );

    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState().phase).toBe("select");
    expect(useAnalysisStore.getState().errorMessage).toContain(
      "正在加载所选表字段"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveOrders({
      ok: true,
      json: () => Promise.resolve({ table_name: "orders", columns }),
    } as Response);
    await loadingOrders;

    expect([...useAnalysisStore.getState().selectedTables.keys()]).toEqual([
      "users",
      "orders",
    ]);
    expect(useAnalysisStore.getState().pendingTables).toEqual(new Set());
    expect(useAnalysisStore.getState().phase).toBe("select");
  });

  it("ignores a table-field response that arrives after analysis reset", async () => {
    // This fails if reset clears the UI but not ownership of an in-flight table request.
    let resolveFields!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFields = resolve;
        })
    );

    const loading = useAnalysisStore.getState().toggleTable("users");
    useAnalysisStore.getState().resetAnalysis();
    resolveFields({
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response);
    await loading;

    expect(useAnalysisStore.getState().selectedTables.has("users")).toBe(false);
    expect(useAnalysisStore.getState().pendingTables).toEqual(new Set());
    expect(useAnalysisStore.getState().phase).toBe("select");
  });

  it("clears a pending request when a concurrent load takes its final table slot", async () => {
    // This fails if the losing request returns at the limit without releasing pending ownership.
    let resolveUsers!: (value: Response) => void;
    let resolveOrders!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      return new Promise<Response>((resolve) => {
        if (url.includes("users")) resolveUsers = resolve;
        else resolveOrders = resolve;
      });
    });
    useAnalysisStore.setState({ maxTables: 1 });

    const users = useAnalysisStore.getState().toggleTable("users");
    const orders = useAnalysisStore.getState().toggleTable("orders");
    resolveUsers({
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response);
    await users;
    resolveOrders({
      ok: true,
      json: () => Promise.resolve({ table_name: "orders", columns }),
    } as Response);
    await orders;

    expect([...useAnalysisStore.getState().selectedTables.keys()]).toEqual([
      "users",
    ]);
    expect(useAnalysisStore.getState().pendingTables).toEqual(new Set());
    expect(useAnalysisStore.getState().tableRequestTokens).toEqual(new Map());
  });

  it("submits only selected auxiliary fields", async () => {
    // This fails if required business roles or primary keys leak into the request.
    class SilentWebSocket {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: (() => void) | null = null;
    }
    vi.stubGlobal("WebSocket", SilentWebSocket);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-1" }),
    } as Response);
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "audit_log",
          {
            name: "audit_log",
            columns,
            selectedFields: new Set(["id", "name", "class_name", "email"]),
          },
        ],
      ]),
    });

    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState().phase).toBe("analyzing");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      tables: [{ name: "audit_log", fields: ["email"] }],
    });
    vi.unstubAllGlobals();
  });

  it("allows analysis with no selected dimensions", async () => {
    class SilentWebSocket {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: (() => void) | null = null;
    }
    vi.stubGlobal("WebSocket", SilentWebSocket);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-empty-fields" }),
    } as Response);
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "audit_log",
          {
            name: "audit_log",
            columns: [columns[0], columns[1], columns[2]],
            selectedFields: new Set(),
          },
        ],
      ]),
    });

    await useAnalysisStore.getState().startAnalysis();

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      tables: [{ name: "audit_log", fields: [] }],
    });
  });

  it("rejects a selected table without a business name before submission", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "audit_log",
          {
            name: "audit_log",
            columns: [columns[0], columns[2], columns[3]],
            selectedFields: new Set(["email"]),
          },
        ],
      ]),
    });

    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState().errorMessage).toBe("缺少业务名称字段。");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a selected table without object type information before submission", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "audit_log",
          {
            name: "audit_log",
            columns: [columns[0], columns[1], columns[3]],
            selectedFields: new Set(["email"]),
          },
        ],
      ]),
    });

    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState().errorMessage).toBe(
      "缺少对象类型信息，无法进行主要关系判断。",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("analysis graph display controls", () => {
  beforeEach(() => {
    useAnalysisStore.setState({ showIsolatedNodes: false });
  });

  it("toggles isolated entities and resets the control for a new analysis", () => {
    useAnalysisStore.getState().setShowIsolatedNodes(true);
    expect(useAnalysisStore.getState().showIsolatedNodes).toBe(true);

    useAnalysisStore.getState().resetAnalysis();
    expect(useAnalysisStore.getState().showIsolatedNodes).toBe(false);
  });

  it("hides isolated entities when a new analysis starts", async () => {
    vi.stubGlobal("WebSocket", ControllableWebSocket);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-new-analysis" }),
    } as Response);
    useAnalysisStore.setState({
      phase: "select",
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns,
            selectedFields: new Set(["email"]),
          },
        ],
      ]),
      pendingTables: new Set(),
      activeSocket: null,
      showIsolatedNodes: true,
    });

    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState().phase).toBe("analyzing");
    expect(useAnalysisStore.getState().showIsolatedNodes).toBe(false);
  });
});

describe("analysis graph workbench commands", () => {
  it("increments the fit-view request marker for every request", () => {
    // This fails if a fit command is dropped because the marker does not change.
    const before = useAnalysisStore.getState().fitViewRequest;

    useAnalysisStore.getState().requestFitView();

    expect(useAnalysisStore.getState().fitViewRequest).toBe(before + 1);
  });

  it("returns graph commands to their stable initial markers when analysis resets", () => {
    // This fails if a prior workbench command leaks into a subsequent analysis.
    useAnalysisStore.getState().requestFitView();
    useAnalysisStore.getState().requestRelayout();

    useAnalysisStore.getState().resetAnalysis();

    expect(useAnalysisStore.getState().fitViewRequest).toBe(0);
    expect(useAnalysisStore.getState().relayoutRequest).toBe(0);
  });
});

describe("analysis socket ownership", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ControllableWebSocket.instances = [];
    vi.stubGlobal("WebSocket", ControllableWebSocket);
    useAnalysisStore.setState({
      phase: "select",
      errorMessage: null,
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns,
            selectedFields: new Set(["id", "class_name"]),
          },
        ],
      ]),
      pendingTables: new Set(),
      tableRequestTokens: new Map(),
      currentPhase: "",
      progressMessage: "",
      progressValue: 0,
      graph: null,
      taskId: null,
      activeSocket: null,
      analysisGeneration: 0,
    });
  });

  it("keeps a partial terminal graph and its diagnostics available to the workbench", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-partial" }),
    } as Response);

    await useAnalysisStore.getState().startAnalysis();
    const socket = ControllableWebSocket.instances[0];
    socket.onmessage?.({
      data: JSON.stringify({
        phase: "complete",
        progress: 1,
        status: "partial",
        graph: semanticGraph,
        diagnostics,
        warnings: ["Some candidates could not be judged"],
      }),
    } as MessageEvent);

    expect(useAnalysisStore.getState()).toMatchObject({
      phase: "done",
      analysisStatus: "partial",
      graph: semanticGraph,
      diagnostics,
      warnings: ["Some candidates could not be judged"],
      activeSocket: null,
    });

    useAnalysisStore.getState().selectEntityEdge("entity-edge-1");
    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState()).toMatchObject({
      phase: "analyzing",
      graph: null,
      analysisStatus: null,
      warnings: [],
      diagnostics: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
    });
  });

  it("turns a failed terminal result into an error phase", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-failed" }),
    } as Response);

    await useAnalysisStore.getState().startAnalysis();
    const socket = ControllableWebSocket.instances[0];
    socket.onmessage?.({
      data: JSON.stringify({
        phase: "complete",
        progress: 1,
        status: "failed",
        graph: {
          table_nodes: [],
          entity_nodes: [],
          table_edges: [],
          entity_edges: [],
        },
        diagnostics: { ...diagnostics, entities_read: 0 },
        warnings: ["Planner unavailable"],
      }),
    } as MessageEvent);

    expect(useAnalysisStore.getState()).toMatchObject({
      phase: "error",
      analysisStatus: "failed",
      graph: {
        table_nodes: [],
        entity_nodes: [],
        table_edges: [],
        entity_edges: [],
      },
      warnings: ["Planner unavailable"],
      errorMessage: "Planner unavailable",
      activeSocket: null,
    });
  });

  it("clears a previous result and every graph interaction before a new submission resolves", async () => {
    let resolveSubmission!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => {
        resolveSubmission = resolve;
      }),
    );
    useAnalysisStore.setState({
      phase: "done",
      errorMessage: "old error",
      currentPhase: "complete",
      progressMessage: "old progress",
      progressValue: 1,
      graph: semanticGraph,
      analysisStatus: "partial",
      warnings: ["old warning"],
      diagnostics,
      taskId: "task-old",
      hoveredNodeId: "users:1",
      selectedNodeId: "users:1",
      focusNodeRequest: { nodeId: "users:1", version: 1 },
      selectedEntityEdgeId: "entity-edge-1",
      selectedTableEdgeId: "table-edge-1",
      activeSocket: null,
    });

    const starting = useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState()).toMatchObject({
      phase: "analyzing",
      errorMessage: null,
      currentPhase: "",
      progressMessage: "正在提交分析任务...",
      progressValue: 0,
      graph: null,
      analysisStatus: null,
      warnings: [],
      diagnostics: null,
      taskId: null,
      hoveredNodeId: null,
      selectedNodeId: null,
      focusNodeRequest: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
    });

    resolveSubmission({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-new" }),
    } as Response);
    await starting;
  });

  it("reports malformed socket JSON through the supplied error callback", () => {
    const onMessage = vi.fn();
    const onError = vi.fn();
    const onClose = vi.fn();
    const socket = createAnalysisSocket("task-malformed", onMessage, onError, onClose) as unknown as ControllableWebSocket;

    socket.onmessage?.({ data: "not-json" } as MessageEvent);

    expect(onMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("keeps entity-edge and table-edge selections mutually exclusive and clears them on reset", () => {
    useAnalysisStore.getState().selectEntityEdge("entity-edge-1");
    expect(useAnalysisStore.getState()).toMatchObject({
      selectedEntityEdgeId: "entity-edge-1",
      selectedTableEdgeId: null,
    });

    useAnalysisStore.getState().selectTableEdge("table-edge-1");
    expect(useAnalysisStore.getState()).toMatchObject({
      selectedEntityEdgeId: null,
      selectedTableEdgeId: "table-edge-1",
    });

    useAnalysisStore.getState().resetAnalysis();
    expect(useAnalysisStore.getState()).toMatchObject({
      analysisStatus: null,
      warnings: [],
      diagnostics: null,
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
    });
  });

  it("closes the active socket on reset and ignores its retained late message", async () => {
    // This fails if reset only changes React state while the prior run still owns callbacks.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-a" }),
    } as Response);

    await useAnalysisStore.getState().startAnalysis();
    const socket = ControllableWebSocket.instances[0];
    const lateMessage = socket.onmessage!;

    useAnalysisStore.getState().resetAnalysis();
    lateMessage({
      data: JSON.stringify({
        phase: 5,
        message: "旧分析完成",
        progress: 1,
        graph: completedGraph,
      }),
    } as MessageEvent);

    expect(socket.closeCalls).toBe(1);
    expect(useAnalysisStore.getState().activeSocket).toBeNull();
    expect(useAnalysisStore.getState().phase).toBe("select");
    expect(useAnalysisStore.getState().graph).toBeNull();
  });

  it("lets run B own state after closing run A and rejects every late A callback", async () => {
    // This fails if callback ownership is inferred only from the current phase.
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ task_id: "task-a" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ task_id: "task-b" }),
      } as Response);

    await useAnalysisStore.getState().startAnalysis();
    const socketA = ControllableWebSocket.instances[0];
    const lateMessage = socketA.onmessage!;
    const lateError = socketA.onerror!;
    const lateClose = socketA.onclose!;

    await useAnalysisStore.getState().startAnalysis();
    const socketB = ControllableWebSocket.instances[1];

    lateMessage({
      data: JSON.stringify({
        phase: 5,
        message: "A 完成",
        progress: 1,
        graph: completedGraph,
      }),
    } as MessageEvent);
    lateError(new Event("error"));
    lateClose();

    expect(socketA.closeCalls).toBe(1);
    expect(useAnalysisStore.getState().activeSocket).toBe(socketB);
    expect(useAnalysisStore.getState().taskId).toBe("task-b");
    expect(useAnalysisStore.getState().phase).toBe("analyzing");
    expect(useAnalysisStore.getState().graph).toBeNull();
    expect(useAnalysisStore.getState().errorMessage).toBeNull();

    socketB.onmessage?.({
      data: JSON.stringify({
        phase: "retrieval",
        message: "B 处理中",
        progress: 0.4,
      }),
    } as MessageEvent);
    expect(useAnalysisStore.getState().currentPhase).toBe("retrieval");
    expect(useAnalysisStore.getState().progressMessage).toBe("B 处理中");
  });
});
