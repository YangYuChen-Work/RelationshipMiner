import type { SemanticGraphData } from "../api/analysis";

/**
 * Produces the graph shown in the workbench without altering the API snapshot.
 * Table-level structure and relationship data remain complete; only entity dots
 * with no entity-edge endpoint are omitted when requested.
 */
export function projectGraph(
  graph: SemanticGraphData,
  showIsolatedNodes: boolean,
): SemanticGraphData {
  const entityIds = new Set(graph.entity_nodes.map((node) => node.id));
  const entityEdges = graph.entity_edges.filter(
    (edge) => entityIds.has(edge.source) && entityIds.has(edge.target),
  );

  if (showIsolatedNodes) {
    return {
      table_nodes: [...graph.table_nodes],
      entity_nodes: [...graph.entity_nodes],
      table_edges: [...graph.table_edges],
      entity_edges: entityEdges,
    };
  }

  const connectedEntityIds = new Set<string>();
  for (const edge of entityEdges) {
    connectedEntityIds.add(edge.source);
    connectedEntityIds.add(edge.target);
  }

  return {
    table_nodes: [...graph.table_nodes],
    entity_nodes: graph.entity_nodes.filter((node) => connectedEntityIds.has(node.id)),
    table_edges: [...graph.table_edges],
    entity_edges: entityEdges,
  };
}
