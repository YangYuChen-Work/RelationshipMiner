import ExportButton from "./ExportButton";
import StrengthFilter from "./StrengthFilter";
import { useAnalysisStore } from "../store/analysis";

export default function GraphToolbar() {
  const graph = useAnalysisStore((state) => state.graph);
  const confidenceThreshold = useAnalysisStore(
    (state) => state.confidenceThreshold,
  );
  const requestFitView = useAnalysisStore((state) => state.requestFitView);
  const requestRelayout = useAnalysisStore((state) => state.requestRelayout);
  const resetAnalysis = useAnalysisStore((state) => state.resetAnalysis);

  if (!graph) return null;

  const visibleEdgeCount = graph.edges.filter(
    (edge) => edge.confidence >= confidenceThreshold,
  ).length;

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-slate-700/80 bg-[#101c2a] px-4 text-slate-200 lg:px-6">
      <div className="min-w-0 shrink-0">
        <h1 className="text-sm font-semibold tracking-wide text-slate-50">关系图谱</h1>
        <p className="hidden text-xs text-slate-400 sm:block">
          <span>分析完成</span> · 结果工作台
        </p>
      </div>

      <div className="hidden items-center gap-3 border-l border-slate-700 pl-4 text-xs text-slate-300 md:flex">
        <span>{graph.nodes.length} 个节点</span>
        <span className="text-slate-600">/</span>
        <span>{graph.edges.length} 条关系</span>
        <span className="rounded-full border border-teal-400/25 bg-teal-400/10 px-2 py-0.5 text-teal-200">
          {visibleEdgeCount} 条可见关系
        </span>
        {graph.edges.length > 0 && (
          <span className="sr-only">
            共 {graph.nodes.length} 个节点，{graph.edges.length} 条关系
          </span>
        )}
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <div className="hidden xl:block">
          <StrengthFilter />
        </div>
        <button
          type="button"
          onClick={requestFitView}
          className="rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-teal-300 hover:text-teal-100"
        >
          适应画布
        </button>
        <button
          type="button"
          onClick={requestRelayout}
          className="hidden rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-teal-300 hover:text-teal-100 sm:inline-flex"
        >
          重新布局
        </button>
        <div className="hidden sm:block">
          <ExportButton />
        </div>
        <button
          type="button"
          onClick={resetAnalysis}
          aria-label="新分析"
          className="rounded-md bg-teal-400 px-2.5 py-1.5 text-xs font-semibold text-slate-950 transition-colors hover:bg-teal-300"
        >
          新分析
          <span className="sr-only">开始新分析</span>
        </button>
      </div>
    </header>
  );
}
