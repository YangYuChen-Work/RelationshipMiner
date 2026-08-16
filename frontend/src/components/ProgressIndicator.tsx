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

const ANALYSIS_STAGES = [
  { key: "schema", label: "读取业务数据" },
  { key: "entities", label: "整理业务对象" },
  { key: "planning", label: "梳理关系范围" },
  { key: "candidates", label: "寻找候选对象" },
  { key: "semantic_judging", label: "判断对象关系" },
  { key: "graph", label: "生成关系图" },
] as const;

function renderDiagnosticValue(value: number | null | undefined) {
  return value ?? "等待数据";
}

export default function ProgressIndicator() {
  const phase = useAnalysisStore((s) => s.phase);
  const currentPhase = useAnalysisStore((s) => s.currentPhase);
  const progressMessage = useAnalysisStore((s) => s.progressMessage);
  const progressValue = useAnalysisStore((s) => s.progressValue);
  const selectedTables = useAnalysisStore((s) => s.selectedTables);
  const diagnostics = useAnalysisStore((s) => s.diagnostics);

  if (phase !== "analyzing") return null;

  const knownPhaseLabel = PHASE_LABELS[currentPhase];
  const phaseLabel = knownPhaseLabel || "正在处理业务对象关系";
  const technicalPhase = currentPhase && !knownPhaseLabel ? currentPhase : null;
  const clampedProgress = Math.min(Math.max(progressValue, 0), 1);
  const percent = Math.round(clampedProgress * 100);
  const currentStageIndex = Math.max(
    ANALYSIS_STAGES.findIndex((stage) => stage.key === currentPhase),
    0,
  );
  const stages = ANALYSIS_STAGES.map((stage, index) => ({
    ...stage,
    state:
      index < currentStageIndex
        ? "complete"
        : index === currentStageIndex
          ? "current"
          : "pending",
  }));

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

      <ol aria-label="分析阶段" className="analysis-progress-stages grid gap-2 sm:grid-cols-3">
        {stages.map((stage) => (
          <li
            key={stage.key}
            aria-current={stage.state === "current" ? "step" : undefined}
            data-stage-state={stage.state}
            className="flex items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700"
          >
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full bg-current opacity-60"
            />
            <strong className="font-medium">{stage.label}</strong>
          </li>
        ))}
      </ol>

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

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            已选表
          </dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-slate-800">
            {selectedTables.size}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            已读取对象
          </dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-slate-800">
            {renderDiagnosticValue(diagnostics?.entities_read)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            待判断候选
          </dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-slate-800">
            {renderDiagnosticValue(diagnostics?.candidates_pending)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            已完成候选
          </dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-slate-800">
            {renderDiagnosticValue(diagnostics?.candidates_completed)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            已生成强关系
          </dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-slate-800">
            {renderDiagnosticValue(diagnostics?.strong_edges_created)}
          </dd>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            已生成弱关系
          </dt>
          <dd className="mt-1 font-mono text-lg tabular-nums text-slate-800">
            {renderDiagnosticValue(diagnostics?.weak_edges_created)}
          </dd>
        </div>
      </dl>

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
