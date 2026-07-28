import { useAnalysisStore } from "../store/analysis";
import type { EdgeData, GraphData, NodeData } from "../api/analysis";

type RelatedNode = {
  edge: EdgeData;
  node: NodeData | undefined;
  nodeId: string;
};

function relatedNodes(nodeId: string, graph: GraphData): RelatedNode[] {
  return graph.edges.flatMap((edge) => {
    const relatedId =
      edge.source === nodeId
        ? edge.target
        : edge.target === nodeId
          ? edge.source
          : null;

    if (!relatedId) return [];

    return [
      {
        edge,
        node: graph.nodes.find((node) => node.id === relatedId),
        nodeId: relatedId,
      },
    ];
  });
}

function fieldValue(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function InspectorHeading() {
  return (
    <header className="border-b border-slate-700/70 px-5 py-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">
        节点详情
      </p>
      <p className="mt-1 text-sm text-slate-400">选择图谱中的节点以查看关联数据。</p>
    </header>
  );
}

export default function NodeDetailPanel() {
  const graph = useAnalysisStore((state) => state.graph);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);
  const requestNodeFocus = useAnalysisStore(
    (state) => state.requestNodeFocus,
  );
  const node = graph?.nodes.find((item) => item.id === selectedNodeId);
  const relations = node && graph ? relatedNodes(node.id, graph) : [];

  const mobilePosition = node
    ? "fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:static lg:w-auto lg:max-w-none lg:shadow-none"
    : "hidden lg:block";

  return (
    <aside
      className={`${mobilePosition} min-h-0 overflow-y-auto border-l border-slate-700/70 bg-[#101c2a]`}
      aria-label="节点详情检查器"
    >
      <InspectorHeading />

      {node && graph ? (
        <div className="space-y-6 px-5 py-5">
          <section>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">节点概览</h2>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 lg:hidden"
                aria-label="关闭节点详情"
              >
                ×
              </button>
            </div>

            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-400">完整 ID</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-100">
                  {node.id}
                </dd>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-slate-400">来源表</dt>
                  <dd className="mt-1 text-slate-100">{node.source_table}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-400">关联度</dt>
                  <dd className="mt-1 text-slate-100">{node.degree}</dd>
                </div>
              </div>
              <div>
                <dt className="text-xs text-slate-400">类名</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-200">
                  {node.class_name ?? "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-100">字段值</h2>
            {Object.keys(node.field_values).length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">没有可显示的字段值。</p>
            ) : (
              <dl className="mt-3 divide-y divide-slate-700/70 overflow-hidden rounded-lg border border-slate-700/70">
                {Object.entries(node.field_values).map(([key, value]) => (
                  <div key={key} className="px-3 py-2.5">
                    <dt className="font-mono text-xs text-teal-200">{key}</dt>
                    <dd
                      className={`mt-1 whitespace-pre-wrap break-words font-mono text-xs ${
                        value === null ? "italic text-slate-500" : "text-slate-200"
                      }`}
                    >
                      {fieldValue(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-100">直接关系</h2>
            {relations.length === 0 ? (
              <p className="mt-3 text-sm text-slate-400">没有直接关系。</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {relations.map(({ edge, node: relatedNode, nodeId }, index) => (
                  <li
                    key={`${edge.source}-${edge.target}-${edge.labels.join("-")}-${edge.confidence}-${index}`}
                  >
                    <button
                      type="button"
                      onClick={() => requestNodeFocus(nodeId)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-3 text-left transition-colors hover:border-teal-500/70 hover:bg-slate-800"
                    >
                      <span className="block break-all font-mono text-xs text-teal-200">
                        {nodeId}
                      </span>
                      {relatedNode && (
                        <span className="mt-1 block text-xs text-slate-400">
                          {relatedNode.source_table}
                        </span>
                      )}
                      <span className="mt-2 block text-xs text-slate-200">
                        {edge.labels.join(" · ") || "关联"}
                      </span>
                      <span className="mt-1 block text-xs text-slate-400">
                        {`置信度 ${confidenceLabel(edge.confidence)}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="px-5 py-5">
          <h2 className="text-sm font-semibold text-slate-100">图谱概览</h2>
          {graph ? (
            <p className="mt-2 text-sm text-slate-400">
              {`${graph.nodes.length} 个节点 · ${graph.edges.length} 条关系`}
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-400">图谱生成后将在此处显示概览。</p>
          )}
          <p className="mt-4 rounded-lg border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">
            选择一个节点查看详情
          </p>
        </div>
      )}
    </aside>
  );
}
