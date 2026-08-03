/** ProgressIndicator — WebSocket 进度展示组件。

消费全局状态中的分析进度，展示当前阶段 + 进度条 + 阶段描述文本。
支持 5 个分析阶段的中文标签。
*/

import { useAnalysisStore } from "../store/analysis";

const PHASE_LABELS: Record<string, string> = {
  schema: "正在读取业务数据",
  entities: "正在整理业务对象",
  planning: "正在梳理关系范围",
  candidates: "正在寻找可能有关的对象",
  semantic_judging: "正在判断对象关系",
  graph: "正在整理业务关系图",
  complete: "业务关系图已生成",
};

export default function ProgressIndicator() {
  const phase = useAnalysisStore((s) => s.phase);
  const currentPhase = useAnalysisStore((s) => s.currentPhase);
  const progressMessage = useAnalysisStore((s) => s.progressMessage);
  const progressValue = useAnalysisStore((s) => s.progressValue);

  if (phase !== "analyzing") return null;

  const knownPhaseLabel = PHASE_LABELS[currentPhase];
  const phaseLabel = knownPhaseLabel || "正在处理业务对象关系";
  const technicalPhase = currentPhase && !knownPhaseLabel ? currentPhase : null;
  const percent = Math.round(progressValue * 100);

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* 阶段标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-5 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          <div>
            <span className="text-sm font-semibold text-slate-800">
              {phaseLabel}
            </span>
          </div>
        </div>
        <span className="font-mono text-sm text-teal-700 tabular-nums">
          {percent}%
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-2.5 rounded-full bg-teal-600 transition-all duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* 阶段描述 */}
      <p className="text-sm text-slate-600" aria-live="polite">
        正在生成业务关系图
      </p>
      {progressMessage || technicalPhase ? (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">技术详情</summary>
          {technicalPhase ? <p className="mt-2">技术阶段：{technicalPhase}</p> : null}
          {progressMessage ? <p className="mt-2">{progressMessage}</p> : null}
        </details>
      ) : null}
    </div>
  );
}
