/** ProgressIndicator — WebSocket 进度展示组件。

消费全局状态中的分析进度，展示当前阶段 + 进度条 + 阶段描述文本。
支持 5 个分析阶段的中文标签。
*/

import { useAnalysisStore } from "../store/analysis";

const PHASE_LABELS: Record<string, string> = {
  schema: "读取表结构",
  entities: "读取实体",
  planning: "规划关系",
  candidates: "检索候选关系",
  semantic_judging: "语义判断",
  graph: "组装关系图谱",
  complete: "分析完成",
};

export default function ProgressIndicator() {
  const phase = useAnalysisStore((s) => s.phase);
  const currentPhase = useAnalysisStore((s) => s.currentPhase);
  const progressMessage = useAnalysisStore((s) => s.progressMessage);
  const progressValue = useAnalysisStore((s) => s.progressValue);

  if (phase !== "analyzing") return null;

  const phaseLabel = PHASE_LABELS[currentPhase] || currentPhase || "正在准备分析";
  const percent = Math.round(progressValue * 100);

  return (
    <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm space-y-4">
      {/* 阶段标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          <div>
            <span className="text-sm font-semibold text-blue-700">
              {phaseLabel}
            </span>
          </div>
        </div>
        <span className="text-sm font-mono text-blue-600 tabular-nums">
          {percent}%
        </span>
      </div>

      {/* 进度条 */}
      <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
        <div
          className="bg-blue-500 h-2.5 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 阶段描述 */}
      <p className="text-sm text-gray-500">{progressMessage}</p>

      <p className="text-xs text-gray-400" aria-live="polite">
        状态：分析中
      </p>
    </div>
  );
}
