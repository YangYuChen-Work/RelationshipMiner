import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import type { SemanticGraphData } from "../api/analysis";
import { computeGroupedLayout } from "../graph/layout";
import { useAnalysisStore } from "../store/analysis";

const graph: SemanticGraphData = {
  table_nodes: [{ id: "users", display_name: "Users", entity_count: 1 }],
  entity_nodes: [
    {
      id: "user-1",
      table_id: "users",
      display_name: "User 1",
      class_name: "User",
      dimensions: {},
    },
  ],
  table_edges: [],
  entity_edges: [],
};

class LayoutWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  postMessage(message: {
    requestId: number;
    graph: SemanticGraphData;
    viewport: { width: number; height: number };
  }) {
    this.onmessage?.({
      data: {
        requestId: message.requestId,
        layout: computeGroupedLayout(message.graph, message.viewport),
      },
    } as MessageEvent);
  }
  terminate() {}
}

describe("App graph error result", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", LayoutWorker);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      arc: vi.fn(),
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    useAnalysisStore.setState({
      phase: "error",
      graph,
      analysisStatus: "failed",
      taskId: "task-failed-with-graph",
      errorMessage: "分析超时",
      warnings: ["仅显示已完成的关系"],
      selectedNodeId: "user-1",
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    useAnalysisStore.setState({
      phase: "select",
      graph: null,
      analysisStatus: null,
      errorMessage: null,
      warnings: [],
    });
  });

  it("keeps the complete real workbench available behind a non-blocking failure banner", async () => {
    render(<App />);

    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /语义关系图/ }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getAllByRole("alert").some((alert) =>
        alert.textContent?.includes("分析超时") &&
        alert.textContent.includes("仅显示已完成的关系"),
      ),
    ).toBe(true);
    expect(screen.getAllByText("分析超时")).toHaveLength(1);
    expect(screen.getAllByText("仅显示已完成的关系")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "导出 JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "新分析" })).toBeEnabled();
    expect(screen.getByText("业务对象")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User 1" })).toBeInTheDocument();
    expect(screen.queryByText("user-1")).not.toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("技术依据"));
    expect(screen.getByText("user-1")).toBeInTheDocument();
    expect(screen.getByText("User")).toBeInTheDocument();
    expect(screen.queryByText("重新选择")).not.toBeInTheDocument();
  });

  it("shows the plain error workspace when no graph is available", () => {
    act(() => useAnalysisStore.setState({ graph: null, analysisStatus: null }));

    render(<App />);

    expect(screen.queryByRole("img", { name: /语义关系图/ })).not.toBeInTheDocument();
    expect(screen.getByText("重新选择")).toBeInTheDocument();
    expect(screen.getByText("分析超时")).toBeInTheDocument();
  });
});
