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
    const overview = buildScene(input(0.4));
    const work = buildScene(input(0.8));
    const detail = buildScene(input(1.2));

    expect(overview.entityDots).toHaveLength(4);
    expect(overview.entityLabels).toHaveLength(4);
    expect(work.entityDots).toHaveLength(4);
    expect(work.entityLabels).toHaveLength(4);
    expect(detail.entityLabels).toHaveLength(4);
    expect(overview.layerOpacity.tableEdges).toBeGreaterThan(
      overview.layerOpacity.entityEdges,
    );
    expect(work.layerOpacity.entityEdges).toBeGreaterThan(
      work.layerOpacity.tableEdges,
    );
    expect(detail.entityEdges[0].direction).toBe("forward");
    expect(detail.entityLabels[0].secondary).toContain("关系");
  });

  it("retains a meaningful presentation and resolves mixed directions as undirected", () => {
    const mixedGraph: SemanticGraphData = {
      ...graph,
      entity_nodes: [{
        ...graph.entity_nodes[0],
        display_name: "0",
        dimensions: { item_code: "ORDER-001" },
      }, ...graph.entity_nodes.slice(1)],
      entity_edges: [{
        ...graph.entity_edges[0],
        relations: [
          ...graph.entity_edges[0].relations,
          { ...graph.entity_edges[0].relations[0], direction: "target_to_source" },
        ],
      }, ...graph.entity_edges.slice(1)],
    };

    const scene = buildScene({ ...input(0.8), graph: mixedGraph });
    expect(scene.entityDots.find((node) => node.id === "order-1")?.presentation?.primary)
      .toBe("ORDER-001");
    expect(scene.entityEdges.find((edge) => edge.id === "weak-edge")?.direction)
      .toBe("undirected");
  });

  it("separates parallel scene edges deterministically including opposite directions", () => {
    const parallelEdges = Array.from({ length: 40 }, (_, index) => {
      const reverse = index % 2 === 1;
      return {
        ...graph.entity_edges[0],
        id: `edge-${index.toString().padStart(2, "0")}`,
        source: reverse ? "user-1" : "order-1",
        target: reverse ? "order-1" : "user-1",
        relations: [{
          ...graph.entity_edges[0].relations[0],
          source: reverse ? "user-1" : "order-1",
          target: reverse ? "order-1" : "user-1",
          direction: reverse ? "target_to_source" as const : "source_to_target" as const,
        }],
      };
    });
    const parallelGraph: SemanticGraphData = {
      ...graph,
      table_edges: [],
      entity_edges: parallelEdges,
    };
    const parallelLayout: GraphLayout = {
      ...layout,
      tableEdges: [],
      entityEdges: parallelEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        from: edge.source === "order-1" ? { x: 20, y: 80 } : { x: 120, y: 80 },
        to: edge.target === "user-1" ? { x: 120, y: 80 } : { x: 20, y: 80 },
      })),
    };
    const geometries = (scene: ReturnType<typeof buildScene>) =>
      Object.fromEntries(scene.entityEdges.map((edge) => [edge.id, edge.geometry]));
    const first = geometries(buildScene({ ...input(1.2), graph: parallelGraph, layout: parallelLayout }));
    const reordered = geometries(buildScene({
      ...input(1.2),
      graph: { ...parallelGraph, entity_edges: [...parallelGraph.entity_edges].reverse() },
      layout: { ...parallelLayout, entityEdges: [...parallelLayout.entityEdges].reverse() },
    }));

    expect(new Set(Object.values(first).map(({ control }) => `${control.x}:${control.y}`)))
      .toHaveLength(parallelEdges.length);
    expect(reordered).toEqual(first);
  });

  it("counts visible degree from renderable visible entity edges only", () => {
    const degreeGraph: SemanticGraphData = {
      table_nodes: [{ id: "table", display_name: "Table", entity_count: 3 }],
      entity_nodes: [
        { id: "source", table_id: "table", display_name: "Source", class_name: null, dimensions: {} },
        { id: "target", table_id: "table", display_name: "Target", class_name: null, dimensions: {} },
        { id: "ghost", table_id: "table", display_name: "Ghost", class_name: null, dimensions: {} },
      ],
      table_edges: [],
      entity_edges: [
        { id: "rendered", source: "source", target: "target", relations: [{ ...graph.entity_edges[1].relations[0], source: "source", target: "target" }] },
        { id: "missing-layout", source: "source", target: "ghost", relations: [{ ...graph.entity_edges[1].relations[0], source: "source", target: "ghost" }] },
      ],
    };
    const degreeLayout: GraphLayout = {
      tableNodes: [{ id: "table", x: 0, y: 0 }],
      entityNodes: [
        { id: "source", tableId: "table", x: 0, y: 50 },
        { id: "target", tableId: "table", x: 100, y: 50 },
        { id: "ghost", tableId: "table", x: 200, y: 50 },
      ],
      tableEdges: [],
      entityEdges: [{ id: "rendered", source: "source", target: "target", from: { x: 0, y: 50 }, to: { x: 100, y: 50 } }],
    };

    const scene = buildScene({ ...input(0.4), graph: degreeGraph, layout: degreeLayout });
    expect(scene.entityDots.find((node) => node.id === "source")?.visibleDegree).toBe(1);
    expect(scene.entityDots.find((node) => node.id === "ghost")?.visibleDegree).toBe(0);
    expect(scene.entityLabels.map((label) => label.nodeId).sort()).toEqual(["source", "target"]);
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

  it("carries relation labels and solid-versus-dashed semantics on visible edge commands", () => {
    const scene = buildScene(input(1.2));

    expect(scene.entityEdges.find((edge) => edge.id === "weak-edge")).toMatchObject({
      label: "owns",
      lineStyle: "dashed",
    });
    expect(scene.entityEdges.find((edge) => edge.id === "strong-edge")).toMatchObject({
      label: "created",
      lineStyle: "solid",
    });
    expect(scene.tableEdges.find((edge) => edge.id === "orders-users")).toMatchObject({
      label: "owns",
      lineStyle: "dashed",
    });
    expect(scene.tableEdges.find((edge) => edge.id === "orders-audit")).toMatchObject({
      label: "created",
      lineStyle: "solid",
    });
    expect(scene.edgeLabels.map((label) => label.text)).toEqual(
      expect.arrayContaining(["owns", "created"]),
    );
  });

  it("keeps table relation labels at overview zoom with connected entity markers", () => {
    const scene = buildScene(input(0.5));

    expect(scene.entityDots).toHaveLength(4);
    expect(scene.entityLabels).toHaveLength(4);
    expect(scene.edgeLabels.length).toBeGreaterThan(0);
    expect(scene.edgeLabels.every((label) => label.kind === "table")).toBe(true);
    expect(scene.edgeLabels.map((label) => label.text)).toContain("created");
  });

  it("derives mixed table-edge labels and style only from relations visible at the threshold", () => {
    const mixedGraph: SemanticGraphData = {
      ...graph,
      table_edges: [{
        ...graph.table_edges[0],
        relation_types: ["created", "owns"],
        strong_count: 1,
        weak_count: 1,
        entity_edge_count: 2,
        supporting_entity_edges: ["weak-edge", "strong-edge"],
      }],
      entity_edges: graph.entity_edges.slice(0, 2),
    };
    const mixedLayout: GraphLayout = {
      ...layout,
      tableEdges: layout.tableEdges.slice(0, 1),
      entityEdges: layout.entityEdges.slice(0, 2),
    };

    const filtered = buildScene({
      graph: mixedGraph,
      layout: mixedLayout,
      transform: { k: 1.2, x: 0, y: 0 },
      confidenceThreshold: 0.9,
    });
    expect(filtered.tableEdges).toHaveLength(1);
    expect(filtered.tableEdges[0]).toMatchObject({
      label: "created",
      lineStyle: "solid",
    });

    const inclusive = buildScene({
      graph: mixedGraph,
      layout: mixedLayout,
      transform: { k: 1.2, x: 0, y: 0 },
      confidenceThreshold: 0.75,
    });
    expect(inclusive.tableEdges[0]).toMatchObject({
      label: "created · owns",
      lineStyle: "solid",
    });
  });

  it("uses a conservative generic label for unresolved mixed aggregate support", () => {
    const unresolvedGraph: SemanticGraphData = {
      table_nodes: [
        { id: "orders", display_name: "Orders", entity_count: 0 },
        { id: "users", display_name: "Users", entity_count: 0 },
      ],
      entity_nodes: [],
      table_edges: [{
        id: "mixed-unresolved",
        source_table: "orders",
        target_table: "users",
        relation_types: ["strong-type", "weak-type"],
        strong_count: 1,
        weak_count: 1,
        entity_edge_count: 2,
        average_confidence: 0.2,
        supporting_entity_edges: ["missing-strong", "missing-weak"],
      }],
      entity_edges: [],
    };
    const unresolvedLayout: GraphLayout = {
      tableNodes: [
        { id: "orders", x: 0, y: 0 },
        { id: "users", x: 100, y: 0 },
      ],
      entityNodes: [],
      tableEdges: [{
        id: "mixed-unresolved",
        source: "orders",
        target: "users",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      }],
      entityEdges: [],
    };

    const scene = buildScene({
      graph: unresolvedGraph,
      layout: unresolvedLayout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0.9,
    });

    expect(scene.tableEdges).toHaveLength(1);
    expect(scene.tableEdges[0]).toMatchObject({
      label: "mixed relationships",
      lineStyle: "solid",
    });
    expect(scene.tableEdges[0].label).not.toContain("weak-type");
  });

  it("caps indexed long-label text width to the scene collision width", () => {
    const longType = `relation-${"semantic-".repeat(100)}`;
    const longGraph: SemanticGraphData = {
      table_nodes: [
        { id: "left", display_name: "Left", entity_count: 0 },
        { id: "right", display_name: "Right", entity_count: 0 },
      ],
      entity_nodes: [],
      table_edges: [{
        id: "long-edge",
        source_table: "left",
        target_table: "right",
        relation_types: [longType],
        strong_count: 1,
        weak_count: 0,
        entity_edge_count: 0,
        average_confidence: 1,
        supporting_entity_edges: [],
      }],
      entity_edges: [],
    };
    const longLayout: GraphLayout = {
      tableNodes: [
        { id: "left", x: 0, y: 0 },
        { id: "right", x: 100, y: 0 },
      ],
      entityNodes: [],
      tableEdges: [{
        id: "long-edge",
        source: "left",
        target: "right",
        from: { x: 0, y: 0 },
        to: { x: 100, y: 0 },
      }],
      entityEdges: [],
    };

    const label = buildScene({
      graph: longGraph,
      layout: longLayout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    }).edgeLabels[0];

    expect(label.text).toBe(longType);
    expect(label.maxWidth).toBe(344);
  });

  it("bounds dense edge labels and keeps them deterministic under input reordering", () => {
    const edgeCount = 600;
    const tableNodes = Array.from({ length: edgeCount * 2 }, (_, index) => ({
      id: `table-${index.toString().padStart(4, "0")}`,
      display_name: `Table ${index}`,
      entity_count: 0,
    }));
    const tableEdges = Array.from({ length: edgeCount }, (_, index) => ({
      id: `edge-${index.toString().padStart(4, "0")}`,
      source_table: tableNodes[index * 2].id,
      target_table: tableNodes[index * 2 + 1].id,
      relation_types: [`type-${index}`],
      strong_count: 1,
      weak_count: 0,
      entity_edge_count: 0,
      average_confidence: 1,
      supporting_entity_edges: [],
    }));
    const layoutNodes = tableNodes.map((node, index) => ({
      id: node.id,
      x: (index % 40) * 120,
      y: Math.floor(index / 40) * 48,
    }));
    const positions = new Map(layoutNodes.map((node) => [node.id, node]));
    const layoutEdges = tableEdges.map((edge) => ({
      id: edge.id,
      source: edge.source_table,
      target: edge.target_table,
      from: positions.get(edge.source_table)!,
      to: positions.get(edge.target_table)!,
    }));
    const denseGraph: SemanticGraphData = {
      table_nodes: tableNodes,
      entity_nodes: [],
      table_edges: tableEdges,
      entity_edges: [],
    };
    const denseLayout: GraphLayout = {
      tableNodes: layoutNodes,
      entityNodes: [],
      tableEdges: layoutEdges,
      entityEdges: [],
    };

    const first = buildScene({
      graph: denseGraph,
      layout: denseLayout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    }).edgeLabels;
    const second = buildScene({
      graph: {
        ...denseGraph,
        table_nodes: [...denseGraph.table_nodes].reverse(),
        table_edges: [...denseGraph.table_edges].reverse(),
      },
      layout: {
        ...denseLayout,
        tableNodes: [...denseLayout.tableNodes].reverse(),
        tableEdges: [...denseLayout.tableEdges].reverse(),
      },
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    }).edgeLabels;

    expect(first.length).toBeLessThanOrEqual(200);
    expect(second).toEqual(first);
  });

  it("uses code-unit edge ID ordering for deterministic label priority", () => {
    const orderingGraph: SemanticGraphData = {
      table_nodes: [
        { id: "left-a", display_name: "Left A", entity_count: 0 },
        { id: "right-a", display_name: "Right A", entity_count: 0 },
        { id: "left-z", display_name: "Left Z", entity_count: 0 },
        { id: "right-z", display_name: "Right Z", entity_count: 0 },
      ],
      entity_nodes: [],
      table_edges: [
        { id: "a-edge", source_table: "left-a", target_table: "right-a", relation_types: ["a"], strong_count: 1, weak_count: 0, entity_edge_count: 0, average_confidence: 1, supporting_entity_edges: [] },
        { id: "Z-edge", source_table: "left-z", target_table: "right-z", relation_types: ["z"], strong_count: 1, weak_count: 0, entity_edge_count: 0, average_confidence: 1, supporting_entity_edges: [] },
      ],
      entity_edges: [],
    };
    const orderingLayout: GraphLayout = {
      tableNodes: [
        { id: "left-a", x: 0, y: 0 },
        { id: "right-a", x: 20, y: 0 },
        { id: "left-z", x: 0, y: 100 },
        { id: "right-z", x: 20, y: 100 },
      ],
      entityNodes: [],
      tableEdges: [
        { id: "a-edge", source: "left-a", target: "right-a", from: { x: 0, y: 0 }, to: { x: 20, y: 0 } },
        { id: "Z-edge", source: "left-z", target: "right-z", from: { x: 0, y: 100 }, to: { x: 20, y: 100 } },
      ],
      entityEdges: [],
    };

    expect(buildScene({
      graph: orderingGraph,
      layout: orderingLayout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    }).edgeLabels.map((label) => label.edgeId)).toEqual(["Z-edge", "a-edge"]);
  });

  it("uses stable table colors and scales connected entity nodes by graph degree", () => {
    const degreeGraph: SemanticGraphData = {
      ...graph,
      entity_edges: [
        ...graph.entity_edges,
        {
          id: "second-order-edge",
          source: "order-1",
          target: "user-2",
          relations: [{
            ...graph.entity_edges[1].relations[0],
            source: "order-1",
            target: "user-2",
            relation_type: "reviews",
          }],
        },
      ],
    };
    const degreeLayout: GraphLayout = {
      ...layout,
      entityEdges: [
        ...layout.entityEdges,
        {
          id: "second-order-edge",
          source: "order-1",
          target: "user-2",
          from: { x: 20, y: 80 },
          to: { x: 140, y: 80 },
        },
      ],
    };
    const scene = buildScene({ ...input(1.2), graph: degreeGraph, layout: degreeLayout });
    const orderOne = scene.entityDots.find((node) => node.id === "order-1")!;
    const orderTwo = scene.entityDots.find((node) => node.id === "order-2")!;
    const userOne = scene.entityDots.find((node) => node.id === "user-1")!;

    expect(orderOne.screenRadius).toBeGreaterThan(orderTwo.screenRadius);
    expect(orderOne.color).toBe(orderTwo.color);
    expect(orderOne.color).not.toBe(userOne.color);
    expect(scene.tableNodes.find((node) => node.id === "orders")?.color).toBe(orderOne.color);
  });

  it("assigns distinct stable palette colors to the four known manufacturing tables", () => {
    const tableNodes = [
      { id: "meprocess", display_name: "MEProcess", entity_count: 0 },
      { id: "MEOperation", display_name: "MEOperation", entity_count: 0 },
      { id: "mestep", display_name: "MEStep", entity_count: 0 },
      { id: "Assembly", display_name: "Assembly", entity_count: 0 },
    ];
    const knownGraph: SemanticGraphData = {
      table_nodes: tableNodes,
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    const knownLayout: GraphLayout = {
      tableNodes: tableNodes.map((node, index) => ({
        id: node.id,
        x: index * 100,
        y: 0,
      })),
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    };

    const colors = Object.fromEntries(
      buildScene({
        graph: knownGraph,
        layout: knownLayout,
        transform: { k: 1, x: 0, y: 0 },
        confidenceThreshold: 0,
      }).tableNodes.map((node) => [node.id, node.color]),
    );

    expect(colors).toEqual({
      meprocess: "#fbbf24",
      MEOperation: "#2dd4bf",
      mestep: "#38bdf8",
      Assembly: "#fb7185",
    });
    expect(new Set(Object.values(colors))).toHaveLength(4);
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

  it("skips label buckets whose finite coordinates exceed safe integer indexing", () => {
    const extremeGraph: SemanticGraphData = {
      table_nodes: [{ id: "table", display_name: "Table", entity_count: 2 }],
      entity_nodes: [
        { id: "source", table_id: "table", display_name: "Source", class_name: null, dimensions: {} },
        { id: "target", table_id: "table", display_name: "Target", class_name: null, dimensions: {} },
      ],
      table_edges: [],
      entity_edges: [{
        id: "extreme",
        source: "source",
        target: "target",
        relations: [{
          source: "source",
          target: "target",
          relation_type: "extreme",
          direction: "source_to_target",
          strength: "strong",
          confidence: 1,
          explanation: "",
          evidence: [],
          model_id: null,
          task_id: null,
        }],
      }],
    };
    const extremeLayout: GraphLayout = {
      tableNodes: [{ id: "table", x: 0, y: 0 }],
      entityNodes: [
        { id: "source", tableId: "table", x: 0, y: 0 },
        { id: "target", tableId: "table", x: 1, y: 1 },
      ],
      tableEdges: [],
      entityEdges: [{
        id: "extreme",
        source: "source",
        target: "target",
        from: { x: 0, y: 0 },
        to: { x: Number.MAX_VALUE, y: Number.MAX_VALUE },
      }],
    };

    const scene = buildScene({
      graph: extremeGraph,
      layout: extremeLayout,
      transform: { k: 1, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(scene.entityEdges).toHaveLength(1);
    expect(scene.edgeLabels).toHaveLength(0);
  });

  it("returns an empty finite scene for empty graph input and ignores NaN confidence", () => {
    const empty: SemanticGraphData = {
      table_nodes: [],
      entity_nodes: [],
      table_edges: [],
      entity_edges: [],
    };
    const emptyLayout: GraphLayout = {
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

});
