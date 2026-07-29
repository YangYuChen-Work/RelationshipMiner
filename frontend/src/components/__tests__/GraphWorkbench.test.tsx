import { beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { SemanticGraphData } from "../../api/analysis";
import GraphWorkbench from "../GraphWorkbench";
import { useAnalysisStore } from "../../store/analysis";

const emptyGraph: SemanticGraphData = { table_nodes: [], entity_nodes: [], table_edges: [], entity_edges: [] };

describe("GraphWorkbench analysis status", () => {
  beforeEach(() => {
    useAnalysisStore.setState({ phase: "done", taskId: "task-empty", graph: emptyGraph, confidenceThreshold: 0, selectedNodeId: null, selectedEntityEdgeId: null, selectedTableEdgeId: null, warnings: [], diagnostics: null, analysisStatus: "complete" });
  });

  it("distinguishes a complete analysis with no relationships", () => {
    render(<GraphWorkbench />);
    const notice = document.querySelector("section[role='status']")!;
    expect(notice).toHaveTextContent("完整分析未发现关系");
    expect(notice).toHaveTextContent("调整数据表或字段");
  });

  it("shows partial warnings plus completed, pending, and failed candidate diagnostics", () => {
    useAnalysisStore.setState({ analysisStatus: "partial", graph: { ...emptyGraph, table_nodes: [{ id: "users", display_name: "Users", entity_count: 1 }], entity_nodes: [{ id: "u1", table_id: "users", display_name: "U1", class_name: null, dimensions: {} }] }, warnings: ["semantic model timed out"], diagnostics: { entities_read: 1, plans_created: 1, candidates_retrieved: 7, candidates_completed: 3, candidates_pending: 2, candidates_failed: 2, strong_edges_created: 0, weak_edges_created: 0 } });
    render(<GraphWorkbench />);
    const banner = document.querySelector("section[role='status']")!;
    expect(banner).toHaveTextContent("分析未完成");
    expect(banner).toHaveTextContent("已完成 3 · 待处理 2 · 失败 2");
    expect(banner).toHaveTextContent("semantic model timed out");
  });
});
