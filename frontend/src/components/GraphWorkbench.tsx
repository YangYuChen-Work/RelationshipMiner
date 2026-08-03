import CanvasErrorBoundary from "./CanvasErrorBoundary";
import GraphCanvas from "./GraphCanvas";
import GraphToolbar from "./GraphToolbar";
import GraphLegend from "./GraphLegend";
import NodeDetailPanel from "./NodeDetailPanel";
import { useAnalysisStore } from "../store/analysis";

function AnalysisNotice() {
  const graph = useAnalysisStore((state) => state.graph);
  const analysisStatus = useAnalysisStore((state) => state.analysisStatus);
  const diagnostics = useAnalysisStore((state) => state.diagnostics);
  const warnings = useAnalysisStore((state) => state.warnings);
  const errorMessage = useAnalysisStore((state) => state.errorMessage);
  if (!graph) return null;
  if (analysisStatus === "failed") {
    const failureReason = errorMessage || warnings[0] || "关系判断未能全部完成，请检查后端分析日志后重试。";
    const additionalWarnings = warnings.filter((warning) => warning !== failureReason);
    return (
      <section
        role="alert"
        className="mx-3 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
      >
        <p className="font-semibold">对象关系暂时无法完成判断。</p>
        <p className="mt-1 text-xs">已保留当前可用的业务对象和关系，可稍后重试。</p>
        <details className="mt-2 text-xs text-rose-700">
          <summary className="cursor-pointer">技术详情</summary>
          <p className="mt-2">{failureReason}</p>
          {additionalWarnings.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {additionalWarnings.map((warning, index) => (
                <li key={`${warning}-${index}`}>{warning}</li>
              ))}
            </ul>
          )}
        </details>
      </section>
    );
  }
  if (analysisStatus === "partial") {
    const completed = diagnostics?.candidates_completed ?? 0;
    const pending = diagnostics?.candidates_pending ?? 0;
    const failed = diagnostics?.candidates_failed ?? Math.max((diagnostics?.candidates_retrieved ?? 0) - completed - pending, 0);
    const hasAvailableRelationships =
      graph.entity_edges.length + graph.table_edges.length > 0;
    const allFailed =
      !hasAvailableRelationships && completed === 0 && pending === 0 && failed > 0;
    const title = allFailed
      ? "对象关系暂时无法完成判断。"
      : "部分对象的关系尚未判断完成。";
    const fallbackExplanation = allFailed
      ? "所有候选关系判断均失败，请检查模型服务或后端日志后重试。"
      : pending > 0
        ? "仍有对象关系待处理。"
        : "部分对象关系未能完成。";
    const businessImpact = hasAvailableRelationships
      ? "已展示目前可用的业务关系，结果可能继续补充。"
      : "当前还没有可展示的业务关系。";
    return (
      <section role="status" className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs">{businessImpact}</p>
        <details className="mt-2 text-xs text-amber-800">
          <summary className="cursor-pointer">技术详情</summary>
          <p className="mt-2">判断任务：已完成 {completed} · 待处理 {pending} · 失败 {failed}</p>
          {warnings.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          ) : (
            <p className="mt-2">{fallbackExplanation}</p>
          )}
        </details>
      </section>
    );
  }
  if (analysisStatus === "complete" && graph.entity_edges.length === 0 && graph.table_edges.length === 0) {
    return <section role="status" className="mx-3 mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">暂未发现对象之间的业务关系。可调整业务数据或辅助判断依据后重新分析。</section>;
  }
  return null;
}

export default function GraphWorkbench() {
  return (
    <section data-business-workbench className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[#f3f5f7] text-slate-800">
      <GraphToolbar />
      <AnalysisNotice />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="business-graph-stage relative min-h-0 overflow-hidden border-r border-slate-200 bg-[#f3f5f7]">
          <div className="h-full min-h-0 p-3 [&>div]:h-full [&_canvas]:h-full">
            <CanvasErrorBoundary>
              <GraphCanvas suppressStatusOverlay />
            </CanvasErrorBoundary>
          </div>
          <div className="pointer-events-none absolute left-4 top-16 z-20 sm:left-6 sm:top-6">
            <GraphLegend />
          </div>
        </section>
        <NodeDetailPanel />
      </main>
    </section>
  );
}
