import { Component, type ReactNode } from "react";

interface CanvasErrorBoundaryProps {
  children: ReactNode;
  onReset?: () => void;
}

interface CanvasErrorBoundaryState {
  hasError: boolean;
}

/** Keeps an unexpected renderer failure contained without hiding analysis controls. */
export default class CanvasErrorBoundary extends Component<CanvasErrorBoundaryProps, CanvasErrorBoundaryState> {
  state: CanvasErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): CanvasErrorBoundaryState {
    return { hasError: true };
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 border border-slate-200 bg-white px-6 text-center text-sm text-slate-700"
        >
          <p>
            <span>图谱画布暂时无法显示</span>
            ；分析结果仍可通过详情和导出使用。
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:border-teal-600 hover:text-teal-700"
          >
            重试画布
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
