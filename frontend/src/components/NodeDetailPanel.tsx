/** NodeDetailPanel — 右侧详情抽屉组件。

双击节点后滑出，展示该数据记录的所有字段原始值及关联节点列表。
*/

import { useAnalysisStore } from "../store/analysis";
import type { NodeData } from "../api/analysis";

/** 查找与指定节点关联的节点 ID 列表。 */
function getRelatedNodeIds(
  nodeId: string,
  graph: { nodes: NodeData[]; edges: { source: string; target: string }[] }
): string[] {
  const related = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source === nodeId) related.add(edge.target);
    if (edge.target === nodeId) related.add(edge.source);
  }
  return Array.from(related);
}

export default function NodeDetailPanel() {
  const detailPanelNodeId = useAnalysisStore((s) => s.detailPanelNodeId);
  const closeDetailPanel = useAnalysisStore((s) => s.closeDetailPanel);
  const graph = useAnalysisStore((s) => s.graph);
  const openDetailPanel = useAnalysisStore((s) => s.openDetailPanel);

  if (!detailPanelNodeId || !graph) return null;

  const node = graph.nodes.find((n) => n.id === detailPanelNodeId);
  if (!node) return null;

  const relatedIds = getRelatedNodeIds(node.id, graph);
  const fieldEntries = Object.entries(node.field_values);

  return (
    <>
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 z-30 bg-black/20 backdrop-blur-sm"
        onClick={closeDetailPanel}
      />

      {/* 抽屉面板 */}
      <div className="fixed top-0 right-0 z-40 h-full w-96 bg-white shadow-2xl border-l border-gray-200 overflow-y-auto transition-transform duration-300 ease-out">
        {/* 头部 */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">节点详情</h3>
            <p className="text-xs text-gray-400 font-mono mt-0.5 truncate max-w-[280px]">
              {node.id}
            </p>
          </div>
          <button
            onClick={closeDetailPanel}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none p-1"
            aria-label="关闭面板"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* 基本信息 */}
          <section>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              基本信息
            </h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">来源表</dt>
                <dd className="text-gray-900 font-medium">{node.source_table}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">类名</dt>
                <dd className="text-gray-900 font-mono text-xs truncate max-w-[200px]">
                  {node.class_name || "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">关联度数</dt>
                <dd className="text-gray-900 font-medium">{node.degree}</dd>
              </div>
            </dl>
          </section>

          {/* 字段原始值 */}
          <section>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              字段值
            </h4>
            {fieldEntries.length === 0 ? (
              <p className="text-sm text-gray-400">无字段数据</p>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {fieldEntries.map(([key, value]) => (
                      <tr key={key} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-500 font-mono text-xs w-1/2">
                          {key}
                        </td>
                        <td className="px-3 py-2 text-gray-900 font-mono text-xs truncate max-w-[180px]">
                          {value === null ? (
                            <span className="text-gray-300 italic">NULL</span>
                          ) : typeof value === "object" ? (
                            JSON.stringify(value)
                          ) : (
                            String(value)
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 关联节点 */}
          <section>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              关联节点
              {relatedIds.length > 0 && (
                <span className="ml-1 text-gray-400">({relatedIds.length})</span>
              )}
            </h4>
            {relatedIds.length === 0 ? (
              <p className="text-sm text-gray-400">无关联节点</p>
            ) : (
              <ul className="space-y-1">
                {relatedIds.map((id) => {
                  const relatedNode = graph.nodes.find((n) => n.id === id);
                  return (
                    <li key={id}>
                      <button
                        onClick={() => openDetailPanel(id)}
                        className="w-full text-left px-3 py-2 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                      >
                        <span className="text-xs font-mono text-gray-700 truncate block">
                          {id}
                        </span>
                        {relatedNode && (
                          <span className="text-xs text-gray-400">
                            {relatedNode.source_table}
                            {relatedNode.class_name && ` · ${relatedNode.class_name.split(".").pop()}`}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
