import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import GraphWorkbench from "../GraphWorkbench";
import { useAnalysisStore } from "../../store/analysis";

vi.mock("../GraphCanvas", () => ({
  default: function ThrowingGraphCanvas() {
    throw new Error("canvas render failed");
  },
}));

describe("GraphWorkbench canvas containment", () => {
  beforeEach(() => {
    useAnalysisStore.setState({
      phase: "done",
      taskId: "task-1",
      graph: {
        nodes: [
          {
            id: "users:1",
            source_table: "users",
            class_name: "User",
            field_values: { id: 1 },
            degree: 0,
          },
        ],
        edges: [],
      },
      confidenceThreshold: 0,
      selectedNodeId: null,
    });
  });

  it("keeps graph actions and data available when only the canvas crashes", () => {
    // This fails if a canvas exception unmounts the complete workbench.
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => render(<GraphWorkbench />)).not.toThrow();
    expect(
      screen.getByText("图谱画布暂时无法显示"),
    ).toBeVisible();
    expect(screen.getByText("1 个节点")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "新分析" })).toBeInTheDocument();
  });
});
