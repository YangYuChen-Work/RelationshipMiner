import { describe, expect, it } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import { computeGroupedLayout } from "./layout";
import {
  createLayoutClient,
  LayoutClient,
  LayoutClientDisposedError,
  StaleLayoutRequestError,
} from "./layoutClient";

function graphFixture(): SemanticGraphData {
  return {
    table_nodes: [
      { id: "orders", display_name: "Orders", entity_count: 2 },
      { id: "users", display_name: "Users", entity_count: 2 },
    ],
    entity_nodes: [
      { id: "order-2", table_id: "orders", display_name: "Order 2", class_name: null, dimensions: {} },
      { id: "user-2", table_id: "users", display_name: "User 2", class_name: null, dimensions: {} },
      { id: "order-1", table_id: "orders", display_name: "Order 1", class_name: null, dimensions: {} },
      { id: "user-1", table_id: "users", display_name: "User 1", class_name: null, dimensions: {} },
    ],
    table_edges: [
      { id: "orders-users", source_table: "orders", target_table: "users", relation_types: ["owns"], strong_count: 1, weak_count: 0, entity_edge_count: 1, average_confidence: 1, supporting_entity_edges: ["order-user"] },
      { id: "missing-table", source_table: "orders", target_table: "missing", relation_types: [], strong_count: 0, weak_count: 0, entity_edge_count: 0, average_confidence: 0, supporting_entity_edges: [] },
    ],
    entity_edges: [
      { id: "order-user", source: "order-1", target: "user-1", relations: [] },
      { id: "missing-entity", source: "order-1", target: "missing", relations: [] },
    ],
  };
}

describe("computeGroupedLayout", () => {
  it("places separated table anchors with their entities orbiting instead of emitting table rectangles", () => {
    const layout = computeGroupedLayout(graphFixture(), { width: 1200, height: 800 });

    expect(layout.tableNodes).toHaveLength(2);
    expect(Math.hypot(
      layout.tableNodes[0].x - layout.tableNodes[1].x,
      layout.tableNodes[0].y - layout.tableNodes[1].y,
    )).toBeGreaterThanOrEqual(240);
    for (const entity of layout.entityNodes) {
      const anchor = layout.tableNodes.find((table) => table.id === entity.tableId)!;
      expect(Math.hypot(entity.x - anchor.x, entity.y - anchor.y)).toBeGreaterThan(0);
    }
    expect(layout.tableEdges).toHaveLength(1);
    expect(layout.entityEdges).toHaveLength(1);
    const orders = layout.tableNodes.find((node) => node.id === "orders")!;
    const users = layout.tableNodes.find((node) => node.id === "users")!;
    const order = layout.entityNodes.find((entity) => entity.id === "order-1")!;
    const user = layout.entityNodes.find((entity) => entity.id === "user-1")!;
    expect(layout.tableEdges[0]).toMatchObject({
      source: "orders",
      target: "users",
      from: { x: orders.x, y: orders.y },
      to: { x: users.x, y: users.y },
    });
    expect(layout.entityEdges[0]).toMatchObject({
      source: "order-1",
      target: "user-1",
      from: { x: order.x, y: order.y },
      to: { x: user.x, y: user.y },
    });
  });

  it("orders known process classes before stable fallback table IDs", () => {
    const tables = ["zeta", "Assembly", "MEStep", "MEOperation", "MEProcess", "alpha"];
    const graph: SemanticGraphData = {
      table_nodes: tables.map((id) => ({
        id,
        display_name: id,
        entity_count: 0,
      })),
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };

    expect(
      computeGroupedLayout(graph, { width: 1800, height: 600 })
        .tableNodes.map((node) => node.id),
    ).toEqual([
      "MEProcess",
      "MEOperation",
      "MEStep",
      "Assembly",
      "alpha",
      "zeta",
    ]);
  });

  it("is stable under input reordering", () => {
    const first = graphFixture();
    const second = {
      ...first,
      table_nodes: [...first.table_nodes].reverse(),
      entity_nodes: [...first.entity_nodes].reverse(),
      table_edges: [...first.table_edges].reverse(),
      entity_edges: [...first.entity_edges].reverse(),
    };
    expect(computeGroupedLayout(first, { width: 800, height: 600 })).toEqual(
      computeGroupedLayout(second, { width: 800, height: 600 }),
    );
  });

  it("places all 7,000 entities on finite expanding rings around ten anchors", () => {
    const largeGraph: SemanticGraphData = {
      table_nodes: Array.from({ length: 10 }, (_, index) => ({ id: `table-${index}`, display_name: `Table ${index}`, entity_count: 700 })),
      entity_nodes: Array.from({ length: 7_000 }, (_, index) => ({ id: `entity-${index}`, table_id: `table-${index % 10}`, display_name: `Entity ${index}`, class_name: null, dimensions: {} })),
      table_edges: [],
      entity_edges: [],
    };
    const layout = computeGroupedLayout(largeGraph, { width: 1600, height: 900 });
    expect(layout.tableNodes).toHaveLength(10);
    expect(layout.entityNodes).toHaveLength(7_000);
    expect(layout.entityNodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
    const firstAnchor = layout.tableNodes.find((node) => node.id === "table-0")!;
    const radii = layout.entityNodes
      .filter((node) => node.tableId === firstAnchor.id)
      .map((node) => Math.hypot(node.x - firstAnchor.x, node.y - firstAnchor.y));
    expect(Math.max(...radii)).toBeGreaterThan(Math.min(...radii));
  });

  it("uses additional rings for a non-square 701-entity cluster", () => {
    const graph: SemanticGraphData = {
      table_nodes: [{ id: "only", display_name: "Only", entity_count: 701 }],
      entity_nodes: Array.from({ length: 701 }, (_, index) => ({
        id: `entity-${index}`,
        table_id: "only",
        display_name: `Entity ${index}`,
        class_name: null,
        dimensions: {},
      })),
      table_edges: [],
      entity_edges: [],
    };
    const layout = computeGroupedLayout(graph, { width: 1, height: 1 });
    expect(layout.entityNodes).toHaveLength(701);
    expect(new Set(layout.entityNodes.map((entity) =>
      Math.round(Math.hypot(
        entity.x - layout.tableNodes[0].x,
        entity.y - layout.tableNodes[0].y,
      )),
    )).size).toBeGreaterThan(1);
  });

  it("returns finite output for empty, unknown-owned, tiny, and zero viewports", () => {
    const empty: SemanticGraphData = {
      table_nodes: [],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    expect(computeGroupedLayout(empty, { width: 0, height: 0 })).toEqual({
      tableNodes: [],
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    });

    const graph = graphFixture();
    graph.entity_nodes.push({
      id: "orphan",
      table_id: "unknown",
      display_name: "Orphan",
      class_name: null,
      dimensions: {},
    });
    const layout = computeGroupedLayout(graph, { width: 0, height: 0 });
    expect(layout.entityNodes.some((entity) => entity.id === "orphan")).toBe(false);
    const numericValues = [
      ...layout.tableNodes.flatMap((node) => [node.x, node.y]),
      ...layout.entityNodes.flatMap((entity) => [entity.x, entity.y]),
      ...layout.tableEdges.flatMap((edge) => [
        edge.from.x,
        edge.from.y,
        edge.to.x,
        edge.to.y,
      ]),
      ...layout.entityEdges.flatMap((edge) => [
        edge.from.x,
        edge.from.y,
        edge.to.x,
        edge.to.y,
      ]),
    ];
    expect(numericValues.every(Number.isFinite)).toBe(true);
  });

  it.each([
    ["table node", "table_nodes"],
    ["entity node", "entity_nodes"],
    ["table edge", "table_edges"],
    ["entity edge", "entity_edges"],
  ] as const)("rejects duplicate %s IDs", (label, collection) => {
    const graph = graphFixture();
    graph[collection].push(graph[collection][0] as never);
    expect(() =>
      computeGroupedLayout(graph, { width: 800, height: 600 }),
    ).toThrow(new RegExp(`Duplicate ${label} id`));
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  readonly messages: unknown[] = [];
  terminateCount = 0;

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminateCount += 1;
  }

  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }

  fail() {
    this.onerror?.(new ErrorEvent("error"));
  }

  failMessage() {
    this.onmessageerror?.(new MessageEvent("messageerror"));
  }
}

describe("LayoutClient", () => {
  it("creates isolated clients whose disposal does not terminate a sibling", async () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const first = createLayoutClient(firstWorker as unknown as Worker);
    const second = createLayoutClient(secondWorker as unknown as Worker);
    const pending = second.layoutGraph(graphFixture(), { width: 800, height: 600 });

    first.dispose();
    expect(firstWorker.terminateCount).toBe(1);
    expect(secondWorker.terminateCount).toBe(0);

    const request = secondWorker.messages[0] as { requestId: number };
    const layout = computeGroupedLayout(graphFixture(), { width: 800, height: 600 });
    secondWorker.reply({ requestId: request.requestId, layout });
    await expect(pending).resolves.toBe(layout);
  });

  it("coalesces queued layout requests and posts only the latest heavy change", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const graph = graphFixture();
    const first = client.layoutGraph(graph, { width: 800, height: 600 });
    const second = client.layoutGraph(graph, { width: 400, height: 300 });
    const third = client.layoutGraph(graph, { width: 320, height: 240 });
    const secondRejection = second.catch((error: unknown) => error);

    const firstLayout = computeGroupedLayout(graph, { width: 800, height: 600 });
    const firstRequest = worker.messages[0] as { requestId: number };
    expect(worker.messages).toHaveLength(1);
    worker.reply({ requestId: firstRequest.requestId, layout: firstLayout });
    await expect(first).resolves.toBe(firstLayout);
    expect(await secondRejection).toBeInstanceOf(StaleLayoutRequestError);

    const thirdRequest = worker.messages[1] as {
      requestId: number;
      viewport: { width: number; height: number };
    };
    expect(worker.messages).toHaveLength(2);
    expect(thirdRequest.viewport).toEqual({ width: 320, height: 240 });
    const thirdLayout = computeGroupedLayout(graph, thirdRequest.viewport);
    worker.reply({ requestId: thirdRequest.requestId, layout: thirdLayout });
    await expect(third).resolves.toBe(thirdLayout);
  });

  it("posts a compact layout DTO without dimensions, evidence, or support payloads", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const graph = graphFixture();
    graph.entity_nodes[0].dimensions = {
      secret_dimension: "dimension-value".repeat(1_000),
    };
    graph.entity_edges[0].relations = [{
      source: "order-1",
      target: "user-1",
      relation_type: "owns",
      direction: "source_to_target",
      strength: "strong",
      confidence: 1,
      explanation: "explanation-value".repeat(1_000),
      evidence: [{
        source_field: "secret_dimension",
        source_value: "source-evidence-value".repeat(1_000),
        target_field: "name",
        target_value: "target-evidence-value".repeat(1_000),
        method: "llm_semantic_reasoning",
        reason: "support-reason".repeat(1_000),
      }],
      model_id: null,
      task_id: null,
    }];
    graph.table_edges[0].supporting_entity_edges = Array.from(
      { length: 1_000 },
      (_, index) => `support-${index}`,
    );

    const pending = client.layoutGraph(graph, { width: 800, height: 600 });
    const request = worker.messages[0] as {
      requestId: number;
      graph: Record<string, unknown>;
      viewport: { width: number; height: number };
    };
    const posted = JSON.stringify(request.graph);

    expect(request.graph).toEqual({
      table_nodes: [
        { id: "orders", display_name: "Orders" },
        { id: "users", display_name: "Users" },
      ],
      entity_nodes: [
        { id: "order-2", table_id: "orders", class_name: null },
        { id: "user-2", table_id: "users", class_name: null },
        { id: "order-1", table_id: "orders", class_name: null },
        { id: "user-1", table_id: "users", class_name: null },
      ],
      table_edges: [
        {
          id: "orders-users",
          source_table: "orders",
          target_table: "users",
        },
        {
          id: "missing-table",
          source_table: "orders",
          target_table: "missing",
        },
      ],
      entity_edges: [
        { id: "order-user", source: "order-1", target: "user-1" },
        { id: "missing-entity", source: "order-1", target: "missing" },
      ],
    });
    expect(posted).not.toContain("dimension-value");
    expect(posted).not.toContain("evidence-value");
    expect(posted).not.toContain("explanation-value");
    expect(posted).not.toContain("support-");

    const layout = computeGroupedLayout(
      request.graph as never,
      request.viewport,
    );
    worker.reply({ requestId: request.requestId, layout });
    await expect(pending).resolves.toBe(layout);
  });

  it("rejects reset work, ignores its late reply, and accepts later requests", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const graph = graphFixture();
    const stale = client.layoutGraph(graph, { width: 800, height: 600 });
    const staleRequest = worker.messages[0] as { requestId: number };
    const staleRejection = expect(stale).rejects.toBeInstanceOf(
      StaleLayoutRequestError,
    );
    client.reset();
    await staleRejection;
    worker.reply({
      requestId: staleRequest.requestId,
      layout: computeGroupedLayout(graph, { width: 800, height: 600 }),
    });

    const current = client.layoutGraph(graph, { width: 800, height: 600 });
    const currentRequest = worker.messages[1] as { requestId: number };
    expect(currentRequest.requestId).toBeGreaterThan(staleRequest.requestId);
    const currentLayout = computeGroupedLayout(graph, {
      width: 800,
      height: 600,
    });
    worker.reply({ requestId: currentRequest.requestId, layout: currentLayout });
    await expect(current).resolves.toBe(currentLayout);
  });

  it("settles all pending work and terminates exactly once on dispose", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const first = client.layoutGraph(graphFixture(), { width: 800, height: 600 });
    const second = client.layoutGraph(graphFixture(), { width: 400, height: 300 });
    const firstRejection = expect(first).rejects.toBeInstanceOf(
      LayoutClientDisposedError,
    );
    const secondRejection = expect(second).rejects.toBeInstanceOf(
      LayoutClientDisposedError,
    );

    client.dispose();
    await Promise.all([firstRejection, secondRejection]);
    client.dispose();
    expect(worker.terminateCount).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    await expect(
      client.layoutGraph(graphFixture(), { width: 800, height: 600 }),
    ).rejects.toBeInstanceOf(LayoutClientDisposedError);
    expect(worker.messages).toHaveLength(1);
  });

  it.each([
    ["worker error", (worker: FakeWorker) => worker.fail()],
    ["worker message error", (worker: FakeWorker) => worker.failMessage()],
  ])("rejects and clears all pending work after a %s", async (_label, fail) => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const first = client.layoutGraph(graphFixture(), { width: 800, height: 600 });
    const second = client.layoutGraph(graphFixture(), { width: 400, height: 300 });
    const firstRejection = expect(first).rejects.toThrow(/layout worker/i);
    const secondRejection = expect(second).rejects.toThrow(/layout worker/i);

    fail(worker);
    await Promise.all([firstRejection, secondRejection]);
    expect(worker.terminateCount).toBe(1);
    await expect(
      client.layoutGraph(graphFixture(), { width: 800, height: 600 }),
    ).rejects.toThrow(/layout worker/i);
    expect(worker.messages).toHaveLength(1);
  });
});
