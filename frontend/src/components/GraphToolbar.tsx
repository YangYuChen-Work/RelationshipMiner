import ExportButton from "./ExportButton";
import StrengthFilter from "./StrengthFilter";
import { useAnalysisStore } from "../store/analysis";
import { projectGraph } from "../graph/projection";

export default function GraphToolbar() {
  const graph = useAnalysisStore((state) => state.graph);
  const confidenceThreshold = useAnalysisStore(
    (state) => state.confidenceThreshold,
  );
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
    <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4 text-slate-700 lg:px-6">
      <div className="min-w-0 shrink-0">
        <h1 className="text-sm font-semibold tracking-wide text-slate-900">业务关系图</h1>
        <p className="hidden text-xs text-slate-500 sm:block">
          <span>{analysisSubtitle}</span> · 业务视图
        </p>
      </div>

      <div className="hidden items-center gap-3 border-l border-slate-200 pl-4 text-xs text-slate-600 md:flex">
        <span>{graph.entity_nodes.length} 个对象</span>
        <span className="text-slate-300">/</span>
        <span>{graph.entity_edges.length} 条业务关系</span>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-teal-700">
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
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={showIsolatedNodes}
            onChange={(event) => setShowIsolatedNodes(event.target.checked)}
          />
          显示未关联对象（隐藏 {hiddenIsolatedNodeCount} 个）
        </label>
        <button
          type="button"
          onClick={requestFitView}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700"
        >
          适应视图
        </button>
        <button
          type="button"
          onClick={requestRelayout}
          className="shrink-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-teal-500 hover:text-teal-700"
        >
          重新生成布局
        </button>
        <div className="shrink-0">
          <ExportButton />
        </div>
        <button
          type="button"
          onClick={resetAnalysis}
          aria-label="新分析"
          className="shrink-0 rounded-md bg-teal-600 px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-700"
        >
          新分析
          <span className="sr-only">开始新分析</span>
        </button>
      </div>
    </header>
  );
}
