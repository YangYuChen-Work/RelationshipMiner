import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("analysis selection store", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAnalysisStore.setState({
      errorMessage: null,
      selectedTables: new Map(),
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
