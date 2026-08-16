import { useState, type ReactNode } from "react";
import type {
  EntityEdgeData,
  EntityNodeData,
  EntityRelationData,
  SemanticGraphData,
  TableEdgeData,
} from "../api/analysis";
import {
  buildBusinessPresentationIndex,
  type BusinessEntityPresentation,
} from "../graph/businessPresentation";
import {
  businessRelationLabel,
  confidenceBand,
} from "../graph/businessRelations";
import { computeEntityDegrees } from "../graph/semantics";
import { buildBusinessTablePresentationIndex } from "../graph/businessTables";
import { useAnalysisStore } from "../store/analysis";

function fieldValue(value: unknown): string {
  if (value === null) return "NULL";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function confidenceLabel(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function relationLabels(relations: readonly EntityRelationData[]): string {
  return [...new Set(relations.map(businessRelationLabel))].sort().join(" · ") || "相关";
}

function relationBusinessSummary(relation: EntityRelationData): string {
  const methods = new Set(relation.evidence.map((evidence) => evidence.method));
  if (methods.has("foreign_key")) {
    return "两个业务对象通过已确认的数据引用建立关系。";
  }
  if (methods.has("unique_identifier")) {
    return "两个业务对象通过唯一业务标识建立对应关系。";
  }
  if (methods.has("relation_table")) {
    return "业务系统记录了这两个对象之间的结构关系。";
  }
  return "所选业务信息支持这两个对象之间的关系。";
}

function evidenceBusinessSummary(method: EntityRelationData["evidence"][number]["method"]): string {
  if (method === "foreign_key") return "已确认存在稳定的数据引用。";
  if (method === "unique_identifier") return "唯一业务标识匹配。";
  if (method === "relation_table") return "业务结构记录提供支持。";
  return "所选业务信息能够相互印证。";
}

function Disclosure({
  summary,
  children,
}: {
  summary: "技术依据" | "查看原始数据";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} className="mt-3 rounded border border-slate-700/70 px-3 py-2 text-xs">
      <summary
        className="cursor-pointer select-none text-teal-200"
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
      >
        {summary}
      </summary>
      {open ? <div className="mt-3">{children}</div> : null}
    </details>
  );
}

function RawDimensions({
  title,
  dimensions,
}: {
  title: string;
  dimensions: Record<string, unknown>;
}) {
  return (
    <section className="mt-3 first:mt-0">
      <h4 className="font-semibold text-slate-200">{title}</h4>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-slate-300">
        {JSON.stringify(dimensions, null, 2)}
      </pre>
    </section>
  );
}

function RelationDetails({
  relation,
  source,
  target,
}: {
  relation: EntityRelationData;
  source: EntityNodeData;
  target: EntityNodeData;
}) {
  return (
    <article className="rounded-lg border border-slate-700/70 bg-slate-900/50 p-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <h4 className="font-semibold text-slate-100">
          {businessRelationLabel(relation)}
        </h4>
        <span
          aria-label={`关系可靠程度：${confidenceBand(relation.confidence)}`}
          className="rounded-full bg-teal-400/10 px-2 py-1 text-xs text-teal-200"
        >
          {confidenceBand(relation.confidence)}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-slate-200">
        {relationBusinessSummary(relation)}
      </p>
      <div className="mt-3">
        <p className="text-xs text-slate-400">关系证据</p>
        {relation.evidence.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">暂无补充证据。</p>
        ) : (
          <ul className="mt-2 space-y-2 text-xs text-slate-300">
            {relation.evidence.map((evidence, index) => (
              <li
                key={`${evidence.source_field}-${evidence.target_field}-${index}`}
                className="rounded border border-slate-700/60 px-2 py-2"
              >
                {evidenceBusinessSummary(evidence.method)}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Disclosure summary="技术依据">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-slate-300">
          <div><dt className="text-slate-500">原始关系类型</dt><dd className="break-all font-mono">{relation.relation_type || "—"}</dd></div>
          <div><dt className="text-slate-500">可靠程度数值</dt><dd>{confidenceLabel(relation.confidence)}</dd></div>
          <div><dt className="text-slate-500">方向</dt><dd>{relation.direction}</dd></div>
          <div><dt className="text-slate-500">强度</dt><dd>{relation.strength}</dd></div>
          <div><dt className="text-slate-500">源 class_name</dt><dd className="break-all font-mono">{source.class_name ?? "—"}</dd></div>
          <div><dt className="text-slate-500">目标 class_name</dt><dd className="break-all font-mono">{target.class_name ?? "—"}</dd></div>
          <div><dt className="text-slate-500">模型 ID</dt><dd className="break-all font-mono">{relation.model_id ?? "—"}</dd></div>
          <div><dt className="text-slate-500">任务 ID</dt><dd className="break-all font-mono">{relation.task_id ?? "—"}</dd></div>
          <div className="col-span-2"><dt className="text-slate-500">原始解释</dt><dd className="whitespace-pre-wrap break-all font-mono">{relation.explanation || "—"}</dd></div>
        </dl>
        {relation.evidence.length > 0 ? (
          <div className="mt-3 space-y-2">
            {relation.evidence.map((evidence, index) => (
              <dl
                key={`${evidence.source_field}-${evidence.target_field}-${index}`}
                className="rounded border border-slate-700/60 px-2 py-2"
              >
                <div><dt className="inline text-slate-500">源字段：</dt><dd className="inline font-mono">{evidence.source_field} = {fieldValue(evidence.source_value)}</dd></div>
                <div><dt className="inline text-slate-500">目标字段：</dt><dd className="inline font-mono">{evidence.target_field} = {fieldValue(evidence.target_value)}</dd></div>
                <div><dt className="inline text-slate-500">匹配方法：</dt><dd className="inline font-mono">{evidence.method}</dd></div>
                <div><dt className="inline text-slate-500">原始说明：</dt><dd className="inline whitespace-pre-wrap font-mono">{evidence.reason || "—"}</dd></div>
              </dl>
            ))}
          </div>
        ) : null}
      </Disclosure>
    </article>
  );
}

function EntityEdgeDetails({
  edge,
  graph,
  presentations,
}: {
  edge: EntityEdgeData;
  graph: SemanticGraphData;
  presentations: ReadonlyMap<string, BusinessEntityPresentation>;
}) {
  const entities = new Map(graph.entity_nodes.map((entity) => [entity.id, entity]));
  const source = entities.get(edge.source);
  const target = entities.get(edge.target);
  if (!source || !target) return null;
  const sourcePresentation = presentations.get(source.id);
  const targetPresentation = presentations.get(target.id);
  const sourceName = sourcePresentation?.primary ?? source.display_name;
  const targetName = targetPresentation?.primary ?? target.display_name;
  return (
    <div className="space-y-5 px-5 py-5">
      <section>
        <p className="text-xs text-slate-400">实体关系</p>
        <h2 className="mt-2 text-base font-semibold text-slate-100">
          {sourceName} → {targetName}
        </h2>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-100">全部关系 ({edge.relations.length})</h3>
        {edge.relations.map((relation, index) => (
          <RelationDetails
            key={`${relation.relation_type}-${index}`}
            relation={relation}
            source={source}
            target={target}
          />
        ))}
      </section>
      <Disclosure summary="查看原始数据">
        <RawDimensions title={sourceName} dimensions={source.dimensions} />
        <RawDimensions title={targetName} dimensions={target.dimensions} />
      </Disclosure>
    </div>
  );
}

function TableEdgeDetails({
  edge,
  graph,
  presentations,
  tablePresentations,
}: {
  edge: TableEdgeData;
  graph: SemanticGraphData;
  presentations: ReadonlyMap<string, BusinessEntityPresentation>;
  tablePresentations: ReadonlyMap<string, string>;
}) {
  const selectEntityEdge = useAnalysisStore((state) => state.selectEntityEdge);
  const requestNodeFocus = useAnalysisStore((state) => state.requestNodeFocus);
  const edges = new Map(graph.entity_edges.map((entityEdge) => [entityEdge.id, entityEdge]));
  const sourceTable = tablePresentations.get(edge.source_table) ?? "业务数据集";
  const targetTable = tablePresentations.get(edge.target_table) ?? "业务数据集";
  const supportingEdges = edge.supporting_entity_edges.flatMap((edgeId) => {
    const supporting = edges.get(edgeId);
    return supporting ? [supporting] : [];
  });
  const labels = supportingEdges.length > 0
    ? relationLabels(supportingEdges.flatMap((supporting) => supporting.relations))
    : [...new Set(edge.relation_types.map((relation_type) =>
      businessRelationLabel({ relation_type })
    ))].sort().join(" · ") || "相关";
  return (
    <div className="space-y-5 px-5 py-5">
      <section>
        <h2 className="text-sm font-semibold text-slate-100">业务数据关系</h2>
        <p className="mt-2 text-sm text-slate-300">{sourceTable} → {targetTable}</p>
      </section>
      <dl className="grid grid-cols-2 gap-3 rounded-lg border border-slate-700/70 p-3 text-sm">
        <div><dt className="text-xs text-slate-400">业务关系</dt><dd>{labels}</dd></div>
        <div><dt className="text-xs text-slate-400">关系可靠程度</dt><dd>{confidenceBand(edge.average_confidence)}</dd></div>
        <div><dt className="text-xs text-slate-400">明确关系</dt><dd>{edge.strong_count}</dd></div>
        <div><dt className="text-xs text-slate-400">可能有关</dt><dd>{edge.weak_count}</dd></div>
        <div><dt className="text-xs text-slate-400">支持对象对</dt><dd>{edge.entity_edge_count}</dd></div>
      </dl>
      <section>
        <h3 className="text-sm font-semibold text-slate-100">支持此汇总的对象关系</h3>
        {edge.supporting_entity_edges.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">没有可聚焦的支持关系。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {edge.supporting_entity_edges.map((edgeId) => {
              const supporting = edges.get(edgeId);
              if (!supporting) {
                return (
                  <li key={edgeId}>
                    <button type="button" disabled className="w-full cursor-not-allowed rounded border border-slate-800 px-3 py-2 text-left text-xs text-slate-500">
                      支撑关系不可用
                    </button>
                  </li>
                );
              }
              const sourceName = presentations.get(supporting.source)?.primary ?? "未命名对象";
              const targetName = presentations.get(supporting.target)?.primary ?? "未命名对象";
              return (
                <li key={edgeId}>
                  <button
                    type="button"
                    className="w-full rounded border border-slate-700 px-3 py-2 text-left text-xs text-teal-200 hover:border-teal-400"
                    onClick={() => {
                      requestNodeFocus(supporting.source);
                      selectEntityEdge(edgeId);
                    }}
                  >
                    <span className="block text-sm text-slate-100">{sourceName} → {targetName}</span>
                    <span className="mt-1 block">{relationLabels(supporting.relations)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <Disclosure summary="技术依据">
        <dl className="space-y-2 text-slate-300">
          <div><dt className="text-slate-500">源表 ID</dt><dd className="font-mono">{edge.source_table}</dd></div>
          <div><dt className="text-slate-500">目标表 ID</dt><dd className="font-mono">{edge.target_table}</dd></div>
          <div><dt className="text-slate-500">原始关系类型</dt><dd className="font-mono">{edge.relation_types.join(" · ") || "—"}</dd></div>
          <div><dt className="text-slate-500">平均可靠程度数值</dt><dd>{confidenceLabel(edge.average_confidence)}</dd></div>
          <div><dt className="text-slate-500">支持关系 ID</dt><dd className="break-all font-mono">{edge.supporting_entity_edges.join(" · ") || "—"}</dd></div>
        </dl>
      </Disclosure>
    </div>
  );
}

function NodeDetails({
  node,
  graph,
  presentations,
}: {
  node: EntityNodeData;
  graph: SemanticGraphData;
  presentations: ReadonlyMap<string, BusinessEntityPresentation>;
}) {
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);
  const requestNodeFocus = useAnalysisStore((state) => state.requestNodeFocus);
  const relations = graph.entity_edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const presentation = presentations.get(node.id);
  return (
    <div className="space-y-6 px-5 py-5">
      <section>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400">业务对象</p>
            <h2 className="mt-1 text-base font-semibold text-slate-100">
              {presentation?.primary ?? node.display_name}
            </h2>
            {presentation?.secondary ? <p className="mt-1 text-xs text-slate-400">{presentation.secondary}</p> : null}
          </div>
          <button type="button" onClick={() => setSelectedNode(null)} className="rounded p-1 text-slate-400 hover:bg-slate-800 lg:hidden" aria-label="关闭节点详情">×</button>
        </div>
        <Disclosure summary="技术依据">
          <dl className="space-y-2 text-slate-300">
            <div><dt className="text-slate-500">完整 ID</dt><dd className="break-all font-mono">{node.id}</dd></div>
            <div><dt className="text-slate-500">表 ID</dt><dd className="font-mono">{node.table_id}</dd></div>
            <div><dt className="text-slate-500">class_name</dt><dd className="break-all font-mono">{node.class_name ?? "—"}</dd></div>
            <div><dt className="text-slate-500">显示代码</dt><dd className="font-mono">{node.display_code ?? "—"}</dd></div>
          </dl>
        </Disclosure>
        <Disclosure summary="查看原始数据">
          <RawDimensions title="完整字段" dimensions={node.dimensions} />
        </Disclosure>
      </section>
      <section>
        <h3 className="text-sm font-semibold text-slate-100">直接关系</h3>
        {relations.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">没有直接关系。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {relations.map((edge) => {
              const targetId = edge.source === node.id ? edge.target : edge.source;
              const target = presentations.get(targetId);
              return (
                <li key={edge.id}>
                  <button type="button" onClick={() => requestNodeFocus(targetId)} className="w-full rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-3 text-left hover:border-teal-500/70">
                    <span className="block text-sm text-slate-100">{target?.primary ?? "未命名对象"}</span>
                    {target?.secondary ? <span className="mt-1 block text-xs text-slate-500">{target.secondary}</span> : null}
                    <span className="mt-1 block text-xs text-teal-200">{relationLabels(edge.relations)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function NodeDetailPanel() {
  const graph = useAnalysisStore((state) => state.graph);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const selectedEntityEdgeId = useAnalysisStore((state) => state.selectedEntityEdgeId);
  const selectedTableEdgeId = useAnalysisStore((state) => state.selectedTableEdgeId);
  const tableSummaries = useAnalysisStore((state) => state.tableSummaries);
  const node = graph?.entity_nodes.find((item) => item.id === selectedNodeId);
  const entityEdge = graph?.entity_edges.find((edge) => edge.id === selectedEntityEdgeId);
  const tableEdge = graph?.table_edges.find((edge) => edge.id === selectedTableEdgeId);
  const hasSelection = Boolean(node || entityEdge || tableEdge);
  const presentations = graph
    ? buildBusinessPresentationIndex(
      graph.entity_nodes,
      computeEntityDegrees(graph.entity_nodes, graph.entity_edges),
    )
    : new Map<string, BusinessEntityPresentation>();
  const tablePresentations = graph
    ? buildBusinessTablePresentationIndex(graph.table_nodes, tableSummaries)
    : new Map<string, string>();

  return (
    <aside className={`${hasSelection ? "fixed inset-y-0 right-0 z-40 w-full max-w-sm shadow-2xl lg:static lg:w-auto lg:max-w-none lg:shadow-none" : "hidden lg:block"} min-h-0 overflow-y-auto border-l border-slate-700/70 bg-[#101c2a]`} aria-label="关系详情检查器">
      <header className="border-b border-slate-700/70 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-300">关系详情</p>
        <p className="mt-1 text-sm text-slate-400">先看业务含义，需要时再展开技术依据和原始数据。</p>
      </header>
      {graph && entityEdge ? (
        <EntityEdgeDetails edge={entityEdge} graph={graph} presentations={presentations} />
      ) : graph && tableEdge ? (
        <TableEdgeDetails
          edge={tableEdge}
          graph={graph}
          presentations={presentations}
          tablePresentations={tablePresentations}
        />
      ) : graph && node ? (
        <NodeDetails node={node} graph={graph} presentations={presentations} />
      ) : (
        <div className="px-5 py-5">
          <h2 className="text-sm font-semibold text-slate-100">图谱概览</h2>
          {graph ? (
            <p className="mt-2 text-sm text-slate-400">{graph.table_nodes.length} 张表 · {graph.entity_nodes.length} 个实体 · {graph.table_edges.length} 条表关系 · {graph.entity_edges.length} 条实体关系</p>
          ) : (
            <p className="mt-2 text-sm text-slate-400">图谱生成后将在此处显示概览。</p>
          )}
          <p className="mt-4 rounded-lg border border-dashed border-slate-700 px-3 py-4 text-sm text-slate-400">选择一项查看详情。</p>
        </div>
      )}
    </aside>
  );
}
