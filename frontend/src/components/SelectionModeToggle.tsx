import type { KeyboardEvent } from "react";
import type { SelectionMode } from "../store/analysis";

interface SelectionModeToggleProps {
  mode: SelectionMode;
  onChange: (mode: SelectionMode) => void;
}

const modes: Array<{ value: SelectionMode; label: string }> = [
  { value: "natural", label: "\u81ea\u7136\u8bed\u8a00\u9009\u53d6" },
  { value: "manual", label: "\u624b\u52a8\u9009\u53d6" },
];

function focusMode(mode: SelectionMode) {
  document.getElementById(`selection-tab-${mode}`)?.focus();
}

export default function SelectionModeToggle({
  mode,
  onChange,
}: SelectionModeToggleProps) {
  function selectWithKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = modes.findIndex(({ value }) => value === mode);
    let nextIndex: number | null = null;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex + modes.length - 1) % modes.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % modes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = modes.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = modes[nextIndex].value;
    onChange(nextMode);
    focusMode(nextMode);
  }

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
          id={`selection-tab-${value}`}
          aria-selected={mode === value}
          aria-controls={`selection-panel-${value}`}
          tabIndex={mode === value ? 0 : -1}
          onClick={() => onChange(value)}
          onKeyDown={selectWithKeyboard}
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
