import { describe, expect, it } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import type { GraphLayout } from "./layout";
import {
  createHitIndex,
  getHitTestCandidates,
  hitTest,
  hitTestWithDiagnostics,
} from "./hitTest";
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

  it("indexes a long diagonal by traversed cells rather than its full bounding box", () => {
    const graph = graphFixture();
    graph.table_edges = [];
    graph.entity_edges = [{ ...graph.entity_edges[0], id: "diagonal" }];
    const layout = layoutFixture();
    layout.tableEdges = [];
    layout.entityEdges = [{
      id: "diagonal",
      source: "order-1",
      target: "user-1",
      from: { x: -3_200, y: -3_200 },
      to: { x: 3_200, y: 3_200 },
    }];
    const rendered = buildScene({
      graph,
      layout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(rendered.hitIndex.entityEdges.size).toBeLessThan(1_000);
    expect(hitTest(rendered, { x: 500, y: 500 })).toEqual({
      kind: "entity-edge",
      id: "diagonal",
    });
  });

  it("handles horizontal, vertical, zero-length, and negative-coordinate segments", () => {
    const graph = graphFixture();
    graph.table_edges = [];
    graph.entity_edges = ["horizontal", "vertical", "zero", "negative"].map(
      (id) => ({ ...graph.entity_edges[0], id }),
    );
    const layout = layoutFixture();
    layout.tableNodes = [];
    layout.tableEdges = [];
    layout.entityEdges = [
      { id: "horizontal", source: "order-1", target: "user-1", from: { x: -192, y: -100 }, to: { x: 192, y: -100 } },
      { id: "vertical", source: "order-1", target: "user-1", from: { x: 200, y: -192 }, to: { x: 200, y: 192 } },
      { id: "zero", source: "order-1", target: "user-1", from: { x: -150, y: 200 }, to: { x: -150, y: 200 } },
      { id: "negative", source: "order-1", target: "user-1", from: { x: -256, y: -256 }, to: { x: -64, y: -64 } },
    ];
    const rendered = buildScene({
      graph,
      layout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(hitTest(rendered, { x: 0, y: -100 })).toEqual({ kind: "entity-edge", id: "horizontal" });
    expect(hitTest(rendered, { x: 200, y: 0 })).toEqual({ kind: "entity-edge", id: "vertical" });
    expect(hitTest(rendered, { x: -150, y: 200 })).toEqual({ kind: "entity-edge", id: "zero" });
    expect(hitTest(rendered, { x: -160, y: -160 })).toEqual({ kind: "entity-edge", id: "negative" });
  });

  it("safely declines segments whose cell traversal exceeds numeric guards", () => {
    const graph = graphFixture();
    graph.table_edges = [];
    graph.entity_edges = [{ ...graph.entity_edges[0], id: "extreme" }];
    const layout = layoutFixture();
    layout.tableNodes = [];
    layout.tableEdges = [];
    layout.entityEdges = [{
      id: "extreme",
      source: "order-1",
      target: "user-1",
      from: { x: 0, y: 0 },
      to: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
    }];
    const rendered = buildScene({
      graph,
      layout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(rendered.hitIndex.entityEdges.size).toBe(0);
    expect(hitTest(rendered, { x: 0, y: 0 })).toBeNull();
  });

  it("declines a finite near-step-limit edge before retaining a huge partial index", () => {
    const graph = graphFixture();
    graph.table_edges = [];
    graph.entity_edges = [{ ...graph.entity_edges[0], id: "near-limit" }];
    const layout = layoutFixture();
    layout.tableNodes = [];
    layout.tableEdges = [];
    layout.entityEdges = [{
      id: "near-limit",
      source: "order-1",
      target: "user-1",
      from: { x: 0, y: 1_000 },
      to: { x: 99_000 * 64, y: 1_000 },
    }];

    const rendered = buildScene({
      graph,
      layout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(rendered.hitIndex.entityEdges.size).toBe(0);
    expect(hitTest(rendered, { x: 49_500 * 64, y: 1_000 })).toBeNull();
  });

  it("defensively ignores malformed nodes passed directly to the index", () => {
    const malformedNode = {
      id: "malformed",
      label: "Malformed",
      world: { x: 0, y: 0 },
      screen: { x: Number.MAX_VALUE, y: 0 },
      screenRadius: 1,
      hitRadius: Number.MAX_VALUE,
    };
    const index = createHitIndex({
      entityDots: [{
        ...malformedNode,
        tableId: "table",
        className: null,
        presentation: {
          primary: "Malformed",
          secondary: "0 个关系",
          accessibleLabel: "Malformed; 0 个关系",
        },
        visibleDegree: 0,
      }],
      tableNodes: [malformedNode],
      entityEdges: [],
      tableEdges: [],
    });

    expect(index.entityNodes.size).toBe(0);
    expect(index.tableNodes.size).toBe(0);
  });

  it("reports the actual local candidates inspected by hitTest for many long parallel edges", () => {
    const edgeCount = 300;
    const graph: SemanticGraphData = {
      table_nodes: [{ id: "table", display_name: "Table", entity_count: 2 }],
      entity_nodes: [
        { id: "source", table_id: "table", display_name: "Source", class_name: null, dimensions: {} },
        { id: "target", table_id: "table", display_name: "Target", class_name: null, dimensions: {} },
      ],
      table_edges: [],
      entity_edges: Array.from({ length: edgeCount }, (_, index) => ({
        id: `edge-${index}`,
        source: "source",
        target: "target",
        relations: [{
          source: "source",
          target: "target",
          relation_type: "parallel",
          direction: "source_to_target" as const,
          strength: "weak" as const,
          confidence: 1,
          explanation: "",
          evidence: [],
          model_id: null,
          task_id: null,
        }],
      })),
    };
    const layout: GraphLayout = {
      tableNodes: [],
      entityNodes: [
        { id: "source", tableId: "table", x: 10_000, y: 10_000 },
        { id: "target", tableId: "table", x: 10_024, y: 10_000 },
      ],
      tableEdges: [],
      entityEdges: Array.from({ length: edgeCount }, (_, index) => {
        const offset = (index - edgeCount / 2) * 32;
        return {
          id: `edge-${index}`,
          source: "source",
          target: "target",
          from: { x: -3_200, y: -3_200 + offset },
          to: { x: 3_200, y: 3_200 + offset },
        };
      }),
    };
    const rendered = buildScene({
      graph,
      layout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    const result = hitTestWithDiagnostics(rendered, { x: 0, y: 0 });
    expect(result.target).toEqual({ kind: "entity-edge", id: "edge-150" });
    expect(result.diagnostics.edgeCandidates).toBeGreaterThan(0);
    expect(result.diagnostics.edgeCandidates).toBeLessThan(30);
    expect(result.diagnostics.inspectedEdges).toBeLessThanOrEqual(
      result.diagnostics.edgeCandidates,
    );
    expect(result.diagnostics.edgeCandidates).toBeLessThan(edgeCount);
  });
});
