import TableSelector from "./components/TableSelector";
import FieldSelector from "./components/FieldSelector";
import AnalysisLauncher from "./components/AnalysisLauncher";
import ProgressIndicator from "./components/ProgressIndicator";
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
              <TableSelector />
            </section>

            <section className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <FieldSelector />
            </section>

            <section className="flex items-center justify-between">
              <AnalysisLauncher />
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

        {/* 分析完成 */}
        {phase === "done" && graph && (
          <section className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-green-700">分析完成</p>
                  <p className="text-sm text-green-600 mt-1">
                    共 {graph.nodes.length} 个节点，{graph.edges.length} 条关系
                  </p>
                </div>
                <button
                  onClick={resetAnalysis}
                  className="text-sm text-green-600 underline hover:no-underline mt-0.5 shrink-0"
                >
                  开始新分析
                </button>
              </div>
            </div>

            {/* 图谱结果占位 — 工单 04 接入 D3 图谱 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                图谱数据预览
              </h3>
              <div className="text-xs text-gray-500 space-y-1">
                <p>节点数: {graph.nodes.length}</p>
                <p>边数: {graph.edges.length}</p>
                {graph.edges.length === 0 && (
                  <p className="text-orange-500 mt-2">
                    未发现任何关系，建议调整表/字段选择
                  </p>
                )}
                {graph.edges.length > 0 && (
                  <ul className="mt-2 space-y-0.5">
                    {graph.edges.slice(0, 10).map((e, i) => (
                      <li key={i}>
                        {e.source} → {e.target}{" "}
                        <span className="text-blue-500">
                          [{e.labels.join(", ")}]
                        </span>{" "}
                        (置信度: {e.confidence.toFixed(2)})
                      </li>
                    ))}
                    {graph.edges.length > 10 && (
                      <li>...还有 {graph.edges.length - 10} 条边</li>
                    )}
                  </ul>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
