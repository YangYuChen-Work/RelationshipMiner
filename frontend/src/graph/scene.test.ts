import { describe, expect, it } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import type { GraphLayout } from "./layout";
import { hitTest } from "./hitTest";
import { buildScene } from "./scene";

const graph: SemanticGraphData = {
  table_nodes: [
    { id: "orders", display_name: "Orders", entity_count: 2 },
    { id: "users", display_name: "Users", entity_count: 2 },
    { id: "audit", display_name: "Audit", entity_count: 0 },
    { id: "orphan", display_name: "Orphan", entity_count: 0 },
  ],
  entity_nodes: [
    { id: "order-1", table_id: "orders", display_name: "Order 1", class_name: null, dimensions: {} },
    { id: "order-2", table_id: "orders", display_name: "Order 2", class_name: null, dimensions: {} },
    { id: "user-1", table_id: "users", display_name: "Ada", class_name: "Customer", dimensions: {} },
    { id: "user-2", table_id: "users", display_name: "Grace", class_name: null, dimensions: {} },
  ],
  table_edges: [
    { id: "orders-users", source_table: "orders", target_table: "users", relation_types: ["owns"], strong_count: 0, weak_count: 1, entity_edge_count: 1, average_confidence: 0.8, supporting_entity_edges: ["weak-edge"] },
    { id: "orders-audit", source_table: "orders", target_table: "audit", relation_types: ["logged"], strong_count: 1, weak_count: 0, entity_edge_count: 1, average_confidence: 0, supporting_entity_edges: ["strong-edge"] },
    { id: "missing-table", source_table: "orders", target_table: "missing", relation_types: [], strong_count: 0, weak_count: 1, entity_edge_count: 1, average_confidence: 1, supporting_entity_edges: [] },
  ],
  entity_edges: [
    {
      id: "weak-edge",
      source: "order-1",
      target: "user-1",
      relations: [{ source: "order-1", target: "user-1", relation_type: "owns", direction: "source_to_target", strength: "weak", confidence: 0.8, explanation: "", evidence: [], model_id: null, task_id: null }],
    },
    {
      id: "strong-edge",
      source: "order-2",
      target: "user-2",
      relations: [{ source: "order-2", target: "user-2", relation_type: "created", direction: "source_to_target", strength: "strong", confidence: 0, explanation: "", evidence: [], model_id: null, task_id: null }],
    },
    { id: "missing-entity", source: "order-1", target: "missing", relations: [] },
  ],
};

const layout: GraphLayout = {
  tableRegions: [],
  tableNodes: [
    { id: "orders", x: 20, y: 30 },
    { id: "users", x: 120, y: 30 },
    { id: "audit", x: 220, y: 30 },
    { id: "orphan", x: 20, y: 130 },
  ],
  entityNodes: [
    { id: "order-1", tableId: "orders", x: 20, y: 80 },
    { id: "order-2", tableId: "orders", x: 40, y: 80 },
    { id: "user-1", tableId: "users", x: 120, y: 80 },
    { id: "user-2", tableId: "users", x: 140, y: 80 },
  ],
  tableEdges: [
    { id: "orders-users", source: "orders", target: "users", from: { x: 20, y: 30 }, to: { x: 120, y: 30 } },
    { id: "orders-audit", source: "orders", target: "audit", from: { x: 20, y: 30 }, to: { x: 220, y: 30 } },
    { id: "missing-table", source: "orders", target: "missing", from: { x: 20, y: 30 }, to: { x: 320, y: 30 } },
  ],
  entityEdges: [
    { id: "weak-edge", source: "order-1", target: "user-1", from: { x: 20, y: 80 }, to: { x: 120, y: 80 } },
    { id: "strong-edge", source: "order-2", target: "user-2", from: { x: 40, y: 80 }, to: { x: 140, y: 80 } },
    { id: "missing-entity", source: "order-1", target: "missing", from: { x: 20, y: 80 }, to: { x: 320, y: 80 } },
  ],
};

function input(k: number, confidenceThreshold = 0) {
  return { graph, layout, transform: { k, x: 10, y: 20 }, confidenceThreshold };
}

describe("buildScene", () => {
  it("uses the exact semantic zoom boundaries", () => {
    expect(buildScene(input(0.649)).tableNodes).toHaveLength(4);
    expect(buildScene(input(0.649)).entityDots).toHaveLength(0);
    expect(buildScene(input(0.649)).entityLabels).toHaveLength(0);

    expect(buildScene(input(0.65)).entityDots).toHaveLength(4);
    expect(buildScene(input(0.65)).entityLabels).toHaveLength(0);
    expect(buildScene(input(1.199)).entityLabels).toHaveLength(0);
    expect(buildScene(input(1.2)).entityLabels).toHaveLength(4);
  });

  it("keeps world coordinates separate from transformed screen coordinates", () => {
    const scene = buildScene(input(2));
    expect(scene.tableNodes[0]).toMatchObject({
      world: { x: 20, y: 30 },
      screen: { x: 50, y: 80 },
    });
    expect(scene.entityEdges[0]).toMatchObject({
      from: { world: { x: 20, y: 80 }, screen: { x: 50, y: 180 } },
      to: { world: { x: 120, y: 80 }, screen: { x: 250, y: 180 } },
    });
  });

  it("filters weak draw commands without mutating graph data or layout", () => {
    const scene = buildScene(input(1.2, 0.9));
    expect(scene.entityEdges.map((edge) => edge.id)).toEqual(["strong-edge"]);
    expect(scene.tableEdges.map((edge) => edge.id)).toEqual(["orders-audit"]);
    expect(graph.entity_edges).toHaveLength(3);
    expect(graph.table_edges).toHaveLength(3);
    expect(layout.entityEdges).toHaveLength(3);
    expect(layout.tableEdges).toHaveLength(3);
  });

  it("keeps deterministic strong relationships visible at every confidence threshold", () => {
    const scene = buildScene(input(1.2, 1));
    expect(scene.entityEdges.map((edge) => edge.id)).toContain("strong-edge");
    expect(scene.tableEdges.map((edge) => edge.id)).toContain("orders-audit");
  });

  it("drops draw commands with missing endpoints or non-finite geometry", () => {
    const brokenLayout: GraphLayout = {
      ...layout,
      tableNodes: [...layout.tableNodes, { id: "bad", x: Number.NaN, y: 0 }],
      entityNodes: [...layout.entityNodes, { id: "bad-entity", tableId: "orders", x: Infinity, y: 0 }],
    };
    const brokenGraph: SemanticGraphData = {
      ...graph,
      table_nodes: [...graph.table_nodes, { id: "bad", display_name: "Bad", entity_count: 0 }],
      entity_nodes: [...graph.entity_nodes, { id: "bad-entity", table_id: "orders", display_name: "Bad", class_name: null, dimensions: {} }],
    };
    const scene = buildScene({ ...input(1.2), graph: brokenGraph, layout: brokenLayout });
    expect(scene.tableNodes.some((node) => node.id === "bad")).toBe(false);
    expect(scene.entityDots.some((node) => node.id === "bad-entity")).toBe(false);
    expect(scene.tableEdges.some((edge) => edge.id === "missing-table")).toBe(false);
    expect(scene.entityEdges.some((edge) => edge.id === "missing-entity")).toBe(false);
  });

  it("returns an empty finite scene for empty graph input and ignores NaN confidence", () => {
    const empty: SemanticGraphData = {
      table_nodes: [],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    const emptyLayout: GraphLayout = {
      tableRegions: [],
      tableNodes: [],
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    };
    expect(buildScene({ graph: empty, layout: emptyLayout, transform: { k: Number.NaN, x: Number.NaN, y: Infinity }, confidenceThreshold: Number.NaN })).toMatchObject({
      transform: { k: 1, x: 0, y: 0 },
      tableNodes: [],
      entityDots: [],
      tableEdges: [],
      entityEdges: [],
    });

    const invalidConfidence: SemanticGraphData = {
      ...graph,
      table_edges: [{ ...graph.table_edges[0], average_confidence: Number.NaN }],
      entity_edges: [{ ...graph.entity_edges[0], relations: [{ ...graph.entity_edges[0].relations[0], confidence: Number.NaN }] }],
    };
    const scene = buildScene({ ...input(1.2), graph: invalidConfidence, confidenceThreshold: 0 });
    expect(scene.tableEdges).toHaveLength(0);
    expect(scene.entityEdges).toHaveLength(0);
  });

  it("skips nodes whose extreme zoom produces unusable screen radii", () => {
    const extremeGraph: SemanticGraphData = {
      table_nodes: [{ id: "origin", display_name: "Origin", entity_count: 0 }],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    const extremeLayout: GraphLayout = {
      tableRegions: [],
      tableNodes: [{ id: "origin", x: 0, y: 0 }],
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    };

    const scene = buildScene({
      graph: extremeGraph,
      layout: extremeLayout,
      transform: { k: Number.MAX_VALUE, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(scene.tableNodes).toHaveLength(0);
    expect(hitTest(scene, { x: 0, y: 0 })).toBeNull();
  });

  it("emits only finite table regions with positive dimensions after transformation", () => {
    const regionGraph: SemanticGraphData = {
      table_nodes: [
        { id: "valid", display_name: "Valid", entity_count: 0 },
        { id: "zero", display_name: "Zero", entity_count: 0 },
        { id: "negative", display_name: "Negative", entity_count: 0 },
      ],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    const regionLayout: GraphLayout = {
      tableRegions: [
        { id: "valid", x: 1, y: 5, width: 20, height: 10, header: { x: 1, y: 5 } },
        { id: "zero", x: 0, y: 0, width: 0, height: 10, header: { x: 0, y: 0 } },
        { id: "negative", x: 0, y: 0, width: 10, height: -1, header: { x: 0, y: 0 } },
      ],
      tableNodes: [],
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    };

    expect(buildScene({
      graph: regionGraph,
      layout: regionLayout,
      transform: { k: 2, x: 5, y: 7 },
      confidenceThreshold: 0,
    }).tableRegions.map((region) => region.id)).toEqual(["valid"]);

    const overflowingLayout: GraphLayout = {
      ...regionLayout,
      tableRegions: [
        { id: "valid", x: 0, y: 0, width: 2, height: 2, header: { x: 0, y: 0 } },
      ],
    };
    expect(buildScene({
      graph: regionGraph,
      layout: overflowingLayout,
      transform: { k: Number.MAX_VALUE, x: 0, y: 0 },
      confidenceThreshold: 0,
    }).tableRegions).toHaveLength(0);
  });

  it("keeps finite table regions when normal camera panning makes x and y negative", () => {
    const pannedGraph: SemanticGraphData = {
      table_nodes: [{ id: "panned", display_name: "Panned", entity_count: 0 }],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    const pannedLayout: GraphLayout = {
      tableRegions: [{
        id: "panned",
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        header: { x: 20, y: 30 },
      }],
      tableNodes: [],
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    };

    const scene = buildScene({
      graph: pannedGraph,
      layout: pannedLayout,
      transform: { k: 2, x: -50, y: -70 },
      confidenceThreshold: 0,
    });

    expect(scene.tableRegions).toEqual([{
      id: "panned",
      world: { x: 10, y: 20, width: 100, height: 50 },
      screen: { x: -30, y: -30, width: 200, height: 100 },
    }]);
  });
});
