import type {
  EntityEdgeData,
  EntityNodeData,
  EntityRelationData,
  SemanticGraphData,
  TableEdgeData,
} from "../api/analysis";
import { useAnalysisStore } from "../store/analysis";

function fieldValue(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function shortClassName(className: string | null): string | null {
  if (!className) return null;
  return className.split(/[.$]/).filter(Boolean).at(-1) ?? className;
}

function entityLabel(entity: EntityNodeData): string {
  const shortName = shortClassName(entity.class_name);
  return shortName ? `${entity.table_id} · ${shortName}` : entity.table_id;
}

function directionLabel(direction: EntityRelationData["direction"]): string {
  return {
    source_to_target: "源 → 目标",
    target_to_source: "目标 → 源",
    undirected: "无方向",
  }[direction];
}

function RelationDetails({ relation }: { relation: EntityRelationData }) {
  return (
    <article className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-3 text-sm">
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div><dt className="text-xs text-slate-400">关系类型</dt><dd>{relation.relation_type}</dd></div>
        <div><dt className="text-xs text-slate-400">方向</dt><dd>{directionLabel(relation.direction)}</dd></div>
        <div><dt className="text-xs text-slate-400">强度</dt><dd>{relation.strength}</dd></div>
        <div><dt className="text-xs text-slate-400">置信度</dt><dd>{confidenceLabel(relation.confidence)}</dd></div>
        <div><dt className="text-xs text-slate-400">模型 ID</dt><dd className="break-all font-mono text-xs">{relation.model_id ?? "—"}</dd></div>
        <div><dt className="text-xs text-slate-400">任务 ID</dt><dd className="break-all font-mono text-xs">{relation.task_id ?? "—"}</dd></div>
      </dl>
      <p className="mt-3 text-xs text-slate-400">解释</p>
      <p className="mt-1 whitespace-pre-wrap text-slate-200">{relation.explanation || "—"}</p>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-slate-400">证据字段和值</p>
        {relation.evidence.length === 0 ? (
          <p className="text-xs text-slate-500">未提供字段级证据。</p>
        ) : relation.evidence.map((evidence, index) => (
          <dl key={`${evidence.source_field}-${evidence.target_field}-${index}`} className="rounded border border-slate-700/60 px-2 py-2 text-xs">
            <div><dt className="inline text-slate-400">源字段：</dt><dd className="inline font-mono text-slate-200">{evidence.source_field} = {fieldValue(evidence.source_value)}</dd></div>
            <div className="mt-1"><dt className="inline text-slate-400">目标字段：</dt><dd className="inline font-mono text-slate-200">{evidence.target_field} = {fieldValue(evidence.target_value)}</dd></div>
            <p className="mt-1 text-slate-400">{evidence.method}：{evidence.reason}</p>
          </dl>
        ))}
      </div>
    </article>
  );
}

function EntityEdgeDetails({ edge, graph }: { edge: EntityEdgeData; graph: SemanticGraphData }) {
  const entities = new Map(graph.entity_nodes.map((entity) => [entity.id, entity]));
  return (
    <div className="space-y-5 px-5 py-5">
      <section>
        <h2 className="text-sm font-semibold text-slate-100">实体关系详情</h2>
        <p className="mt-2 break-all font-mono text-xs text-teal-200">{edge.id}</p>
        <p className="mt-2 text-sm text-slate-300">
          {entities.get(edge.source)?.display_name ?? edge.source} → {entities.get(edge.target)?.display_name ?? edge.target}
        </p>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">全部关系 ({edge.relations.length})</h3>
        {edge.relations.map((relation, index) => <RelationDetails key={`${relation.relation_type}-${index}`} relation={relation} />)}
      </section>
    </div>
  );
}

function TableEdgeDetails({ edge, graph }: { edge: TableEdgeData; graph: SemanticGraphData }) {
  const selectEntityEdge = useAnalysisStore((state) => state.selectEntityEdge);
  const requestNodeFocus = useAnalysisStore((state) => state.requestNodeFocus);
  const edges = new Map(graph.entity_edges.map((entityEdge) => [entityEdge.id, entityEdge]));
  return (
    <div className="space-y-5 px-5 py-5">
      <section>
        <h2 className="text-sm font-semibold text-slate-100">表关系汇总</h2>
        <p className="mt-2 text-sm text-slate-300">{edge.source_table} → {edge.target_table}</p>
      </section>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700/70 p-3 text-sm">
        <div><dt className="text-xs text-slate-400">关系类型</dt><dd>{edge.relation_types.join(" · ") || "—"}</dd></div>
        <div><dt className="text-xs text-slate-400">平均置信度</dt><dd>{confidenceLabel(edge.average_confidence)}</dd></div>
        <div><dt className="text-xs text-slate-400">强关系</dt><dd>{edge.strong_count}</dd></div>
        <div><dt className="text-xs text-slate-400">弱关系</dt><dd>{edge.weak_count}</dd></div>
        <div><dt className="text-xs text-slate-400">支持实体边</dt><dd>{edge.entity_edge_count}</dd></div>
      </dl>
      <section>
        <h3 className="text-sm font-semibold text-slate-100">支持此汇总的实体关系</h3>
        {edge.supporting_entity_edges.length === 0 ? <p className="mt-2 text-sm text-slate-400">没有可聚焦的支持关系。</p> : (
          <ul className="mt-3 space-y-2">
            {edge.supporting_entity_edges.map((edgeId) => {
              const supportingEdge = edges.get(edgeId);
              return <li key={edgeId}><button type="button" className="w-full rounded border border-slate-700 px-3 py-2 text-left font-mono text-xs text-teal-200 hover:border-teal-400" onClick={() => {
                selectEntityEdge(edgeId);
                if (supportingEdge) requestNodeFocus(supportingEdge.source);
              }}>{edgeId}</button></li>;
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function NodeDetails({ node, graph }: { node: EntityNodeData; graph: SemanticGraphData }) {
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);
  const requestNodeFocus = useAnalysisStore((state) => state.requestNodeFocus);
  const relations = graph.entity_edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  return (
    <div className="space-y-6 px-5 py-5">
      <section>
        <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold text-slate-100">节点概览</h2><button type="button" onClick={() => setSelectedNode(null)} className="rounded p-1 text-slate-400 hover:bg-slate-800 lg:hidden" aria-label="关闭节点详情">×</button></div>
        <dl className="mt-3 space-y-3 text-sm">
          <div><dt className="text-xs text-slate-400">完整 ID</dt><dd className="mt-1 break-all font-mono text-xs text-slate-100">{node.id}</dd></div>
          <div><dt className="text-xs text-slate-400">实体类型</dt><dd className="mt-1 text-slate-100">{entityLabel(node)}</dd></div>
          <div><dt className="text-xs text-slate-400">显示名称</dt><dd className="mt-1 text-slate-100">{node.display_name}</dd></div>
        </dl>
      </section>
      <section><h2 className="text-sm font-semibold text-slate-100">字段值</h2>{Object.keys(node.dimensions).length === 0 ? <p className="mt-3 text-sm text-slate-400">没有可显示的字段值。</p> : <dl className="mt-3 divide-y divide-slate-700/70 overflow-hidden rounded-lg border border-slate-700/70">{Object.entries(node.dimensions).map(([key, value]) => <div key={key} className="px-3 py-2.5"><dt className="font-mono text-xs text-teal-200">{key}</dt><dd className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-slate-200">{fieldValue(value)}</dd></div>)}</dl>}</section>
      <section><h2 className="text-sm font-semibold text-slate-100">直接关系</h2>{relations.length === 0 ? <p className="mt-3 text-sm text-slate-400">没有直接关系。</p> : <ul className="mt-3 space-y-2">{relations.map((edge) => { const targetId = edge.source === node.id ? edge.target : edge.source; return <li key={edge.id}><button type="button" onClick={() => requestNodeFocus(targetId)} className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-3 text-left hover:border-teal-500/70"><span className="block break-all font-mono text-xs text-teal-200">{targetId}</span><span className="mt-1 block text-xs text-slate-400">{edge.relations.map((relation) => relation.relation_type).join(" · ") || "关系"}</span></button></li>; })}</ul>}</section>
    </div>
  );
}

export default function NodeDetailPanel() {
  const graph = useAnalysisStore((state) => state.graph);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const selectedEntityEdgeId = useAnalysisStore((state) => state.selectedEntityEdgeId);
  const selectedTableEdgeId = useAnalysisStore((state) => state.selectedTableEdgeId);
  const node = graph?.entity_nodes.find((item) => item.id === selectedNodeId);
  const entityEdge = graph?.entity_edges.find((edge) => edge.id === selectedEntityEdgeId);
  const tableEdge = graph?.table_edges.find((edge) => edge.id === selectedTableEdgeId);
  const hasSelection = Boolean(node || entityEdge || tableEdge);

  return <aside className={`${hasSelection ? "fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:static lg:w-auto lg:max-w-none lg:shadow-none" : "hidden lg:block"} min-h-0 overflow-y-auto border-l border-slate-700/70 bg-[#101c2a]`} aria-label="关系详情检查器">
    <header className="border-b border-slate-700/70 px-5 py-4"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">关系详情</p><p className="mt-1 text-sm text-slate-400">选择实体边、表边或节点以查看可追溯数据。</p></header>
    {graph && entityEdge ? <EntityEdgeDetails edge={entityEdge} graph={graph} /> : graph && tableEdge ? <TableEdgeDetails edge={tableEdge} graph={graph} /> : graph && node ? <NodeDetails node={node} graph={graph} /> : <div className="px-5 py-5"><h2 className="text-sm font-semibold text-slate-100">图谱概览</h2>{graph ? <p className="mt-2 text-sm text-slate-400">{graph.table_nodes.length} 张表 · {graph.entity_nodes.length} 个实体 · {graph.table_edges.length} 条表关系 · {graph.entity_edges.length} 条实体关系</p> : <p className="mt-2 text-sm text-slate-400">图谱生成后将在此处显示概览。</p>}<p className="mt-4 rounded-lg border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">选择一项查看详情</p></div>}
  </aside>;
}
