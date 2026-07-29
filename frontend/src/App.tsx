import SelectionWorkspace from "./components/SelectionWorkspace";
import ProgressIndicator from "./components/ProgressIndicator";
import GraphWorkbench from "./components/GraphWorkbench";
import { useAnalysisStore } from "./store/analysis";

function App() {
  const phase = useAnalysisStore((s) => s.phase);
  const errorMessage = useAnalysisStore((s) => s.errorMessage);
  const graph = useAnalysisStore((s) => s.graph);
  const resetAnalysis = useAnalysisStore((s) => s.resetAnalysis);

  if ((phase === "done" || phase === "error") && graph) {
    return <GraphWorkbench />;
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
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

        </main>
      </div>
    </div>
  );
}

export default App;
