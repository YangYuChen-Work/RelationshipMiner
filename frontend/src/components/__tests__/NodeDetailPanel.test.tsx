import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SemanticGraphData } from "../../api/analysis";
import NodeDetailPanel from "../NodeDetailPanel";
import { useAnalysisStore } from "../../store/analysis";

const graph: SemanticGraphData = {
  table_nodes: [
    { id: "users", display_name: "Users", entity_count: 1 },
    { id: "orders", display_name: "Orders", entity_count: 1 },
  ],
  entity_nodes: [
    { id: "users|1", table_id: "users", display_name: "Alice", class_name: "com.example.User", dimensions: { id: 1, name: "Alice", metadata: { active: true } } },
    { id: "orders|101", table_id: "orders", display_name: "Order 101", class_name: null, dimensions: { id: 101, user_id: 1 } },
  ],
  table_edges: [{ id: "users--orders", source_table: "users", target_table: "orders", relation_types: ["places"], strong_count: 1, weak_count: 1, entity_edge_count: 1, average_confidence: 0.85, supporting_entity_edges: ["users|1--orders|101"] }],
  entity_edges: [{ id: "users|1--orders|101", source: "users|1", target: "orders|101", relations: [
    { source: "users|1", target: "orders|101", relation_type: "places", direction: "source_to_target", strength: "strong", confidence: 0.9, explanation: "The order belongs to the user.", evidence: [{ source_field: "id", source_value: 1, target_field: "user_id", target_value: 1, method: "foreign_key", reason: "orders.user_id references users.id" }], model_id: "model-42", task_id: "task-7" },
    { source: "users|1", target: "orders|101", relation_type: "owns", direction: "target_to_source", strength: "weak", confidence: 0.7, explanation: "Semantic fallback.", evidence: [], model_id: null, task_id: null },
  ] }],
};

describe("NodeDetailPanel", () => {
  beforeEach(() => {
    useAnalysisStore.setState({ graph, selectedNodeId: null, selectedEntityEdgeId: null, selectedTableEdgeId: null, focusNodeRequest: null });
  });

  it("keeps a semantic graph overview when no item is selected", () => {
    render(<NodeDetailPanel />);
    expect(screen.getByText("2 张表 · 2 个实体 · 1 条表关系 · 1 条实体关系")).toBeInTheDocument();
  });

  it("renders table and short class metadata only when a class exists", () => {
    useAnalysisStore.setState({ selectedNodeId: "users|1" });
    render(<NodeDetailPanel />);
    expect(screen.getByText("users · User")).toBeInTheDocument();
    expect(screen.getByText(/"active": true/)).toBeInTheDocument();
  });

  it("renders every relation and its evidence for a selected entity edge", () => {
    useAnalysisStore.setState({ selectedEntityEdgeId: "users|1--orders|101" });
    render(<NodeDetailPanel />);
    expect(screen.getByText("全部关系 (2)")).toBeInTheDocument();
    expect(screen.getByText("places")).toBeInTheDocument();
    expect(screen.getByText("源 → 目标")).toBeInTheDocument();
    expect(screen.getByText("strong")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("The order belongs to the user.")).toBeInTheDocument();
    expect(screen.getByText("id = 1")).toBeInTheDocument();
    expect(screen.getByText("user_id = 1")).toBeInTheDocument();
    expect(screen.getByText("model-42")).toBeInTheDocument();
    expect(screen.getByText("task-7")).toBeInTheDocument();
    expect(screen.getByText("owns")).toBeInTheDocument();
  });

  it("shows table aggregate data and focuses a supporting entity edge", () => {
    useAnalysisStore.setState({ selectedTableEdgeId: "users--orders" });
    render(<NodeDetailPanel />);
    expect(screen.getByText("表关系汇总")).toBeInTheDocument();
    expect(screen.getByText("places")).toBeInTheDocument();
    expect(screen.getByText("85%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "users|1--orders|101" }));
    expect(useAnalysisStore.getState().selectedEntityEdgeId).toBe("users|1--orders|101");
    expect(useAnalysisStore.getState().focusNodeRequest?.nodeId).toBe("users|1");
  });
});
