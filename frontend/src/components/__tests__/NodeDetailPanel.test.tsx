import { describe, it, expect, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import NodeDetailPanel from "../NodeDetailPanel";
import { useAnalysisStore } from "../../store/analysis";
import type { GraphData } from "../../api/analysis";

const mockGraph: GraphData = {
  nodes: [
    {
      id: "users|1",
      source_table: "users",
      class_name: "com.example.User",
      field_values: {
        id: 1,
        name: "Alice\nSmith",
        status: null,
        metadata: { active: true, roles: ["admin"] },
      },
      degree: 3,
    },
    {
      id: "orders|1",
      source_table: "orders",
      class_name: "com.example.Order",
      field_values: { id: 101, user_id: 1 },
      degree: 1,
    },
  ],
  edges: [
    {
      source: "users|1",
      target: "orders|1",
      labels: ["外键关联", "用户订单"],
      confidence: 0.9,
    },
  ],
};

describe("NodeDetailPanel", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      graph: mockGraph,
      selectedNodeId: null,
    });
  });

  it("keeps a desktop inspector visible with graph overview when no node is selected", () => {
    render(<NodeDetailPanel />);

    expect(screen.getByText("图谱概览")).toBeInTheDocument();
    expect(screen.getByText("选择一个节点查看详情")).toBeInTheDocument();
    expect(screen.getByText("2 个节点 · 1 条关系")).toBeInTheDocument();
  });

  it("renders the selected node's complete details and direct relationship metadata", () => {
    useAnalysisStore.setState({ selectedNodeId: "users|1" });

    render(<NodeDetailPanel />);

    expect(screen.getByText("节点概览")).toBeInTheDocument();
    expect(screen.getByText("完整 ID")).toBeInTheDocument();
    expect(screen.getByText("users|1")).toBeInTheDocument();
    expect(screen.getByText("来源表")).toBeInTheDocument();
    expect(screen.getByText("关联度")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText(/"active": true/)).toBeInTheDocument();
    expect(screen.getByText("直接关系")).toBeInTheDocument();
    expect(screen.getByText("orders|1")).toBeInTheDocument();
    expect(screen.getByText("外键关联 · 用户订单")).toBeInTheDocument();
    expect(screen.getByText("置信度 90%")).toBeInTheDocument();
  });

  it("selects a directly related node when its relationship item is clicked", () => {
    useAnalysisStore.setState({ selectedNodeId: "users|1" });

    render(<NodeDetailPanel />);
    fireEvent.click(screen.getByRole("button", { name: /orders\|1/ }));

    expect(useAnalysisStore.getState().selectedNodeId).toBe("orders|1");
  });

  it("uses the selected-node state for the mobile close action", () => {
    useAnalysisStore.setState({ selectedNodeId: "users|1" });

    render(<NodeDetailPanel />);
    fireEvent.click(screen.getByLabelText("关闭节点详情"));

    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();
  });
});
