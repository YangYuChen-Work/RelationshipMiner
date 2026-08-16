import { useMemo } from "react";
import { useAnalysisStore } from "../store/analysis";
import { businessRelationLabel } from "../graph/businessRelations";
import { buildBusinessPresentationIndex } from "../graph/businessPresentation";
import { buildBusinessTablePresentationIndex } from "../graph/businessTables";
import { computeEntityDegrees } from "../graph/semantics";

export default function DataChainStrip() {
  const graph = useAnalysisStore((state) => state.graph);
  const tableSummaries = useAnalysisStore((state) => state.tableSummaries);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const selectedEntityEdgeId = useAnalysisStore((state) => state.selectedEntityEdgeId);
  const selectedTableEdgeId = useAnalysisStore((state) => state.selectedTableEdgeId);

  const chain = useMemo(() => {
    if (!graph) return null;

    const presentations = buildBusinessPresentationIndex(
      graph.entity_nodes,
      computeEntityDegrees(graph.entity_nodes, graph.entity_edges),
    );
    const tablePresentations = buildBusinessTablePresentationIndex(
      graph.table_nodes,
      tableSummaries,
    );

    const entityEdge = graph.entity_edges.find((edge) => edge.id === selectedEntityEdgeId);
    if (entityEdge) {
      return {
        source: presentations.get(entityEdge.source)?.primary ?? "未命名对象",
        target: presentations.get(entityEdge.target)?.primary ?? "未命名对象",
        relation: entityEdge.relations
          .map(businessRelationLabel)
          .filter(Boolean)
          .join(" · ") || "相关",
      };
    }

    const tableEdge = graph.table_edges.find((edge) => edge.id === selectedTableEdgeId);
    if (tableEdge) {
      return {
        source: tablePresentations.get(tableEdge.source_table) ?? "业务数据集",
        target: tablePresentations.get(tableEdge.target_table) ?? "业务数据集",
        relation: tableEdge.relation_types
          .map((relation_type) => businessRelationLabel({ relation_type }))
          .filter(Boolean)
          .join(" · ") || "相关",
      };
    }

    if (selectedNodeId) {
      const node = graph.entity_nodes.find((candidate) => candidate.id === selectedNodeId);
      const adjacent = graph.entity_edges.find(
        (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
      );
      if (node && adjacent) {
        const targetId = adjacent.source === selectedNodeId ? adjacent.target : adjacent.source;
        return {
          source: presentations.get(node.id)?.primary ?? node.display_name,
          target: presentations.get(targetId)?.primary ?? "未命名对象",
          relation: adjacent.relations
            .map(businessRelationLabel)
            .filter(Boolean)
            .join(" · ") || "相关",
        };
      }
      if (node) {
        return { source: node.display_name, target: "暂无相邻对象", relation: "等待更多关系" };
      }
    }

    return null;
  }, [graph, selectedEntityEdgeId, selectedNodeId, selectedTableEdgeId, tableSummaries]);

  return (
    <section className="data-chain-strip" aria-label="当前数据链路">
      <div className="data-chain-caption">
        <span className="data-chain-signal" aria-hidden="true" />
        <div>
          <p className="data-chain-label">当前数据链路</p>
          <p className="data-chain-hint">
            {chain ? "从业务关系回看数据流向" : "选择对象或关系，查看它的链路"}
          </p>
        </div>
      </div>
      {chain ? (
        <div className="data-chain-path">
          <span className="data-chain-node">从 · {chain.source}</span>
          <span className="data-chain-relation">关系 · {chain.relation}</span>
          <span className="data-chain-node">至 · {chain.target}</span>
        </div>
      ) : (
        <div className="data-chain-empty">
          {graph?.entity_nodes.length ?? 0} 个业务对象 · {graph?.entity_edges.length ?? 0} 条可追溯关系
        </div>
      )}
    </section>
  );
}
