import ExportButton from "./ExportButton";
import StrengthFilter from "./StrengthFilter";
import { useAnalysisStore } from "../store/analysis";

export default function GraphToolbar() {
  const graph = useAnalysisStore((state) => state.graph);
  const confidenceThreshold = useAnalysisStore(
    (state) => state.confidenceThreshold,
  );
  const analysisStatus = useAnalysisStore((state) => state.analysisStatus);
  const requestFitView = useAnalysisStore((state) => state.requestFitView);
  const requestRelayout = useAnalysisStore((state) => state.requestRelayout);
  const resetAnalysis = useAnalysisStore((state) => state.resetAnalysis);

  if (!graph) return null;

  const visibleEntityEdgeCount = graph.entity_edges.filter((edge) =>
    edge.relations.some(
      (relation) =>
        relation.strength === "strong" || relation.confidence >= confidenceThreshold,
    ),
  ).length;
  const visibleTableEdgeCount = graph.table_edges.filter(
    (edge) =>
      edge.strong_count > 0 || edge.average_confidence >= confidenceThreshold,
  ).length;
  const analysisSubtitle =
    analysisStatus === "failed"
      ? "分析失败 · 可用结果"
      : analysisStatus === "partial"
        ? "部分结果 · 分析未完成"
        : "分析完成";

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-700/80 bg-[#101c2a] px-4 text-slate-200 lg:px-6">
      <div className="min-w-0 shrink-0">
        <h1 className="text-sm font-semibold tracking-wide text-slate-50">关系图谱</h1>
        <p className="hidden text-xs text-slate-400 sm:block">
          <span>{analysisSubtitle}</span> · 结果工作台
        </p>
      </div>

      <div className="hidden items-center gap-3 border-l border-slate-700 pl-4 text-xs text-slate-300 md:flex">
        <span>{graph.table_nodes.length} 张表</span>
        <span className="text-slate-600">/</span>
        <span>{graph.entity_nodes.length} 个实体</span>
        <span className="text-slate-600">/</span>
        <span>{graph.table_edges.length} 条表关系</span>
        <span className="text-slate-600">/</span>
        <span>{graph.entity_edges.length} 条实体关系</span>
        <span className="rounded-full border border-teal-400/25 bg-teal-400/10 px-2 py-0.5 text-teal-200">
          {visibleTableEdgeCount + visibleEntityEdgeCount} 条可见关系
        </span>
        {(graph.table_edges.length > 0 || graph.entity_edges.length > 0) && (
          <span className="sr-only">
            共 {graph.table_nodes.length} 张表，{graph.entity_nodes.length} 个实体，
            {graph.table_edges.length} 条表关系，{graph.entity_edges.length} 条实体关系
          </span>
        )}
      </div>

      <div
        role="toolbar"
        aria-label="图谱操作"
        className="ml-auto flex min-w-0 flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain py-1 lg:flex-none"
      >
        <div className="shrink-0">
          <StrengthFilter />
        </div>
        <button
          type="button"
          onClick={requestFitView}
          className="shrink-0 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-teal-300 hover:text-teal-100"
        >
          适应画布
        </button>
        <button
          type="button"
          onClick={requestRelayout}
          className="shrink-0 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-teal-300 hover:text-teal-100"
        >
          重新布局
        </button>
        <div className="shrink-0">
          <ExportButton />
        </div>
        <button
          type="button"
          onClick={resetAnalysis}
          aria-label="新分析"
          className="shrink-0 rounded-md bg-teal-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-teal-300"
        >
          新分析
          <span className="sr-only">开始新分析</span>
        </button>
      </div>
    </header>
  );
}
