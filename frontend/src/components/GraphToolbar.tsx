import ExportButton from "./ExportButton";
import StrengthFilter from "./StrengthFilter";
import { useAnalysisStore } from "../store/analysis";
import { projectGraph } from "../graph/projection";

function GraphMark() {
  return (
    <div className="product-mark" aria-label="AI Graph">
      <svg viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="5" r="2.5" />
        <circle cx="6" cy="13" r="2.5" />
        <circle cx="26" cy="13" r="2.5" />
        <circle cx="10" cy="26" r="2.5" />
        <circle cx="22" cy="26" r="2.5" />
        <path d="m8.4 11.3 5.2-4.2m4.8 0 5.2 4.2M7.6 15.2l1.1 7.8m15.7-7.8-1.1 7.8M8.4 25.1h15.2" />
      </svg>
      <span>
        <strong>AI Graph</strong>
        <small>Data Observatory</small>
      </span>
    </div>
  );
}

export default function GraphToolbar() {
  const graph = useAnalysisStore((state) => state.graph);
  const confidenceThreshold = useAnalysisStore((state) => state.confidenceThreshold);
  const analysisStatus = useAnalysisStore((state) => state.analysisStatus);
  const showIsolatedNodes = useAnalysisStore((state) => state.showIsolatedNodes);
  const setShowIsolatedNodes = useAnalysisStore((state) => state.setShowIsolatedNodes);
  const requestFitView = useAnalysisStore((state) => state.requestFitView);
  const requestRelayout = useAnalysisStore((state) => state.requestRelayout);
  const resetAnalysis = useAnalysisStore((state) => state.resetAnalysis);

  if (!graph) return null;

  const isolatedNodeCount =
    graph.entity_nodes.length - projectGraph(graph, false).entity_nodes.length;
  const hiddenIsolatedNodeCount = showIsolatedNodes ? 0 : isolatedNodeCount;
  const visibleEntityEdgeCount = graph.entity_edges.filter((edge) =>
    edge.relations.some(
      (relation) =>
        relation.strength === "strong" || relation.confidence >= confidenceThreshold,
    ),
  ).length;
  const analysisSubtitle =
    analysisStatus === "failed"
      ? "分析失败 · 可用结果"
      : analysisStatus === "partial"
        ? "部分结果 · 分析未完成"
        : "分析完成";

  return (
    <header className="graph-command-rail">
      <div className="graph-command-brand">
        <GraphMark />
      </div>

      <div className="graph-command-context">
        <h1>关系宇宙总览</h1>
        <p>
          <span>{analysisSubtitle}</span> · 全局业务轮廓
        </p>
      </div>

      <div className="graph-command-metrics hidden items-center gap-3 border-l border-slate-700 pl-4 text-xs text-slate-400 md:flex">
        <span>{graph.entity_nodes.length} 个对象</span>
        <span className="text-slate-600">/</span>
        <span>{graph.entity_edges.length} 条业务关系</span>
        <span className="graph-metric-chip">
          {visibleEntityEdgeCount} 条当前可见
        </span>
      </div>

      <div
        role="toolbar"
        aria-label="图谱操作"
        className="ml-auto flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain py-1 lg:flex-none"
      >
        <div className="shrink-0">
          <StrengthFilter />
        </div>
        <label className="graph-isolated-toggle flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showIsolatedNodes}
            onChange={(event) => setShowIsolatedNodes(event.target.checked)}
          />
          显示无关联对象（隐藏 {hiddenIsolatedNodeCount} 个）
        </label>
        <button
          type="button"
          onClick={requestFitView}
          className="graph-command-button shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700"
        >
          适应视图
        </button>
        <button
          type="button"
          onClick={requestRelayout}
          className="graph-command-button shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700"
        >
          整理全网布局
        </button>
        <div className="shrink-0">
          <ExportButton />
        </div>
        <button
          type="button"
          onClick={resetAnalysis}
          aria-label="新分析"
          className="graph-command-primary shrink-0 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
        >
          新分析
          <span className="sr-only">开始新分析</span>
        </button>
      </div>
    </header>
  );
}
