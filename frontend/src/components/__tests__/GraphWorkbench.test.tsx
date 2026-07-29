import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
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

  it("explains that a partial graph with pending work has no usable relationships yet", () => {
    useAnalysisStore.setState({ analysisStatus: "partial", graph: { ...emptyGraph, table_nodes: [{ id: "users", display_name: "Users", entity_count: 1 }], entity_nodes: [{ id: "u1", table_id: "users", display_name: "U1", class_name: null, dimensions: {} }] }, warnings: ["semantic model timed out"], diagnostics: { entities_read: 1, plans_created: 1, candidates_retrieved: 7, candidates_completed: 3, candidates_pending: 2, candidates_failed: 2, strong_edges_created: 0, weak_edges_created: 0 } });
    render(<GraphWorkbench />);
    const banner = document.querySelector("section[role='status']")!;
    expect(banner).toHaveTextContent("分析未完成，尚无可用关系");
    expect(banner).toHaveTextContent("已完成 3 · 待处理 2 · 失败 2");
    expect(banner).toHaveTextContent("semantic model timed out");
    expect(screen.queryByText(/正在显示可用关系/)).not.toBeInTheDocument();
  });

  it("explains an all-failed partial analysis even when the backend sends no warnings", () => {
    useAnalysisStore.setState({
      analysisStatus: "partial",
      warnings: [],
      diagnostics: {
        entities_read: 2,
        plans_created: 1,
        candidates_retrieved: 4,
        candidates_completed: 0,
        candidates_pending: 0,
        candidates_failed: 4,
        strong_edges_created: 0,
        weak_edges_created: 0,
      },
    });

    render(<GraphWorkbench />);

    const banner = document.querySelector("section[role='status']")!;
    expect(banner).toHaveTextContent("关系判断全部失败，尚无可用关系");
    expect(banner).toHaveTextContent(
      "所有候选关系判断均失败，请检查模型服务或后端日志后重试",
    );
  });

  it("says it is showing usable relationships only when partial edges exist", () => {
    useAnalysisStore.setState({
      analysisStatus: "partial",
      graph: {
        ...emptyGraph,
        entity_edges: [{
          id: "a--b",
          source: "a",
          target: "b",
          relations: [{
            source: "a",
            target: "b",
            relation_type: "related",
            direction: "undirected",
            strength: "weak",
            confidence: 0.7,
            explanation: "",
            evidence: [],
            model_id: null,
            task_id: null,
          }],
        }],
      },
      warnings: [],
      diagnostics: {
        entities_read: 2,
        plans_created: 1,
        candidates_retrieved: 2,
        candidates_completed: 1,
        candidates_pending: 1,
        candidates_failed: 0,
        strong_edges_created: 0,
        weak_edges_created: 1,
      },
    });

    render(<GraphWorkbench />);

    const banner = document.querySelector("section[role='status']")!;
    expect(banner).toHaveTextContent("分析未完成，正在显示可用关系");
    expect(banner).toHaveTextContent("仍有候选关系待处理，结果可能继续补充");
  });
});
