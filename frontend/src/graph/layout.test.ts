import { describe, expect, it } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import { computeGroupedLayout } from "./layout";
import { LayoutClient, StaleLayoutRequestError } from "./layoutClient";

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
  it("keeps sorted entities inside their source table regions and separates edge levels", () => {
    const layout = computeGroupedLayout(graphFixture(), { width: 1200, height: 800 });

    expect(layout.tableRegions).toHaveLength(2);
    for (const entity of layout.entityNodes) {
      const region = layout.tableRegions.find((candidate) => candidate.id === entity.tableId);
      expect(region).toBeDefined();
      expect(entity.x).toBeGreaterThanOrEqual(region!.x);
      expect(entity.x).toBeLessThanOrEqual(region!.x + region!.width);
      expect(entity.y).toBeGreaterThanOrEqual(region!.y);
      expect(entity.y).toBeLessThanOrEqual(region!.y + region!.height);
    }
    expect(layout.tableEdges).toHaveLength(1);
    expect(layout.entityEdges).toHaveLength(1);
    expect(layout.tableEdges[0]).toMatchObject({ source: "orders", target: "users" });
    expect(layout.entityEdges[0]).toMatchObject({ source: "order-1", target: "user-1" });
  });

  it("is stable under input reordering and bounds regions by selected tables", () => {
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

    const largeGraph: SemanticGraphData = {
      table_nodes: Array.from({ length: 10 }, (_, index) => ({ id: `table-${index}`, display_name: `Table ${index}`, entity_count: 700 })),
      entity_nodes: Array.from({ length: 7_000 }, (_, index) => ({ id: `entity-${index}`, table_id: `table-${index % 10}`, display_name: `Entity ${index}`, class_name: null, dimensions: {} })),
      table_edges: [],
      entity_edges: [],
    };
    expect(computeGroupedLayout(largeGraph, { width: 1600, height: 900 }).tableRegions).toHaveLength(10);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe("LayoutClient", () => {
  it("rejects stale graph/reset work and terminates its worker", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const graph = graphFixture();
    const stale = client.layoutGraph(graph, { width: 800, height: 600 });
    const current = client.layoutGraph(graph, { width: 800, height: 600 });

    await expect(stale).rejects.toBeInstanceOf(StaleLayoutRequestError);
    const latest = worker.messages.at(-1) as { requestId: number };
    worker.reply({ requestId: latest.requestId, layout: computeGroupedLayout(graph, { width: 800, height: 600 }) });
    await expect(current).resolves.toMatchObject({ tableRegions: expect.any(Array) });

    const afterReset = client.layoutGraph(graph, { width: 800, height: 600 });
    client.reset();
    await expect(afterReset).rejects.toBeInstanceOf(StaleLayoutRequestError);
    client.dispose();
    expect(worker.terminated).toBe(true);
  });
});
