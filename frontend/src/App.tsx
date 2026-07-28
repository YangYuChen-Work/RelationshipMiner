import SelectionWorkspace from "./components/SelectionWorkspace";
import ProgressIndicator from "./components/ProgressIndicator";
import GraphCanvas from "./components/GraphCanvas";
import NodeDetailPanel from "./components/NodeDetailPanel";
import StrengthFilter from "./components/StrengthFilter";
import ExportButton from "./components/ExportButton";
import { useAnalysisStore } from "./store/analysis";

function App() {
  const phase = useAnalysisStore((s) => s.phase);
  const errorMessage = useAnalysisStore((s) => s.errorMessage);
  const graph = useAnalysisStore((s) => s.graph);
  const resetAnalysis = useAnalysisStore((s) => s.resetAnalysis);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">AI 关系图谱分析</h1>
        <p className="text-sm text-gray-500 mt-1">
          选择数据库表与字段，AI 自动发现数据间的隐藏关联
        </p>
      </header>

      <main className="space-y-6">
        {/* 选择阶段 */}
        {(phase === "select" || phase === "error") && (
          <>
            <section className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <SelectionWorkspace />
            </section>
          </>
        )}

        {/* 错误提示 */}
        {phase === "error" && (
          <section className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium text-red-700">分析失败</p>
                <p className="text-sm text-red-600 mt-1">{errorMessage}</p>
              </div>
              <button
                onClick={resetAnalysis}
                className="text-sm text-red-600 underline hover:no-underline mt-0.5 shrink-0"
              >
                重新选择
              </button>
            </div>
          </section>
        )}

        {/* 分析进行中 */}
        {phase === "analyzing" && <ProgressIndicator />}

        {/* 分析完成 — 图谱可视化 */}
        {phase === "done" && graph && (
          <section className="space-y-3">
            {/* 结果摘要栏 */}
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-4 py-3">
              <div>
                <p className="font-medium text-green-700 text-sm">分析完成</p>
                <p className="text-xs text-green-600 mt-0.5">
                  共 {graph.nodes.length} 个节点，{graph.edges.length} 条关系
                </p>
              </div>
              <div className="flex items-center gap-3">
                <ExportButton />
                <button
                  onClick={resetAnalysis}
                  className="text-sm text-green-600 underline hover:no-underline shrink-0"
                >
                  开始新分析
                </button>
              </div>
            </div>

            {/* 图谱画布 */}
            <GraphCanvas />

            {/* 置信度滑块（底部浮动） */}
            <div className="flex justify-center">
              <StrengthFilter />
            </div>

            {/* 节点详情面板 */}
            <NodeDetailPanel />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
