/** StrengthFilter — 置信度阈值滑块组件。

连续滑块（0.0–1.0），拖拽实时调节边显示/隐藏的置信度阈值。
弱关系/强关系标签在两端。
*/

import { useAnalysisStore } from "../store/analysis";

export default function StrengthFilter() {
  const confidenceThreshold = useAnalysisStore((s) => s.confidenceThreshold);
  const setConfidenceThreshold = useAnalysisStore((s) => s.setConfidenceThreshold);

  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-600/80 bg-slate-900/90 px-3 py-2 text-slate-200 backdrop-blur">
      <label htmlFor="strength-slider" className="text-xs font-medium text-slate-300">
        置信度阈值
      </label>
      {/* 弱关系标签 */}
      <span className="hidden text-xs font-medium text-slate-400 sm:inline">弱关系</span>

      {/* 滑块 */}
      <div className="relative flex-1 flex items-center">
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={confidenceThreshold}
          onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-teal-400
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-moz-range-thumb]:w-3
            [&::-moz-range-thumb]:h-3
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-teal-400
            [&::-moz-range-thumb]:border-none
            [&::-moz-range-thumb]:cursor-pointer"
          id="strength-slider"
          aria-label="置信度阈值"
        />
      </div>

      {/* 强关系标签 */}
      <span className="hidden text-xs font-medium text-slate-400 sm:inline">强关系</span>

      {/* 数值显示 */}
      <output
        className="min-w-[3.5em] shrink-0 rounded bg-teal-400/10 px-2 py-0.5 text-center font-mono text-xs font-semibold text-teal-200"
        htmlFor="strength-slider"
      >
        {confidenceThreshold.toFixed(2)}
      </output>
    </div>
  );
}
