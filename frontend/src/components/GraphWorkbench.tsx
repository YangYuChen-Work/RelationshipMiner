import CanvasErrorBoundary from "./CanvasErrorBoundary";
import GraphCanvas from "./GraphCanvas";
import GraphToolbar from "./GraphToolbar";
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
        className="mx-3 mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
      >
        <p className="font-semibold">分析失败，正在显示可用结果。</p>
        <p className="mt-1 text-xs">
          {failureReason}
        </p>
        {additionalWarnings.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {additionalWarnings.map((warning, index) => (
              <li key={`${warning}-${index}`}>{warning}</li>
            ))}
          </ul>
        )}
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
      ? "关系判断全部失败，尚无可用关系。"
      : hasAvailableRelationships
        ? "分析未完成，正在显示可用关系。"
        : "分析未完成，尚无可用关系。";
    const fallbackExplanation = allFailed
      ? "所有候选关系判断均失败，请检查模型服务或后端日志后重试。"
      : pending > 0
        ? "仍有候选关系待处理，结果可能继续补充。"
        : "部分候选关系未能完成，当前结果可能不完整。";
    return (
      <section role="status" className="mx-3 mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-xs">候选关系：已完成 {completed} · 待处理 {pending} · 失败 {failed}</p>
        {warnings.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-xs">
            {warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
          </ul>
        ) : (
          <p className="mt-2 text-xs">{fallbackExplanation}</p>
        )}
      </section>
    );
  }
  if (analysisStatus === "complete" && graph.entity_edges.length === 0 && graph.table_edges.length === 0) {
    return <section role="status" className="mx-3 mt-3 rounded-lg border border-slate-600 bg-slate-800/70 px-4 py-3 text-sm text-slate-200">完整分析未发现关系。可调整数据表或字段后重新分析。</section>;
  }
  return null;
}

export default function GraphWorkbench() {
  return (
    <section className="flex h-[100dvh] min-h-[100dvh] flex-col overflow-hidden bg-[#09131f] text-slate-100">
      <GraphToolbar />
      <AnalysisNotice />

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="relative min-h-0 overflow-hidden border-r border-slate-700/70 bg-[#0d1926]">
          <div className="h-full min-h-0 p-3 [&>div]:h-full [&_canvas]:h-full">
            <CanvasErrorBoundary>
              <GraphCanvas suppressStatusOverlay />
            </CanvasErrorBoundary>
          </div>
        </section>
        <NodeDetailPanel />
      </main>
    </section>
  );
}
