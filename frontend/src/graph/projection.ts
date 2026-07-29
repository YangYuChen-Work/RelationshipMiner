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
  if (showIsolatedNodes) {
    return {
      table_nodes: [...graph.table_nodes],
      entity_nodes: [...graph.entity_nodes],
      table_edges: [...graph.table_edges],
      entity_edges: [...graph.entity_edges],
    };
  }

  const connectedEntityIds = new Set<string>();
  for (const edge of graph.entity_edges) {
    connectedEntityIds.add(edge.source);
    connectedEntityIds.add(edge.target);
  }

  return {
    table_nodes: [...graph.table_nodes],
    entity_nodes: graph.entity_nodes.filter((node) => connectedEntityIds.has(node.id)),
    table_edges: [...graph.table_edges],
    entity_edges: [...graph.entity_edges],
  };
}
