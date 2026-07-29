import { describe, expect, it } from "vitest";
import { projectGraph } from "./projection";

const graph = {
  table_nodes: [
    { id: "users", display_name: "Users", entity_count: 2 },
    { id: "orders", display_name: "Orders", entity_count: 1 },
  ],
  entity_nodes: [
    { id: "users:1", table_id: "users", display_name: "Ada", class_name: "User", dimensions: {} },
    { id: "orders:1", table_id: "orders", display_name: "Order 1", class_name: "Order", dimensions: {} },
    { id: "users:2", table_id: "users", display_name: "Grace", class_name: "User", dimensions: {} },
  ],
  table_edges: [
    { id: "users--orders", source_table: "users", target_table: "orders", relation_types: ["owns"], strong_count: 1, weak_count: 0, entity_edge_count: 1, average_confidence: 1, supporting_entity_edges: ["users:1--orders:1"] },
  ],
  entity_edges: [
    { id: "users:1--orders:1", source: "users:1", target: "orders:1", relations: [] },
  ],
};

describe("projectGraph", () => {
  it("keeps table data and connected entity endpoints while hiding isolated entities by default", () => {
    const projected = projectGraph(graph, false);

    expect(projected.table_nodes).toEqual(graph.table_nodes);
    expect(projected.table_edges).toEqual(graph.table_edges);
    expect(projected.entity_nodes.map((node) => node.id)).toEqual(["users:1", "orders:1"]);
    expect(projected.entity_edges).toEqual(graph.entity_edges);
    expect(graph.entity_nodes).toHaveLength(3);
    expect(graph.entity_nodes.length - projected.entity_nodes.length).toBe(1);
  });

  it("returns every API entity when isolated entities are enabled", () => {
    const projected = projectGraph(graph, true);

    expect(projected).toEqual(graph);
  });
});
