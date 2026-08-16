import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import GraphToolbar from "../GraphToolbar";
import { useAnalysisStore } from "../../store/analysis";

const graph = {
  table_nodes: [
    { id: "users", display_name: "Users", entity_count: 1 },
    { id: "orders", display_name: "Orders", entity_count: 1 },
  ],
  entity_nodes: [
    { id: "users|1", table_id: "users", display_name: "User", class_name: "User", dimensions: {} },
    { id: "orders|1", table_id: "orders", display_name: "Order", class_name: "Order", dimensions: {} },
    { id: "payments|1", table_id: "orders", display_name: "Payment", class_name: "Payment", dimensions: {} },
    { id: "users|2", table_id: "users", display_name: "Isolated user", class_name: "User", dimensions: {} },
  ],
  table_edges: [{ id: "users--orders", source_table: "users", target_table: "orders", relation_types: ["owns"], strong_count: 1, weak_count: 0, entity_edge_count: 2, average_confidence: 0.9, supporting_entity_edges: ["users|1--orders|1"] }],
  entity_edges: [
    { id: "users|1--orders|1", source: "users|1", target: "orders|1", relations: [{ source: "users|1", target: "orders|1", relation_type: "owns", direction: "source_to_target" as const, strength: "strong" as const, confidence: 0.9, explanation: "", evidence: [], model_id: null, task_id: null }] },
    { id: "orders|1--payments|1", source: "orders|1", target: "payments|1", relations: [{ source: "orders|1", target: "payments|1", relation_type: "pays", direction: "source_to_target" as const, strength: "weak" as const, confidence: 0.78, explanation: "", evidence: [], model_id: null, task_id: null }] },
    { id: "users|1--payments|1", source: "users|1", target: "payments|1", relations: [{ source: "users|1", target: "payments|1", relation_type: "uses", direction: "source_to_target" as const, strength: "weak" as const, confidence: 0.42, explanation: "", evidence: [], model_id: null, task_id: null }] },
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
      analysisStatus: "complete",
    });
  });

  it.each([
    ["complete", "分析完成"],
    ["partial", "部分结果 · 分析未完成"],
    ["failed", "分析失败 · 可用结果"],
  ] as const)("shows the %s analysis subtitle without contradictory completion text", (analysisStatus, subtitle) => {
    act(() => useAnalysisStore.setState({ analysisStatus }));
    render(<GraphToolbar />);

    expect(screen.getByText(subtitle)).toBeInTheDocument();
    if (analysisStatus !== "complete") {
      expect(screen.queryByText("分析完成")).not.toBeInTheDocument();
    }
  });

  it("shows total and threshold-filtered relationship counts without removing node totals", () => {
    // This fails if filtering relationship visibility changes the node count or ignores confidence.
    render(<GraphToolbar />);

    expect(screen.getByRole("heading", { name: "关系宇宙总览" })).toBeInTheDocument();
    expect(screen.getByText("4 个对象")).toBeInTheDocument();
    expect(screen.getByText("3 条业务关系")).toBeInTheDocument();
    expect(screen.getByText("2 条当前可见")).toBeInTheDocument();
    expect(screen.queryByText(/实体边|表边|表关系|实体关系/)).not.toBeInTheDocument();
  });

  it("lets users include the one isolated entity that is hidden by default", () => {
    render(<GraphToolbar />);

    const isolatedNodes = screen.getByRole("checkbox", { name: "显示无关联对象（隐藏 1 个）" });
    expect(isolatedNodes).not.toBeChecked();

    fireEvent.click(isolatedNodes);
    expect(useAnalysisStore.getState().showIsolatedNodes).toBe(true);
    expect(
      screen.getByRole("checkbox", { name: "显示无关联对象（隐藏 0 个）" }),
    ).toBeChecked();
  });

  it("exposes graph actions and sends fit and relayout commands", () => {
    // This fails if either workbench control no longer reaches its store command.
    render(<GraphToolbar />);

    fireEvent.click(screen.getByRole("button", { name: "适应视图" }));
    fireEvent.click(screen.getByRole("button", { name: "整理全网布局" }));

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
      within(toolbar).getByLabelText("关系可靠程度"),
      within(toolbar).getByRole("button", { name: "适应视图" }),
      within(toolbar).getByRole("button", { name: "整理全网布局" }),
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
