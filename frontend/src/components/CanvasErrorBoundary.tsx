import { Component, type ReactNode } from "react";

interface CanvasErrorBoundaryProps {
  children: ReactNode;
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

  render() {
    if (this.state.hasError) {
      return <div role="alert" className="flex h-full min-h-[420px] items-center justify-center bg-[#0a1622] px-6 text-center text-sm text-slate-300">图谱画布暂时无法显示；分析结果仍可通过详情和导出使用。</div>;
    }
    return this.props.children;
  }
}
