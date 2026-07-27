/** StrengthFilter — 置信度阈值滑块组件。

连续滑块（0.0–1.0），拖拽实时调节边显示/隐藏的置信度阈值。
弱关系/强关系标签在两端。
*/

import { useAnalysisStore } from "../store/analysis";

export default function StrengthFilter() {
  const confidenceThreshold = useAnalysisStore((s) => s.confidenceThreshold);
  const setConfidenceThreshold = useAnalysisStore((s) => s.setConfidenceThreshold);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-white/90 backdrop-blur rounded-lg border border-gray-200 shadow-sm">
      {/* 弱关系标签 */}
      <span className="text-xs text-gray-400 font-medium shrink-0">弱关系</span>

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
            [&::-webkit-slider-thumb]:w-4
            [&::-webkit-slider-thumb]:h-4
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-blue-600
            [&::-webkit-slider-thumb]:shadow-sm
            [&::-webkit-slider-thumb]:cursor-pointer
            [&::-moz-range-thumb]:w-4
            [&::-moz-range-thumb]:h-4
            [&::-moz-range-thumb]:rounded-full
            [&::-moz-range-thumb]:bg-blue-600
            [&::-moz-range-thumb]:border-none
            [&::-moz-range-thumb]:shadow-sm
            [&::-moz-range-thumb]:cursor-pointer"
          id="strength-slider"
          aria-label="置信度阈值"
        />

        {/* 渐变色带（视觉提示） */}
        <div
          className="absolute top-1/2 left-0 -translate-y-1/2 h-1.5 rounded-full pointer-events-none"
          style={{
            width: `${confidenceThreshold * 100}%`,
            background: "linear-gradient(to right, #d1d5db, #3b82f6)",
            opacity: 0.3,
          }}
        />
      </div>

      {/* 强关系标签 */}
      <span className="text-xs text-gray-400 font-medium shrink-0">强关系</span>

      {/* 数值显示 */}
      <output
        className="text-xs font-mono font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded shrink-0 min-w-[3.5em] text-center"
        htmlFor="strength-slider"
      >
        {confidenceThreshold.toFixed(2)}
      </output>
    </div>
  );
}
