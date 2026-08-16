import { describe, expect, it } from "vitest";
import * as layoutModule from "./layout";
import type { SemanticGraphData } from "../api/analysis";
import { makeNebulaGraph } from "../test/nebulaFixtures";
import {
  compactLayoutGraph,
  computeFallbackScatterLayout,
  computeNebulaLayout,
  ENTITY_COLLISION_RADIUS,
  moveLayoutEntity,
  type GraphLayout,
  type LayoutGraph,
} from "./layout";
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
      {
        id: "order-user",
        source: "order-1",
        target: "user-1",
        relations: [{
          source: "order-1",
          target: "user-1",
          relation_type: "owns",
          direction: "source_to_target",
          strength: "strong",
          confidence: 1,
          explanation: "Orders belong to users.",
          evidence: [],
          model_id: null,
          task_id: null,
        }],
      },
      { id: "missing-entity", source: "order-1", target: "missing", relations: [] },
    ],
  };
}

function layoutGraphFixture(
  tableCount: number,
  entityCount: number,
  edges: LayoutGraph["entity_edges"] = [],
): LayoutGraph {
  return {
    table_nodes: Array.from({ length: tableCount }, (_, index) => ({
      id: `table-${index}`,
      display_name: `Table ${index}`,
    })),
    entity_nodes: Array.from({ length: entityCount }, (_, index) => ({
      id: `entity-${index}`,
      table_id: `table-${index % tableCount}`,
      class_name: null,
    })),
    table_edges: [],
    entity_edges: edges,
  };
}

function pointDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function circularityRatio(layout: GraphLayout, tableId: string): number {
  const table = layout.tableNodes.find((node) => node.id === tableId)!;
  const radii = layout.entityNodes
    .filter((node) => node.tableId === tableId)
    .map((node) => Math.round(pointDistance(node, table)));
  const counts = new Map<number, number>();
  for (const radius of radii) {
    counts.set(radius, (counts.get(radius) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values()) / radii.length;
}

function paddedBounds(
  nodes: readonly { x: number; y: number }[],
  padding: number,
) {
  return {
    left: Math.min(...nodes.map((node) => node.x)) - padding,
    right: Math.max(...nodes.map((node) => node.x)) + padding,
    top: Math.min(...nodes.map((node) => node.y)) - padding,
    bottom: Math.max(...nodes.map((node) => node.y)) + padding,
  };
}

describe("computeNebulaLayout", () => {
  it.each([20, 200] as const)(
    "builds the shared %i-node fixture with the required semantic topology",
    (entityCount) => {
      const graph = makeNebulaGraph({ entityCount });
      const strengths = graph.entity_edges.flatMap((edge) =>
        edge.relations.map((relation) => relation.strength)
      );
      const crossTableEdges = graph.entity_edges.filter((edge) => {
        const source = graph.entity_nodes.find((node) => node.id === edge.source);
        const target = graph.entity_nodes.find((node) => node.id === edge.target);
        return source?.table_id !== target?.table_id;
      });
      const zeroBacked = graph.entity_nodes.filter(
        (entity) => entity.display_name === "0",
      );

      expect(graph.table_nodes).toHaveLength(4);
      expect(new Set(strengths)).toEqual(new Set(["strong", "weak"]));
      expect(crossTableEdges.length).toBeGreaterThanOrEqual(2);
      expect(graph.entity_edges.some((edge) => edge.source === edge.target))
        .toBe(true);
      expect(zeroBacked).toHaveLength(entityCount / 10);
      expect(zeroBacked.every((entity) =>
        typeof entity.dimensions.name === "string" ||
        typeof entity.dimensions.item_code === "string"
      )).toBe(true);
    },
  );

  it.each([20, 200] as const)(
    "lays out the shared %i-node nebula deterministically without ring-like table groups",
    (entityCount) => {
      const graph = makeNebulaGraph({ entityCount });
      const compact = compactLayoutGraph(graph);
      const viewport = { width: 1_280, height: 720 };
      const first = computeNebulaLayout(compact, viewport);
      const second = computeNebulaLayout(compact, viewport);

      expect(second).toEqual(first);
      expect(first.entityNodes).toHaveLength(entityCount);
      for (const table of graph.table_nodes) {
        expect(circularityRatio(first, table.id)).toBeLessThanOrEqual(0.7);
      }
    },
    15_000,
  );

  it.each([20, 200] as const)(
    "does not lock process tables into equal business lanes",
    (entityCount) => {
      const layout = computeNebulaLayout(
        compactLayoutGraph(makeNebulaGraph({ entityCount })),
        { width: 1_280, height: 720 },
      );
      const xs = layout.tableNodes
        .map((node) => node.x)
        .sort((left, right) => left - right);
      const gaps = xs.slice(1).map((x, index) => x - xs[index]);

      expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(18);
    },
    15_000,
  );

  it("keeps strong links compact even when endpoints belong to different tables", () => {
    const graph = layoutGraphFixture(2, 4, [
      { id: "cross", source: "entity-0", target: "entity-3", weight: 1 },
    ]);
    const layout = computeNebulaLayout(graph, { width: 1_280, height: 720 });
    const nodes = new Map(layout.entityNodes.map((node) => [node.id, node]));
    const distance = pointDistance(nodes.get("entity-0")!, nodes.get("entity-3")!);

    expect(distance).toBeLessThan(220);
  });

  it("lets linked table groups settle closer than unrelated table groups", () => {
    const graph = layoutGraphFixture(4, 8, [
      { id: "link-a", source: "entity-0", target: "entity-3", weight: 1 },
      { id: "link-b", source: "entity-1", target: "entity-2", weight: 1 },
    ]);
    const layout = computeNebulaLayout(graph, { width: 1_280, height: 720 });
    const tables = new Map(layout.tableNodes.map((node) => [node.id, node]));
    const tableDistance = (leftTable: number, rightTable: number) =>
      pointDistance(
        tables.get(`table-${leftTable}`)!,
        tables.get(`table-${rightTable}`)!,
      );

    expect((tableDistance(0, 3) + tableDistance(1, 2)) / 2)
      .toBeLessThan((tableDistance(0, 1) + tableDistance(2, 3)) / 2);
  });

  it("keeps each entity cluster bounded around its owning table anchor", () => {
    const layout = computeNebulaLayout(
      compactLayoutGraph(makeNebulaGraph({ entityCount: 200 })),
      { width: 1_280, height: 720 },
    );
    const tables = new Map(layout.tableNodes.map((node) => [node.id, node]));
    const maxDistanceByTable = new Map<string, number>();

    for (const entity of layout.entityNodes) {
      const table = tables.get(entity.tableId)!;
      const distance = Math.hypot(entity.x - table.x, entity.y - table.y);
      maxDistanceByTable.set(
        entity.tableId,
        Math.max(maxDistanceByTable.get(entity.tableId) ?? 0, distance),
      );
    }

    expect(Math.max(...maxDistanceByTable.values())).toBeLessThan(1_800);
  });

  it("keeps table-only organic anchors stable when input order changes", () => {
    const baseTables: LayoutGraph["table_nodes"] = [
      { id: "zz-unknown", display_name: "ZZ Unknown" },
      { id: "me-process", display_name: "MEProcess" },
      { id: "aa-unknown", display_name: "AA Unknown" },
      { id: "me-operation", display_name: "MEOperation" },
    ];
    const first: LayoutGraph = {
      table_nodes: baseTables,
      entity_nodes: [],
      table_edges: [
        {
          id: "edge-0",
          source_table: "zz-unknown",
          target_table: "me-process",
        },
        {
          id: "edge-1",
          source_table: "zz-unknown",
          target_table: "me-operation",
        },
      ],
      entity_edges: [],
    };
    const second: LayoutGraph = { ...first, table_nodes: [...baseTables].reverse() };
    const viewport = { width: 1_000, height: 600 };
    const firstLayout = computeNebulaLayout(first, viewport);
    const secondLayout = computeNebulaLayout(second, viewport);

    expect(firstLayout).toEqual(secondLayout);
    expect(firstLayout.tableNodes.every(({ x, y }) =>
      Number.isFinite(x) && Number.isFinite(y)
    )).toBe(true);
  });

  it("centers deterministic organic anchors around the origin", () => {
    const seededOrganicAnchors = (layoutModule as typeof layoutModule & {
      seededOrganicAnchors?: (
        ids: readonly string[],
        seed: number,
        viewport: { width: number; height: number },
        minimumGap: number,
      ) => Map<string, { x: number; y: number }>;
    }).seededOrganicAnchors;

    expect(seededOrganicAnchors).toBeTypeOf("function");
    const anchors = seededOrganicAnchors!([
      "component-d",
      "component-a",
      "component-c",
      "component-b",
    ], 42, { width: 1_280, height: 720 }, 260);
    const points = [...anchors.values()];
    const centroid = points.reduce(
      (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
      { x: 0, y: 0 },
    );

    expect(centroid.x / points.length).toBeCloseTo(0, 12);
    expect(centroid.y / points.length).toBeCloseTo(0, 12);
  });

  it.each([20, 200] as const)(
    "keeps the two shared %i-node fixture components separated by whitespace",
    (entityCount) => {
      const graph = makeNebulaGraph({ entityCount });
      const layout = computeNebulaLayout(
        compactLayoutGraph(graph),
        { width: 1_280, height: 720 },
      );
      const first = paddedBounds(
        layout.entityNodes.filter((node) =>
          node.tableId === "table-0" || node.tableId === "table-1"
        ),
        20,
      );
      const second = paddedBounds(
        layout.entityNodes.filter((node) =>
          node.tableId === "table-2" || node.tableId === "table-3"
        ),
        20,
      );

      expect(
        first.right <= second.left ||
          second.right <= first.left ||
          first.bottom <= second.top ||
          second.bottom <= first.top,
      ).toBe(true);
    },
    15_000,
  );

  it.each([20, 200] as const)(
    "places strong shared-fixture relations closer than weak relations at %i nodes",
    (entityCount) => {
      const graph = makeNebulaGraph({ entityCount });
      const layout = computeNebulaLayout(
        compactLayoutGraph(graph),
        { width: 1_280, height: 720 },
      );
      const positions = new Map(
        layout.entityNodes.map((node) => [node.id, node]),
      );
      const distances = (strength: "strong" | "weak") =>
        graph.entity_edges
          .filter((edge) =>
            edge.source !== edge.target &&
            edge.relations.some((relation) => relation.strength === strength)
          )
          .map((edge) =>
            pointDistance(
              positions.get(edge.source)!,
              positions.get(edge.target)!,
            )
          );
      const average = (values: readonly number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length;

      expect(average(distances("strong")))
        .toBeLessThan(average(distances("weak")));
    },
    15_000,
  );

  it("returns finite deterministic coordinates and changes only for a new seed", () => {
    const graph = layoutGraphFixture(2, 20, [
      { id: "edge-0", source: "entity-0", target: "entity-2", weight: 1 },
      { id: "edge-1", source: "entity-1", target: "entity-3", weight: 0.35 },
    ]);
    const viewport = { width: 1280, height: 720 };
    const layout = computeNebulaLayout(graph, viewport);

    expect(
      layout.entityNodes.every(({ x, y }) =>
        Number.isFinite(x) && Number.isFinite(y)
      ),
    ).toBe(true);
    expect(computeNebulaLayout(graph, viewport)).toEqual(layout);
    expect(computeNebulaLayout(graph, viewport, { seedOffset: 1 }))
      .not.toEqual(layout);
  });

  it("pulls strongly connected pairs closer than unrelated pairs on average", () => {
    const strongEdges = Array.from({ length: 6 }, (_, index) => ({
      id: `strong-${index}`,
      source: `entity-${index * 2}`,
      target: `entity-${index * 2 + 1}`,
      weight: 1,
    }));
    const graph = layoutGraphFixture(1, 12, strongEdges);
    const layout = computeNebulaLayout(graph, { width: 1280, height: 720 });
    const positions = new Map(layout.entityNodes.map((node) => [node.id, node]));
    const average = (values: readonly number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const strongDistances = strongEdges.map((edge) =>
      pointDistance(positions.get(edge.source)!, positions.get(edge.target)!)
    );
    const unrelatedDistances = Array.from({ length: 6 }, (_, index) =>
      pointDistance(
        positions.get(`entity-${index * 2}`)!,
        positions.get(`entity-${(index * 2 + 5) % 12}`)!,
      )
    );

    expect(average(strongDistances)).toBeLessThan(
      average(unrelatedDistances),
    );
  });

  it("avoids placing a table group on a shared rounded radius", () => {
    const graph = layoutGraphFixture(1, 20);
    const layout = computeNebulaLayout(graph, { width: 1280, height: 720 });

    expect(circularityRatio(layout, "table-0")).toBeLessThanOrEqual(0.7);
  });

  it("keeps a representative 20-node fixture outside label collision range", () => {
    const graph = layoutGraphFixture(1, 20);
    const layout = computeNebulaLayout(graph, { width: 1280, height: 720 });
    let minimumDistance = Number.POSITIVE_INFINITY;
    for (let left = 0; left < layout.entityNodes.length; left += 1) {
      for (let right = left + 1; right < layout.entityNodes.length; right += 1) {
        minimumDistance = Math.min(
          minimumDistance,
          pointDistance(layout.entityNodes[left], layout.entityNodes[right]),
        );
      }
    }

    expect(minimumDistance).toBeGreaterThanOrEqual(
      ENTITY_COLLISION_RADIUS * 2 - 2,
    );
  });

  it("separates padded bounds for disconnected components", () => {
    const edges = [
      { id: "a-0", source: "entity-0", target: "entity-1", weight: 1 },
      { id: "a-1", source: "entity-1", target: "entity-2", weight: 1 },
      { id: "b-0", source: "entity-3", target: "entity-4", weight: 1 },
      { id: "b-1", source: "entity-4", target: "entity-5", weight: 1 },
    ];
    const layout = computeNebulaLayout(
      layoutGraphFixture(1, 6, edges),
      { width: 1280, height: 720 },
    );
    const byId = new Map(layout.entityNodes.map((node) => [node.id, node]));
    const first = paddedBounds(
      ["entity-0", "entity-1", "entity-2"].map((id) => byId.get(id)!),
      20,
    );
    const second = paddedBounds(
      ["entity-3", "entity-4", "entity-5"].map((id) => byId.get(id)!),
      20,
    );

    expect(
      first.right <= second.left ||
        second.right <= first.left ||
        first.bottom <= second.top ||
        second.bottom <= first.top,
    ).toBe(true);
  });

  it.each([
    ["nebula", computeNebulaLayout],
    ["fallback", computeFallbackScatterLayout],
  ])("separates more than 256 disconnected multi-node components in %s", (
    _label,
    computeLayout,
  ) => {
    const componentCount = 257;
    const graph = layoutGraphFixture(
      1,
      componentCount * 2,
      Array.from({ length: componentCount }, (_, index) => ({
        id: `component-edge-${index}`,
        source: `entity-${index * 2}`,
        target: `entity-${index * 2 + 1}`,
        weight: 1,
      })),
    );
    const layout = computeLayout(graph, { width: 4_000, height: 3_000 });
    const byId = new Map(layout.entityNodes.map((node) => [node.id, node]));
    const bounds = Array.from({ length: componentCount }, (_, index) =>
      paddedBounds(
        [
          byId.get(`entity-${index * 2}`)!,
          byId.get(`entity-${index * 2 + 1}`)!,
        ],
        20,
      )
    );
    let overlapCount = 0;
    for (let left = 0; left < bounds.length; left += 1) {
      for (let right = left + 1; right < bounds.length; right += 1) {
        const first = bounds[left];
        const second = bounds[right];
        const overlaps = first.right > second.left &&
          second.right > first.left &&
          first.bottom > second.top &&
          second.bottom > first.top;
        if (overlaps) overlapCount += 1;
      }
    }

    expect(overlapCount).toBe(0);
  }, 15_000);

  it("organically staggers pathological fallback components without repeated rows", () => {
    const componentCount = 257;
    const graph = layoutGraphFixture(
      1,
      componentCount * 2,
      Array.from({ length: componentCount }, (_, index) => ({
        id: `component-edge-${index}`,
        source: `entity-${index * 2}`,
        target: `entity-${index * 2 + 1}`,
        weight: 1,
      })),
    );
    const viewport = { width: 4_000, height: 3_000 };
    const first = computeFallbackScatterLayout(graph, viewport);
    const second = computeFallbackScatterLayout(graph, viewport);
    const alternate = computeFallbackScatterLayout(
      graph,
      viewport,
      { seedOffset: 1 },
    );
    const positions = new Map(
      first.entityNodes.map((node) => [node.id, node]),
    );
    const roundedTopCounts = new Map<number, number>();
    for (let index = 0; index < componentCount; index += 1) {
      const top = paddedBounds(
        [
          positions.get(`entity-${index * 2}`)!,
          positions.get(`entity-${index * 2 + 1}`)!,
        ],
        20,
      ).top;
      const roundedTop = Math.round(top * 1_000) / 1_000;
      roundedTopCounts.set(
        roundedTop,
        (roundedTopCounts.get(roundedTop) ?? 0) + 1,
      );
    }

    expect(Math.max(...roundedTopCounts.values())).toBeLessThanOrEqual(4);
    expect(second).toEqual(first);
    expect(alternate).not.toEqual(first);
  }, 15_000);

  it("is independent of input ordering after sorting each output collection", () => {
    const graph = layoutGraphFixture(2, 12, [
      { id: "edge-0", source: "entity-0", target: "entity-1", weight: 1 },
      { id: "edge-1", source: "entity-2", target: "entity-3", weight: 0.35 },
    ]);
    const permuted: LayoutGraph = {
      table_nodes: [...graph.table_nodes].reverse(),
      entity_nodes: [...graph.entity_nodes].reverse(),
      table_edges: [...graph.table_edges].reverse(),
      entity_edges: [...graph.entity_edges].reverse(),
    };
    const sortLayout = (layout: GraphLayout): GraphLayout => ({
      tableNodes: [...layout.tableNodes].sort((a, b) => a.id.localeCompare(b.id)),
      entityNodes: [...layout.entityNodes].sort((a, b) => a.id.localeCompare(b.id)),
      tableEdges: [...layout.tableEdges].sort((a, b) => a.id.localeCompare(b.id)),
      entityEdges: [...layout.entityEdges].sort((a, b) => a.id.localeCompare(b.id)),
    });

    expect(sortLayout(computeNebulaLayout(graph, { width: 800, height: 600 })))
      .toEqual(
        sortLayout(
          computeNebulaLayout(permuted, { width: 800, height: 600 }),
        ),
      );
  });

  it("provides a deterministic non-circular fallback scatter", () => {
    const graph = layoutGraphFixture(1, 20);
    const first = computeFallbackScatterLayout(
      graph,
      { width: 1280, height: 720 },
      { seedOffset: 4 },
    );

    expect(
      computeFallbackScatterLayout(
        graph,
        { width: 1280, height: 720 },
        { seedOffset: 4 },
      ),
    ).toEqual(first);
    expect(circularityRatio(first, "table-0")).toBeLessThanOrEqual(0.7);
  });

  it("moves one entity and only its incident edge endpoints without mutation", () => {
    const layout = computeNebulaLayout(
      layoutGraphFixture(1, 4, [
        { id: "edge-0", source: "entity-0", target: "entity-1", weight: 1 },
        { id: "edge-1", source: "entity-2", target: "entity-0", weight: 1 },
        { id: "edge-2", source: "entity-2", target: "entity-3", weight: 1 },
      ]),
      { width: 800, height: 600 },
    );
    const before = structuredClone(layout);
    const moved = moveLayoutEntity(layout, "entity-0", { x: 17, y: 29 });

    expect(layout).toEqual(before);
    expect(moved).not.toBe(layout);
    expect(moved.tableNodes).toEqual(layout.tableNodes);
    expect(moved.tableEdges).toEqual(layout.tableEdges);
    expect(moved.entityNodes.filter((node) => node.id !== "entity-0"))
      .toEqual(layout.entityNodes.filter((node) => node.id !== "entity-0"));
    expect(moved.entityNodes.find((node) => node.id === "entity-0"))
      .toMatchObject({ x: 17, y: 29 });
    expect(moved.entityEdges.find((edge) => edge.id === "edge-0")?.from)
      .toEqual({ x: 17, y: 29 });
    expect(moved.entityEdges.find((edge) => edge.id === "edge-1")?.to)
      .toEqual({ x: 17, y: 29 });
    expect(moved.entityEdges.find((edge) => edge.id === "edge-2"))
      .toEqual(layout.entityEdges.find((edge) => edge.id === "edge-2"));
  });

  it("returns finite output for empty, unknown-owned, and zero viewports", () => {
    const empty = layoutGraphFixture(0, 0);
    expect(computeNebulaLayout(empty, { width: 0, height: 0 })).toEqual({
      tableNodes: [],
      entityNodes: [],
      tableEdges: [],
      entityEdges: [],
    });
    const base = layoutGraphFixture(1, 2);
    const graph: LayoutGraph = {
      ...base,
      entity_nodes: [
        ...base.entity_nodes,
        { id: "orphan", table_id: "unknown", class_name: null },
      ],
    };
    const layout = computeNebulaLayout(graph, { width: 0, height: 0 });

    expect(layout.entityNodes.some((node) => node.id === "orphan")).toBe(false);
    expect(
      layout.entityNodes.every(({ x, y }) =>
        Number.isFinite(x) && Number.isFinite(y)
      ),
    ).toBe(true);
  });

  it("recenters a table-only layout in viewport coordinates", () => {
    const layout = computeNebulaLayout(
      layoutGraphFixture(3, 0),
      { width: 1_000, height: 600 },
    );
    const horizontalCenter = (
      Math.min(...layout.tableNodes.map((node) => node.x)) +
      Math.max(...layout.tableNodes.map((node) => node.x))
    ) / 2;
    const verticalCenter = (
      Math.min(...layout.tableNodes.map((node) => node.y)) +
      Math.max(...layout.tableNodes.map((node) => node.y))
    ) / 2;

    expect(horizontalCenter).toBeCloseTo(500);
    expect(verticalCenter).toBeCloseTo(300);
  });

  it.each([
    ["table node", "table_nodes"],
    ["entity node", "entity_nodes"],
    ["table edge", "table_edges"],
    ["entity edge", "entity_edges"],
  ] as const)("rejects duplicate %s IDs", (label, collection) => {
    const fixture = layoutGraphFixture(2, 2, [
      { id: "edge-0", source: "entity-0", target: "entity-1", weight: 1 },
    ]);
    const base: LayoutGraph = {
      ...fixture,
      table_edges: [{
        id: "table-edge-0",
        source_table: "table-0",
        target_table: "table-1",
      }],
    };
    const graph = {
      ...base,
      [collection]: [...base[collection], base[collection][0]],
    } as LayoutGraph;
    expect(() =>
      computeNebulaLayout(graph, { width: 800, height: 600 }),
    ).toThrow(new RegExp(`Duplicate ${label} id`));
  });
});

describe("compactLayoutGraph", () => {
  it("assigns strong and all-weak entity edge weights", () => {
    const graph = graphFixture();
    graph.entity_edges.push({
      id: "weak-only",
      source: "order-2",
      target: "user-2",
      relations: [{
        source: "order-2",
        target: "user-2",
        relation_type: "resembles",
        direction: "undirected",
        strength: "weak",
        confidence: 0.5,
        explanation: "Weak semantic similarity.",
        evidence: [],
        model_id: null,
        task_id: null,
      }],
    });

    expect(compactLayoutGraph(graph).entity_edges).toEqual([
      { id: "order-user", source: "order-1", target: "user-1", weight: 1 },
      { id: "missing-entity", source: "order-1", target: "missing", weight: 0.35 },
      { id: "weak-only", source: "order-2", target: "user-2", weight: 0.35 },
    ]);
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
  it("forwards an explicit relayout seed to the Worker", async () => {
    const worker = new FakeWorker();
    const client = new LayoutClient(worker as unknown as Worker);
    const pending = client.layoutGraph(
      graphFixture(),
      { width: 800, height: 600 },
      3,
    );
    const request = worker.messages[0] as {
      requestId: number;
      graph: LayoutGraph;
      seedOffset?: number;
    };

    expect(request).toMatchObject({
      graph: expect.any(Object),
      seedOffset: 3,
    });
    const layout = computeNebulaLayout(
      request.graph,
      { width: 800, height: 600 },
      { seedOffset: request.seedOffset },
    );
    worker.reply({ requestId: request.requestId, layout });
    await expect(pending).resolves.toBe(layout);
  });

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
    const layout = computeNebulaLayout(
      compactLayoutGraph(graphFixture()),
      { width: 800, height: 600 },
    );
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

    const firstLayout = computeNebulaLayout(
      compactLayoutGraph(graph),
      { width: 800, height: 600 },
    );
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
    const thirdLayout = computeNebulaLayout(
      compactLayoutGraph(graph),
      thirdRequest.viewport,
    );
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
        { id: "order-user", source: "order-1", target: "user-1", weight: 1 },
        { id: "missing-entity", source: "order-1", target: "missing", weight: 0.35 },
      ],
    });
    expect(posted).not.toContain("dimension-value");
    expect(posted).not.toContain("evidence-value");
    expect(posted).not.toContain("explanation-value");
    expect(posted).not.toContain("support-");

    const layout = computeNebulaLayout(
      request.graph as unknown as LayoutGraph,
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
      layout: computeNebulaLayout(
        compactLayoutGraph(graph),
        { width: 800, height: 600 },
      ),
    });

    const current = client.layoutGraph(graph, { width: 800, height: 600 });
    const currentRequest = worker.messages[1] as { requestId: number };
    expect(currentRequest.requestId).toBeGreaterThan(staleRequest.requestId);
    const currentLayout = computeNebulaLayout(
      compactLayoutGraph(graph),
      { width: 800, height: 600 },
    );
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
