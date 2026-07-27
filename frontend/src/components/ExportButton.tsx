/** ExportButton — JSON 导出组件。

点击按钮从后端拉取完整 JSON 快照并触发浏览器下载。
文件名包含时间戳以便区分。
*/

import { useState } from "react";
import { useAnalysisStore } from "../store/analysis";

export default function ExportButton() {
  const taskId = useAnalysisStore((s) => s.taskId);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async () => {
    if (!taskId) return;

    setExporting(true);
    setError(null);

    try {
      const res = await fetch(`/api/export/${taskId}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(
          typeof errData?.detail === "string"
            ? errData.detail
            : errData?.detail?.detail || "导出失败"
        );
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = `ai-graph-export-${timestamp}.json`;

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "导出失败，请稍后重试";
      setError(msg);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleExport}
        disabled={!taskId || exporting}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          !taskId
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : exporting
              ? "bg-blue-100 text-blue-500 cursor-wait"
              : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98] shadow-sm"
        }`}
      >
        {exporting ? (
          <span className="flex items-center gap-2">
            <span className="animate-spin h-3.5 w-3.5 border-2 border-blue-500 border-t-transparent rounded-full" />
            导出中...
          </span>
        ) : (
          "导出 JSON"
        )}
      </button>

      {error && (
        <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded">
          {error}
        </span>
      )}
    </div>
  );
}
