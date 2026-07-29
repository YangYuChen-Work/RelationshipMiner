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
          className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 bg-[#0a1622] px-6 text-center text-sm text-slate-300"
        >
          <p>
            <span>图谱画布暂时无法显示</span>
            ；分析结果仍可通过详情和导出使用。
          </p>
          <button
            type="button"
            onClick={this.retry}
            className="rounded border border-slate-500 px-3 py-1.5 text-slate-100"
          >
            重试画布
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
