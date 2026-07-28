import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import GraphToolbar from "../GraphToolbar";
import { useAnalysisStore } from "../../store/analysis";

const graph = {
  nodes: [
    {
      id: "users|1",
      source_table: "users",
      class_name: "com.example.User",
      field_values: { id: 1 },
      degree: 2,
    },
    {
      id: "orders|1",
      source_table: "orders",
      class_name: "com.example.Order",
      field_values: { id: 1 },
      degree: 2,
    },
    {
      id: "payments|1",
      source_table: "payments",
      class_name: "com.example.Payment",
      field_values: { id: 1 },
      degree: 2,
    },
  ],
  edges: [
    { source: "users|1", target: "orders|1", labels: ["owns"], confidence: 0.9 },
    { source: "orders|1", target: "payments|1", labels: ["pays"], confidence: 0.78 },
    { source: "users|1", target: "payments|1", labels: ["uses"], confidence: 0.42 },
  ],
};

describe("GraphToolbar", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      graph,
      taskId: null,
      confidenceThreshold: 0.75,
      fitViewRequest: 0,
      relayoutRequest: 0,
      phase: "done",
    });
  });

  it("shows total and threshold-filtered relationship counts without removing node totals", () => {
    // This fails if filtering relationship visibility changes the node count or ignores confidence.
    render(<GraphToolbar />);

    expect(screen.getByText("3 个节点")).toBeInTheDocument();
    expect(screen.getByText("3 条关系")).toBeInTheDocument();
    expect(screen.getByText("2 条可见关系")).toBeInTheDocument();
  });

  it("exposes graph actions and sends fit and relayout commands", () => {
    // This fails if either workbench control no longer reaches its store command.
    render(<GraphToolbar />);

    fireEvent.click(screen.getByRole("button", { name: "适应画布" }));
    fireEvent.click(screen.getByRole("button", { name: "重新布局" }));

    expect(useAnalysisStore.getState().fitViewRequest).toBe(1);
    expect(useAnalysisStore.getState().relayoutRequest).toBe(1);
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新分析" })).toBeInTheDocument();
  });

  it("keeps every graph action in the narrow-screen scrollable toolbar", () => {
    // This fails if responsive hiding removes any action from the reachable toolbar.
    render(<GraphToolbar />);

    const toolbar = screen.getByRole("toolbar", { name: "图谱操作" });
    const actions = [
      within(toolbar).getByLabelText("置信度阈值"),
      within(toolbar).getByRole("button", { name: "适应画布" }),
      within(toolbar).getByRole("button", { name: "重新布局" }),
      within(toolbar).getByRole("button", { name: "导出 JSON" }),
      within(toolbar).getByRole("button", { name: "新分析" }),
    ];

    expect(toolbar).toHaveClass("overflow-x-auto");
    actions.forEach((action) => {
      expect(action.closest('[class~="hidden"]')).toBeNull();
    });
  });

  it("returns to table selection when starting a new analysis", () => {
    // This fails if the new-analysis control leaves the result workbench active.
    render(<GraphToolbar />);

    fireEvent.click(screen.getByRole("button", { name: "新分析" }));

    expect(useAnalysisStore.getState().phase).toBe("select");
  });
});
