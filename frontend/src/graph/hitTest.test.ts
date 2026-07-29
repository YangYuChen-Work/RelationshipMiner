import { describe, expect, it } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import type { GraphLayout } from "./layout";
import { getHitTestCandidates, hitTest } from "./hitTest";
import { buildScene } from "./scene";

function graphFixture(): SemanticGraphData {
  return {
    table_nodes: [
      { id: "orders", display_name: "Orders", entity_count: 1 },
      { id: "users", display_name: "Users", entity_count: 1 },
    ],
    entity_nodes: [
      { id: "order-1", table_id: "orders", display_name: "Order", class_name: null, dimensions: {} },
      { id: "user-1", table_id: "users", display_name: "User", class_name: null, dimensions: {} },
    ],
    table_edges: [{ id: "table-edge", source_table: "orders", target_table: "users", relation_types: [], strong_count: 0, weak_count: 1, entity_edge_count: 1, average_confidence: 1, supporting_entity_edges: ["entity-edge"] }],
    entity_edges: [{ id: "entity-edge", source: "order-1", target: "user-1", relations: [{ source: "order-1", target: "user-1", relation_type: "owns", direction: "source_to_target", strength: "weak", confidence: 1, explanation: "", evidence: [], model_id: null, task_id: null }] }],
  };
}

function layoutFixture(): GraphLayout {
  return {
    tableRegions: [],
    tableNodes: [{ id: "orders", x: 0, y: 0 }, { id: "users", x: 100, y: 0 }],
    entityNodes: [{ id: "order-1", tableId: "orders", x: 0, y: 50 }, { id: "user-1", tableId: "users", x: 100, y: 50 }],
    tableEdges: [{ id: "table-edge", source: "orders", target: "users", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }],
    entityEdges: [{ id: "entity-edge", source: "order-1", target: "user-1", from: { x: 0, y: 50 }, to: { x: 100, y: 50 } }],
  };
}

function scene(k = 1.2) {
  return buildScene({ graph: graphFixture(), layout: layoutFixture(), transform: { k, x: 20, y: 30 }, confidenceThreshold: 0 });
}

describe("hitTest", () => {
  it("returns nodes before overlapping edge targets, matching canvas draw priority", () => {
    const rendered = scene();
    expect(hitTest(rendered, { x: 20, y: 30 })).toEqual({ kind: "table-node", id: "orders" });
    expect(hitTest(rendered, { x: 20, y: 90 })).toEqual({ kind: "entity-node", id: "order-1" });
  });

  it("selects entity edges before table edges and returns null outside indexed bounds", () => {
    const rendered = scene();
    expect(hitTest(rendered, { x: 80, y: 90 })).toEqual({ kind: "entity-edge", id: "entity-edge" });
    expect(hitTest(rendered, { x: 70, y: 30 })).toEqual({ kind: "table-edge", id: "table-edge" });
    expect(hitTest(rendered, { x: 999, y: 999 })).toBeNull();
  });

  it("keeps node targets usable when zoom makes their visual radius very small", () => {
    const rendered = scene(0.65);
    expect(hitTest(rendered, { x: 21, y: 31 })).toEqual({ kind: "table-node", id: "orders" });
    expect(hitTest(rendered, { x: 21, y: 63.5 })).toEqual({ kind: "entity-node", id: "order-1" });
  });

  it("queries only nearby grid cells instead of scanning a 7,000-node scene", () => {
    const count = 7_000;
    const largeGraph: SemanticGraphData = {
      table_nodes: [{ id: "table", display_name: "Table", entity_count: count }],
      entity_nodes: Array.from({ length: count }, (_, index) => ({ id: `entity-${index}`, table_id: "table", display_name: `Entity ${index}`, class_name: null, dimensions: {} })),
      table_edges: [],
      entity_edges: [],
    };
    const largeLayout: GraphLayout = {
      tableRegions: [],
      tableNodes: [{ id: "table", x: -100, y: -100 }],
      entityNodes: Array.from({ length: count }, (_, index) => ({ id: `entity-${index}`, tableId: "table", x: (index % 100) * 24, y: Math.floor(index / 100) * 24 })),
      tableEdges: [],
      entityEdges: [],
    };
    const rendered = buildScene({ graph: largeGraph, layout: largeLayout, transform: { k: 1, x: 0, y: 0 }, confidenceThreshold: 0 });
    const candidates = getHitTestCandidates(rendered, { x: 1, y: 1 });
    expect(candidates.nodeIds.length).toBeLessThan(100);
    expect(candidates.edgeIds).toHaveLength(0);
  });
});
