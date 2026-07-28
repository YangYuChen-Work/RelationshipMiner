import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAnalysisStore } from "./analysis";

const columns = [
  { name: "id", type: "int", is_class_name: false, is_primary_key: true },
  {
    name: "class_name",
    type: "varchar",
    is_class_name: true,
    is_primary_key: false,
  },
  { name: "email", type: "varchar", is_class_name: false, is_primary_key: false },
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
      selectedTables: new Map(),
      pendingTables: new Set(),
      maxTables: 10,
    });
  });

  it("initially selects primary-key and class-name fields and never removes them", async () => {
    // This fails if loading a table omits a required field, or either protection is removed.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ table_name: "users", columns }),
    } as Response);

    await useAnalysisStore.getState().toggleTable("users");
    useAnalysisStore.getState().toggleField("users", "id");
    useAnalysisStore.getState().toggleField("users", "class_name");
    useAnalysisStore.getState().deselectAllFields("users");

    expect(useAnalysisStore.getState().selectedTables.get("users")?.selectedFields).toEqual(
      new Set(["id", "class_name"])
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

  it("starts analysis for a table without a class-name field", async () => {
    // This fails if the retired per-table class_name validation is restored.
    class SilentWebSocket {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: (() => void) | null = null;
    }
    vi.stubGlobal("WebSocket", SilentWebSocket);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ task_id: "task-1" }),
    } as Response);
    useAnalysisStore.setState({
      selectedTables: new Map([
        [
          "audit_log",
          {
            name: "audit_log",
            columns: [columns[0]],
            selectedFields: new Set(["id"]),
          },
        ],
      ]),
    });

    await useAnalysisStore.getState().startAnalysis();

    expect(useAnalysisStore.getState().phase).toBe("analyzing");
    vi.unstubAllGlobals();
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
      currentPhase: 0,
      progressMessage: "",
      progressValue: 0,
      graph: null,
      taskId: null,
      activeSocket: null,
      analysisGeneration: 0,
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
        phase: 2,
        message: "B 处理中",
        progress: 0.4,
      }),
    } as MessageEvent);
    expect(useAnalysisStore.getState().currentPhase).toBe(2);
    expect(useAnalysisStore.getState().progressMessage).toBe("B 处理中");
  });
});
