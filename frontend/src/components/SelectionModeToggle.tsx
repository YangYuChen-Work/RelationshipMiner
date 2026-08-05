import type { SelectionMode } from "../store/analysis";

interface SelectionModeToggleProps {
  mode: SelectionMode;
  onChange: (mode: SelectionMode) => void;
}

const modes: Array<{ value: SelectionMode; label: string }> = [
  { value: "natural", label: "\u81ea\u7136\u8bed\u8a00\u9009\u53d6" },
  { value: "manual", label: "\u624b\u52a8\u9009\u53d6" },
];

export default function SelectionModeToggle({
  mode,
  onChange,
}: SelectionModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="\u6570\u636e\u9009\u53d6\u65b9\u5f0f"
      className="inline-flex rounded-lg bg-gray-100 p-1"
    >
      {modes.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          aria-controls={`selection-panel-${value}`}
          onClick={() => onChange(value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === value
              ? "bg-white text-blue-700 shadow-sm"
              : "text-gray-600 hover:text-gray-900"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
