import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressIndicator from "../ProgressIndicator";
import { useAnalysisStore } from "../../store/analysis";

describe("ProgressIndicator", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      phase: "analyzing",
      currentPhase: "semantic_judging",
      progressMessage: "Judging candidates",
      progressValue: 0.76,
      selectedTables: new Map(),
      diagnostics: null,
    });
  });

  it("shows the current stage, completed stages, and live diagnostic counts", () => {
    useAnalysisStore.setState({
      currentPhase: "candidates",
      progressValue: 0.52,
      progressMessage: "候选对象已整理",
      selectedTables: new Map([
        [
          "users",
          {
            name: "users",
            columns: [],
            selectedFields: new Set(),
          },
        ],
        [
          "orders",
          {
            name: "orders",
            columns: [],
            selectedFields: new Set(),
          },
        ],
      ]),
      diagnostics: {
        entities_read: 128,
        plans_created: 24,
        candidates_retrieved: 76,
        candidates_completed: 18,
        candidates_pending: 58,
        strong_edges_created: 6,
        weak_edges_created: 11,
      },
    });

    const { container } = render(<ProgressIndicator />);

    expect(container.querySelector(".analysis-progress-shell")).toBeInTheDocument();
    expect(container.querySelector(".analysis-progress-header")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "分析阶段" })).toBeInTheDocument();
    expect(container.querySelector(".analysis-progress-stages")).toBeInTheDocument();
    expect(container.querySelector(".analysis-progress-metrics")).toBeInTheDocument();
    expect(container.querySelector(".analysis-progress-details")).toBeInTheDocument();
    expect(screen.getByText("寻找候选对象").closest("li")).toHaveAttribute(
      "data-stage-state",
      "current",
    );
    expect(screen.getByText("读取业务数据").closest("li")).toHaveAttribute(
      "data-stage-state",
      "complete",
    );
    expect(screen.getByText("128")).toBeInTheDocument();
    expect(screen.getByText("58")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("uses waiting labels instead of invented diagnostic values", () => {
    useAnalysisStore.setState({
      diagnostics: null,
      currentPhase: "schema",
      progressMessage: null,
      progressValue: 0.08,
      selectedTables: new Map(),
    });

    const { container } = render(<ProgressIndicator />);

    expect(screen.getAllByText("等待数据").length).toBeGreaterThan(0);
    expect(screen.queryByText("0 个对象")).not.toBeInTheDocument();
    expect(container.querySelector(".analysis-progress-details")).toBeNull();
  });

  it("keeps an unknown backend phase neutral instead of marking the first stage current", () => {
    useAnalysisStore.setState({
      currentPhase: "retrieval",
      progressMessage: "正在提取关系数据",
      progressValue: 0.34,
      selectedTables: new Map(),
    });

    const { container } = render(<ProgressIndicator />);

    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveAttribute("data-stage-state", "pending");
    }

    const businessCopy = screen
      .getAllByText("正在提取关系数据")
      .find((node) => !node.closest("details"));

    expect(businessCopy).toBeDefined();
    expect(businessCopy?.closest("details")).toBeNull();
    expect(container.querySelector(".analysis-progress-details")).toBeInTheDocument();
    expect(screen.getByText("技术阶段：retrieval")).toBeInTheDocument();
  });
});
