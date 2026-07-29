import type {
  EntityEdgeData,
  EntityNodeData,
  SemanticGraphData,
  TableEdgeData,
} from "../api/analysis";

export interface Viewport {
  width: number;
  height: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface TableRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  header: LayoutPoint;
}

export interface LayoutTableNode extends LayoutPoint {
  id: string;
}

export interface LayoutEntityNode extends LayoutPoint {
  id: string;
  tableId: string;
}

export interface LayoutEdge {
  id: string;
  source: string;
  target: string;
  from: LayoutPoint;
  to: LayoutPoint;
}

export interface GraphLayout {
  tableRegions: TableRegion[];
  tableNodes: LayoutTableNode[];
  entityNodes: LayoutEntityNode[];
  tableEdges: LayoutEdge[];
  entityEdges: LayoutEdge[];
}

export type LayoutGraph = Pick<
  SemanticGraphData,
  "table_nodes" | "entity_nodes" | "table_edges" | "entity_edges"
>;

const OUTER_MARGIN = 48;
const REGION_GAP = 48;
const REGION_PADDING = 28;
const HEADER_HEIGHT = 42;
const ENTITY_PITCH = 24;
const MIN_REGION_WIDTH = 280;
const MIN_REGION_HEIGHT = 180;

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertUniqueIds(
  collection: readonly { id: string }[],
  label: string,
) {
  const seen = new Set<string>();
  for (const item of collection) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate ${label} id "${item.id}".`);
    }
    seen.add(item.id);
  }
}

function sortedEntitiesByTable(
  entities: readonly EntityNodeData[],
  tableIds: ReadonlySet<string>,
): Map<string, EntityNodeData[]> {
  const byTable = new Map<string, EntityNodeData[]>();
  for (const entity of entities) {
    if (!tableIds.has(entity.table_id)) continue;
    const group = byTable.get(entity.table_id);
    if (group) group.push(entity);
    else byTable.set(entity.table_id, [entity]);
  }
  for (const group of byTable.values()) {
    group.sort((left, right) => compareIds(left.id, right.id));
  }
  return byTable;
}

function gridColumns(count: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(count)));
}

function routeTableEdges(
  edges: readonly TableEdgeData[],
  headers: ReadonlyMap<string, LayoutPoint>,
): LayoutEdge[] {
  return [...edges]
    .sort((left, right) => compareIds(left.id, right.id))
    .flatMap((edge) => {
      const from = headers.get(edge.source_table);
      const to = headers.get(edge.target_table);
      if (!from || !to) return [];
      return [{ id: edge.id, source: edge.source_table, target: edge.target_table, from, to }];
    });
}

function routeEntityEdges(
  edges: readonly EntityEdgeData[],
  entities: ReadonlyMap<string, LayoutPoint>,
): LayoutEdge[] {
  return [...edges]
    .sort((left, right) => compareIds(left.id, right.id))
    .flatMap((edge) => {
      const from = entities.get(edge.source);
      const to = entities.get(edge.target);
      if (!from || !to) return [];
      return [{ id: edge.id, source: edge.source, target: edge.target, from, to }];
    });
}

/**
 * Builds an order-independent, non-physics layout.  Table regions deliberately
 * use a common size: changing an entity count cannot move another table.
 */
export function computeGroupedLayout(
  graph: LayoutGraph,
  _viewport: Viewport,
): GraphLayout {
  assertUniqueIds(graph.table_nodes, "table node");
  assertUniqueIds(graph.entity_nodes, "entity node");
  assertUniqueIds(graph.table_edges, "table edge");
  assertUniqueIds(graph.entity_edges, "entity edge");

  const tableIds = graph.table_nodes.map((node) => node.id).sort(compareIds);
  const tableIdSet = new Set(tableIds);
  const entitiesByTable = sortedEntitiesByTable(graph.entity_nodes, tableIdSet);
  const largestGroup = Math.max(
    0,
    ...tableIds.map((id) => entitiesByTable.get(id)?.length ?? 0),
  );
  const entityColumns = gridColumns(largestGroup);
  const entityRows = Math.max(1, Math.ceil(largestGroup / entityColumns));
  const regionWidth = Math.max(
    MIN_REGION_WIDTH,
    REGION_PADDING * 2 + entityColumns * ENTITY_PITCH,
  );
  const regionHeight = Math.max(
    MIN_REGION_HEIGHT,
    HEADER_HEIGHT + REGION_PADDING * 2 + entityRows * ENTITY_PITCH,
  );
  const columns = gridColumns(tableIds.length);
  const tableRegions: TableRegion[] = [];
  const tableNodes: LayoutTableNode[] = [];
  const entityNodes: LayoutEntityNode[] = [];
  const headers = new Map<string, LayoutPoint>();
  const entityPositions = new Map<string, LayoutPoint>();

  tableIds.forEach((id, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = OUTER_MARGIN + column * (regionWidth + REGION_GAP);
    const y = OUTER_MARGIN + row * (regionHeight + REGION_GAP);
    const header = { x: x + REGION_PADDING, y: y + HEADER_HEIGHT / 2 };
    const region = { id, x, y, width: regionWidth, height: regionHeight, header };
    tableRegions.push(region);
    tableNodes.push({ id, ...header });
    headers.set(id, header);

    const entities = entitiesByTable.get(id) ?? [];
    entities.forEach((entity, entityIndex) => {
      const entityColumn = entityIndex % entityColumns;
      const entityRow = Math.floor(entityIndex / entityColumns);
      const position = {
        x: x + REGION_PADDING + ENTITY_PITCH / 2 + entityColumn * ENTITY_PITCH,
        y:
          y +
          HEADER_HEIGHT +
          REGION_PADDING +
          ENTITY_PITCH / 2 +
          entityRow * ENTITY_PITCH,
      };
      entityNodes.push({ id: entity.id, tableId: id, ...position });
      entityPositions.set(entity.id, position);
    });
  });

  return {
    tableRegions,
    tableNodes,
    entityNodes,
    tableEdges: routeTableEdges(graph.table_edges, headers),
    entityEdges: routeEntityEdges(graph.entity_edges, entityPositions),
  };
}
