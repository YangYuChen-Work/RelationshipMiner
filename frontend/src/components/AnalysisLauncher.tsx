/** AnalysisLauncher — 开始分析按钮组件。

校验用户选择（至少 1 张表），启用"开始分析"按钮。
分析进行中时显示为禁用状态。
*/

import { useAnalysisStore } from "../store/analysis";

export default function AnalysisLauncher() {
  const phase = useAnalysisStore((s) => s.phase);
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const startAnalysis = useAnalysisStore((s) => s.startAnalysis);

  const tableCount = selectedTables.size;
  const canStart = tableCount > 0 && phase === "select";
  const isAnalyzing = phase === "analyzing";

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={startAnalysis}
        disabled={!canStart}
        className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition-all ${
          isAnalyzing
            ? "bg-blue-100 text-blue-500 cursor-wait"
            : canStart
              ? "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-sm"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
        }`}
      >
        {isAnalyzing ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            分析中...
          </span>
        ) : (
          "开始分析"
        )}
      </button>

      {!canStart && !isAnalyzing && phase === "select" && (
        <span className="text-xs text-gray-400">
          {tableCount === 0
            ? "请先勾选要分析的数据表"
            : "请选择至少一张表"}
        </span>
      )}
    </div>
  );
}
