import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
        name: "Alice",
        email: "alice@example.com",
        status: null,
      },
      degree: 3,
    },
    {
      id: "orders|1",
      source_table: "orders",
      class_name: "com.example.Order",
      field_values: { id: 101, user_id: 1, total: 99.9 },
      degree: 1,
    },
    {
      id: "products|1",
      source_table: "products",
      class_name: null,
      field_values: { id: 1001, name: "Widget" },
      degree: 1,
    },
  ],
  edges: [
    {
      source: "users|1",
      target: "orders|1",
      labels: ["外键关联"],
      confidence: 1,
    },
    {
      source: "orders|1",
      target: "products|1",
      labels: ["值相等(product_id)"],
      confidence: 0.9,
    },
  ],
};

describe("NodeDetailPanel", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      graph: mockGraph,
      detailPanelNodeId: null,
    });
  });

  it("renders nothing when no node is selected", () => {
    const { container } = render(<NodeDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when graph is null", () => {
    useAnalysisStore.setState({ graph: null, detailPanelNodeId: "users|1" });
    const { container } = render(<NodeDetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("shows node details when detailPanelNodeId is set", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    render(<NodeDetailPanel />);

    expect(screen.getByText("节点详情")).toBeInTheDocument();
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("com.example.User")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("displays field values in a table", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    render(<NodeDetailPanel />);

    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("NULL")).toBeInTheDocument();
  });

  it("shows related nodes list", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    render(<NodeDetailPanel />);

    expect(screen.getByText("关联节点")).toBeInTheDocument();
    expect(screen.getByText("orders|1")).toBeInTheDocument();
  });

  it("shows 'no related nodes' when node has no edges", () => {
    // products|1 is connected to orders|1 in the mock data.
    // Use a truly isolated node: add one with degree 0 and no edges.
    const isolatedGraph: GraphData = {
      ...mockGraph,
      nodes: [
        ...mockGraph.nodes,
        {
          id: "isolated|1",
          source_table: "isolated",
          class_name: null,
          field_values: {},
          degree: 0,
        },
      ],
    };
    useAnalysisStore.setState({
      graph: isolatedGraph,
      detailPanelNodeId: "isolated|1",
    });

    render(<NodeDetailPanel />);

    expect(screen.getByText("无关联节点")).toBeInTheDocument();
  });

  it("closes panel when close button is clicked", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    render(<NodeDetailPanel />);

    const closeBtn = screen.getByLabelText("关闭面板");
    fireEvent.click(closeBtn);

    expect(useAnalysisStore.getState().detailPanelNodeId).toBeNull();
  });

  it("closes panel when overlay is clicked", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    const { container } = render(<NodeDetailPanel />);

    const overlay = container.querySelector(".fixed.inset-0");
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);

    expect(useAnalysisStore.getState().detailPanelNodeId).toBeNull();
  });

  it("navigates to related node when clicked", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    render(<NodeDetailPanel />);

    // Click on the related node button (orders|1)
    const relatedBtn = screen.getByText("orders|1");
    fireEvent.click(relatedBtn);

    expect(useAnalysisStore.getState().detailPanelNodeId).toBe("orders|1");
  });

  it("displays node with null class_name as '—'", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "products|1" });

    render(<NodeDetailPanel />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows degree count", () => {
    useAnalysisStore.setState({ detailPanelNodeId: "users|1" });

    render(<NodeDetailPanel />);

    expect(screen.getByText("关联度数")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
