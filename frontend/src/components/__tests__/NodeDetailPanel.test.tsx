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
    { id: "users|1", table_id: "users", display_name: "Alice", class_name: "  com.example.User  ", dimensions: { id: 1, name: "Alice", metadata: { active: true } } },
    { id: "orders|101", table_id: "orders", display_name: "Order 101", class_name: null, dimensions: { id: 101, user_id: 1 } },
  ],
  table_edges: [{ id: "users--orders", source_table: "users", target_table: "orders", relation_types: ["places"], strong_count: 1, weak_count: 1, entity_edge_count: 2, average_confidence: 0.85, supporting_entity_edges: ["users|1--orders|101", "missing-support"] }],
  entity_edges: [{ id: "users|1--orders|101", source: "users|1", target: "orders|101", relations: [
    { source: "users|1", target: "orders|101", relation_type: "places", display_label: "下单", direction: "source_to_target", strength: "strong", confidence: 0.9, explanation: "orders declares a foreign key to users", evidence: [{ source_field: "id", source_value: 1, target_field: "user_id", target_value: 1, method: "foreign_key", reason: "orders.user_id references users.id" }], model_id: "model-42", task_id: "task-7" },
    { source: "users|1", target: "orders|101", relation_type: "owns", display_label: "归属", direction: "target_to_source", strength: "weak", confidence: 0.7, explanation: "Semantic fallback.", evidence: [], model_id: null, task_id: null },
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

  it("keeps technical metadata and complete dimensions behind separate disclosures", () => {
    useAnalysisStore.setState({ selectedNodeId: "users|1" });
    render(<NodeDetailPanel />);

    expect(screen.getByRole("heading", { name: "Alice" })).toBeInTheDocument();
    expect(screen.queryByText("com.example.User")).not.toBeInTheDocument();
    expect(screen.queryByText(/"active": true/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("技术依据"));
    expect(screen.getByText("com.example.User")).toBeInTheDocument();
    expect(screen.queryByText(/"active": true/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("查看原始数据"));
    expect(screen.getByText(/"active": true/)).toBeInTheDocument();
  });

  it("shows business relationship details before disclosure and technical facts only after it", () => {
    useAnalysisStore.setState({ selectedEntityEdgeId: "users|1--orders|101" });
    render(<NodeDetailPanel />);

    expect(screen.getByText("Alice → Order 101")).toBeInTheDocument();
    expect(screen.getByText("全部关系 (2)")).toBeInTheDocument();
    expect(screen.getByText("下单")).toBeInTheDocument();
    expect(screen.getByText("明确")).toBeInTheDocument();
    expect(screen.getByText("归属")).toBeInTheDocument();
    expect(screen.getByText("较可信")).toBeInTheDocument();
    expect(screen.getByText("两个业务对象通过已确认的数据引用建立关系。")).toBeInTheDocument();
    expect(screen.getByText("已确认存在稳定的数据引用。")).toBeInTheDocument();
    expect(screen.queryByText("orders declares a foreign key to users")).not.toBeInTheDocument();
    expect(screen.queryByText("orders.user_id references users.id")).not.toBeInTheDocument();
    expect(screen.queryByText("id = 1")).not.toBeInTheDocument();
    expect(screen.queryByText("user_id = 1")).not.toBeInTheDocument();
    expect(screen.queryByText("places")).not.toBeInTheDocument();
    expect(screen.queryByText("foreign_key")).not.toBeInTheDocument();
    expect(screen.queryByText("90%")).not.toBeInTheDocument();
    expect(screen.queryByText("com.example.User")).not.toBeInTheDocument();
    expect(screen.queryByText("model-42")).not.toBeInTheDocument();
    expect(screen.queryByText("task-7")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("技术依据")[0]);
    expect(screen.getByText("places")).toBeInTheDocument();
    expect(screen.getByText("foreign_key")).toBeInTheDocument();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("com.example.User")).toBeInTheDocument();
    expect(screen.getByText("orders declares a foreign key to users")).toBeInTheDocument();
    expect(screen.getByText("orders.user_id references users.id")).toBeInTheDocument();
    expect(screen.getByText("id = 1")).toBeInTheDocument();
    expect(screen.getByText("user_id = 1")).toBeInTheDocument();
    expect(screen.getByText("model-42")).toBeInTheDocument();
    expect(screen.getByText("task-7")).toBeInTheDocument();

    expect(screen.queryByText(/"active": true/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("查看原始数据"));
    expect(screen.getByText(/"active": true/)).toBeInTheDocument();
  });

  it("uses shared business presentations for connected-object buttons", () => {
    useAnalysisStore.setState({ selectedNodeId: "users|1" });
    render(<NodeDetailPanel />);

    const connected = screen.getByRole("button", { name: /Order 101.*下单.*归属/ });
    expect(connected).not.toHaveTextContent("orders|101");
    fireEvent.click(connected);
    expect(useAnalysisStore.getState().focusNodeRequest?.nodeId).toBe("orders|101");
  });

  it("shows table aggregate data and focuses a supporting entity edge", () => {
    useAnalysisStore.setState({ selectedTableEdgeId: "users--orders" });
    render(<NodeDetailPanel />);
    expect(screen.getByText("表关系汇总")).toBeInTheDocument();
    expect(screen.getAllByText("下单 · 归属").length).toBeGreaterThan(0);
    expect(screen.getByText("明确")).toBeInTheDocument();
    expect(screen.getByText("可能有关")).toBeInTheDocument();
    expect(screen.queryByText("候选关系")).not.toBeInTheDocument();
    expect(screen.queryByText("places")).not.toBeInTheDocument();
    expect(screen.queryByText("85%")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Alice → Order 101.*下单.*归属/ }));
    expect(useAnalysisStore.getState().selectedEntityEdgeId).toBe("users|1--orders|101");
    expect(useAnalysisStore.getState().focusNodeRequest?.nodeId).toBe("users|1");
  });

  it("keeps the table aggregate selected when a referenced supporting edge is unavailable", () => {
    useAnalysisStore.setState({ selectedTableEdgeId: "users--orders" });
    render(<NodeDetailPanel />);

    const unavailable = screen.getByRole("button", {
      name: "支撑关系不可用",
    });
    expect(unavailable).toBeDisabled();

    fireEvent.click(unavailable);

    expect(screen.getByText("表关系汇总")).toBeInTheDocument();
    expect(useAnalysisStore.getState().selectedTableEdgeId).toBe("users--orders");
    expect(useAnalysisStore.getState().selectedEntityEdgeId).toBeNull();
  });
});
