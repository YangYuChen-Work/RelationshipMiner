import { describe, expect, it } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import { computeGroupedLayout } from "./layout";
import {
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

function expectEntitiesContained(
  layout: ReturnType<typeof computeGroupedLayout>,
) {
  for (const entity of layout.entityNodes) {
    const region = layout.tableRegions.find(
      (candidate) => candidate.id === entity.tableId,
    );
    expect(region).toBeDefined();
    expect(entity.x).toBeGreaterThanOrEqual(region!.x);
    expect(entity.x).toBeLessThanOrEqual(region!.x + region!.width);
    expect(entity.y).toBeGreaterThanOrEqual(region!.y);
    expect(entity.y).toBeLessThanOrEqual(region!.y + region!.height);
  }
}

describe("computeGroupedLayout", () => {
  it("keeps sorted entities inside their source table regions and separates edge levels", () => {
    const layout = computeGroupedLayout(graphFixture(), { width: 1200, height: 800 });

    expect(layout.tableRegions).toHaveLength(2);
    expectEntitiesContained(layout);
    expect(layout.tableEdges).toHaveLength(1);
    expect(layout.entityEdges).toHaveLength(1);
    const orders = layout.tableRegions.find((region) => region.id === "orders")!;
    const users = layout.tableRegions.find((region) => region.id === "users")!;
    const order = layout.entityNodes.find((entity) => entity.id === "order-1")!;
    const user = layout.entityNodes.find((entity) => entity.id === "user-1")!;
    expect(layout.tableEdges[0]).toMatchObject({
      source: "orders",
      target: "users",
      from: orders.header,
      to: users.header,
    });
    expect(layout.entityEdges[0]).toMatchObject({
      source: "order-1",
      target: "user-1",
      from: { x: order.x, y: order.y },
      to: { x: user.x, y: user.y },
    });
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

  it("contains all 7,000 entities in no more than ten selected table regions", () => {
    const largeGraph: SemanticGraphData = {
      table_nodes: Array.from({ length: 10 }, (_, index) => ({ id: `table-${index}`, display_name: `Table ${index}`, entity_count: 700 })),
      entity_nodes: Array.from({ length: 7_000 }, (_, index) => ({ id: `entity-${index}`, table_id: `table-${index % 10}`, display_name: `Entity ${index}`, class_name: null, dimensions: {} })),
      table_edges: [],
      entity_edges: [],
    };
    const layout = computeGroupedLayout(largeGraph, { width: 1600, height: 900 });
    expect(layout.tableRegions).toHaveLength(10);
    expect(layout.entityNodes).toHaveLength(7_000);
    expectEntitiesContained(layout);
  });

  it("sizes a table region for a non-square 701-entity group", () => {
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
    expectEntitiesContained(layout);
  });

  it("returns finite output for empty, unknown-owned, tiny, and zero viewports", () => {
    const empty: SemanticGraphData = {
      table_nodes: [],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    expect(computeGroupedLayout(empty, { width: 0, height: 0 })).toEqual({
      tableRegions: [],
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
      ...layout.tableRegions.flatMap((region) => [
        region.x,
        region.y,
        region.width,
        region.height,
        region.header.x,
        region.header.y,
      ]),
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
  it("settles concurrent requests by increasing ID even when replies are out of order", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const graph = graphFixture();
    const first = client.layoutGraph(graph, { width: 800, height: 600 });
    const second = client.layoutGraph(graph, { width: 400, height: 300 });
    const requests = worker.messages as { requestId: number }[];
    expect(requests.map((request) => request.requestId)).toEqual([1, 2]);

    const firstLayout = computeGroupedLayout(graph, { width: 800, height: 600 });
    const secondLayout = { ...firstLayout, entityNodes: [] };
    worker.reply({ requestId: 2, layout: secondLayout });
    await expect(second).resolves.toBe(secondLayout);
    worker.reply({ requestId: 1, layout: firstLayout });
    await expect(first).resolves.toBe(firstLayout);
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
    expect(worker.messages).toHaveLength(2);
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
    expect(worker.messages).toHaveLength(2);
  });
});
