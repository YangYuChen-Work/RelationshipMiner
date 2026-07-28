import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import GraphWorkbench from "../GraphWorkbench";
import { useAnalysisStore } from "../../store/analysis";

describe("GraphWorkbench empty graph", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      phase: "done",
      taskId: "task-empty",
      graph: { nodes: [], edges: [] },
      confidenceThreshold: 0,
      selectedNodeId: null,
    });
  });

  it("shows a visible zero-node explanation with a clear new-analysis action", () => {
    // This fails if an empty SVG is the only result or recovery is hidden in assistive text.
    render(<GraphWorkbench />);

    expect(screen.getByText("未生成任何实体")).toBeVisible();
    expect(screen.getByText(/调整数据表或字段/)).toBeVisible();

    const newAnalysis = screen.getByRole("button", { name: "新分析" });
    expect(newAnalysis).toBeVisible();
    fireEvent.click(newAnalysis);
    expect(useAnalysisStore.getState().phase).toBe("select");
  });
});
