/** ProgressIndicator — WebSocket 进度展示组件。

消费全局状态中的分析进度，展示当前阶段 + 进度条 + 阶段描述文本。
支持 5 个分析阶段的中文标签。
*/

import { useAnalysisStore } from "../store/analysis";

const PHASE_LABELS: Record<number, string> = {
  1: "数据读取",
  2: "Schema 分析",
  3: "AI 决策",
  4: "关系计算",
  5: "图谱生成",
};

export default function ProgressIndicator() {
  const phase = useAnalysisStore((s) => s.phase);
  const currentPhase = useAnalysisStore((s) => s.currentPhase);
  const progressMessage = useAnalysisStore((s) => s.progressMessage);
  const progressValue = useAnalysisStore((s) => s.progressValue);

  if (phase !== "analyzing") return null;

  const phaseLabel = PHASE_LABELS[currentPhase] || "";
  const percent = Math.round(progressValue * 100);

  return (
    <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm space-y-4">
      {/* 阶段标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
          <div>
            <span className="text-sm font-semibold text-blue-700">
              阶段 {currentPhase}/5：{phaseLabel}
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

      {/* 阶段步骤指示器 */}
      <div className="flex items-center gap-1.5 justify-center">
        {[1, 2, 3, 4, 5].map((p) => (
          <div
            key={p}
            className={`h-2 w-8 rounded-full transition-colors duration-300 ${
              p <= currentPhase ? "bg-blue-500" : "bg-gray-200"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
