import { Component, type ReactNode } from "react";

interface CanvasErrorBoundaryProps {
  children: ReactNode;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
}

export default class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  state: CanvasErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-full min-h-[420px] items-center justify-center bg-[#0a1622] px-6 text-center"
        >
          <div className="max-w-md rounded-xl border border-slate-700 bg-slate-900/80 px-5 py-6">
            <h2 className="text-sm font-semibold text-slate-100">
              图谱画布暂时无法显示
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              分析结果仍可通过右侧概览和上方“导出 JSON”使用，也可以点击“新分析”重新开始。
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
