import type {
  EntityEdgeData,
  EntityNodeData,
  SemanticGraphData,
  TableEdgeData,
  TableNodeData,
} from "../api/analysis";
import { computeEntityDegrees } from "./semantics";

export interface Viewport {
  width: number;
  height: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
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
  tableNodes: LayoutTableNode[];
  entityNodes: LayoutEntityNode[];
  tableEdges: LayoutEdge[];
  entityEdges: LayoutEdge[];
}

export type LayoutGraph = Pick<
  SemanticGraphData,
  "table_nodes" | "entity_nodes" | "table_edges" | "entity_edges"
>;

const PROCESS_CLASS_ORDER = [
  "MEProcess",
  "MEOperation",
  "MEStep",
  "Assembly",
] as const;
const ANCHOR_MARGIN = 120;
const MIN_ANCHOR_GAP = 280;
const FIRST_RING_RADIUS = 72;
const RING_GAP = 32;
const ENTITY_ARC_PITCH = 24;

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

function processClassIndex(table: TableNodeData): number {
  const id = table.id.toLowerCase();
  const displayName = table.display_name.toLowerCase();
  const index = PROCESS_CLASS_ORDER.findIndex((known) => {
    const normalized = known.toLowerCase();
    return id === normalized || displayName === normalized;
  });
  return index < 0 ? PROCESS_CLASS_ORDER.length : index;
}

function sortedTables(tables: readonly TableNodeData[]): TableNodeData[] {
  return [...tables].sort((left, right) => {
    const leftIndex = processClassIndex(left);
    const rightIndex = processClassIndex(right);
    return leftIndex - rightIndex || compareIds(left.id, right.id);
  });
}

function entitiesByTable(
  entities: readonly EntityNodeData[],
  tables: readonly TableNodeData[],
  degrees: ReadonlyMap<string, number>,
): Map<string, EntityNodeData[]> {
  const tableIds = new Set(tables.map((table) => table.id));
  const groups = new Map<string, EntityNodeData[]>();
  for (const entity of entities) {
    if (!tableIds.has(entity.table_id)) continue;
    const group = groups.get(entity.table_id);
    if (group) group.push(entity);
    else groups.set(entity.table_id, [entity]);
  }
  for (const group of groups.values()) {
    group.sort((left, right) =>
      (degrees.get(right.id) ?? 0) - (degrees.get(left.id) ?? 0) ||
      compareIds(left.id, right.id),
    );
  }
  return groups;
}

function ringCapacity(radius: number): number {
  return Math.max(8, Math.floor((Math.PI * 2 * radius) / ENTITY_ARC_PITCH));
}

function clusterRadius(entityCount: number): number {
  if (entityCount <= 0) return FIRST_RING_RADIUS;
  let remaining = entityCount;
  let radius = FIRST_RING_RADIUS;
  while (remaining > ringCapacity(radius)) {
    remaining -= ringCapacity(radius);
    radius += RING_GAP;
  }
  return radius;
}

function normalizedViewport(viewport: Viewport): Viewport {
  return {
    width: Number.isFinite(viewport.width) && viewport.width > 0
      ? viewport.width
      : 1,
    height: Number.isFinite(viewport.height) && viewport.height > 0
      ? viewport.height
      : 1,
  };
}

function anchorColumns(tableCount: number, viewport: Viewport): number {
  if (tableCount === 0) return 1;
  const aspectRatio = Math.max(0.25, Math.min(4, viewport.width / viewport.height));
  return Math.max(1, Math.min(
    tableCount,
    Math.ceil(Math.sqrt(tableCount * aspectRatio)),
  ));
}

function placeEntities(
  entities: readonly EntityNodeData[],
  tableId: string,
  anchor: LayoutPoint,
): LayoutEntityNode[] {
  const nodes: LayoutEntityNode[] = [];
  let offset = 0;
  let radius = FIRST_RING_RADIUS;
  while (offset < entities.length) {
    const capacity = ringCapacity(radius);
    const count = Math.min(capacity, entities.length - offset);
    const angleOffset = (radius / RING_GAP % 2) * (Math.PI / capacity);
    for (let index = 0; index < count; index += 1) {
      const entity = entities[offset + index];
      const angle = Math.PI / 2 + angleOffset + (Math.PI * 2 * index) / capacity;
      nodes.push({
        id: entity.id,
        tableId,
        x: anchor.x + Math.cos(angle) * radius,
        y: anchor.y + Math.sin(angle) * radius,
      });
    }
    offset += count;
    radius += RING_GAP;
  }
  return nodes;
}

function routeTableEdges(
  edges: readonly TableEdgeData[],
  anchors: ReadonlyMap<string, LayoutPoint>,
): LayoutEdge[] {
  return [...edges]
    .sort((left, right) => compareIds(left.id, right.id))
    .flatMap((edge) => {
      const from = anchors.get(edge.source_table);
      const to = anchors.get(edge.target_table);
      return from && to
        ? [{
          id: edge.id,
          source: edge.source_table,
          target: edge.target_table,
          from,
          to,
        }]
        : [];
    });
}

function routeEntityEdges(
  edges: readonly EntityEdgeData[],
  positions: ReadonlyMap<string, LayoutPoint>,
): LayoutEdge[] {
  return [...edges]
    .sort((left, right) => compareIds(left.id, right.id))
    .flatMap((edge) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      return from && to
        ? [{ id: edge.id, source: edge.source, target: edge.target, from, to }]
        : [];
    });
}

/**
 * Builds an order-independent clustered network. Work remains deterministic
 * and non-physics-based so identical projected inputs produce identical worker
 * output and stable hit targets.
 */
export function computeGroupedLayout(
  graph: LayoutGraph,
  rawViewport: Viewport,
): GraphLayout {
  assertUniqueIds(graph.table_nodes, "table node");
  assertUniqueIds(graph.entity_nodes, "entity node");
  assertUniqueIds(graph.table_edges, "table edge");
  assertUniqueIds(graph.entity_edges, "entity edge");

  const tables = sortedTables(graph.table_nodes);
  const degrees = computeEntityDegrees(graph.entity_nodes, graph.entity_edges);
  const groups = entitiesByTable(graph.entity_nodes, tables, degrees);
  const viewport = normalizedViewport(rawViewport);
  const columns = anchorColumns(tables.length, viewport);
  const largestRadius = Math.max(
    FIRST_RING_RADIUS,
    ...tables.map((table) => clusterRadius(groups.get(table.id)?.length ?? 0)),
  );
  const anchorGap = Math.max(MIN_ANCHOR_GAP, largestRadius * 2 + 120);
  const rows = Math.max(1, Math.ceil(tables.length / columns));
  const naturalWidth = Math.max(0, (columns - 1) * anchorGap);
  const naturalHeight = Math.max(0, (rows - 1) * anchorGap);
  const originX = Math.max(
    ANCHOR_MARGIN + largestRadius,
    (viewport.width - naturalWidth) / 2,
  );
  const originY = Math.max(
    ANCHOR_MARGIN + largestRadius,
    (viewport.height - naturalHeight) / 2,
  );
  const tableNodes: LayoutTableNode[] = [];
  const entityNodes: LayoutEntityNode[] = [];
  const anchors = new Map<string, LayoutPoint>();
  const positions = new Map<string, LayoutPoint>();

  tables.forEach((table, index) => {
    const anchor = {
      x: originX + (index % columns) * anchorGap,
      y: originY + Math.floor(index / columns) * anchorGap,
    };
    tableNodes.push({ id: table.id, ...anchor });
    anchors.set(table.id, anchor);
    for (const entity of placeEntities(groups.get(table.id) ?? [], table.id, anchor)) {
      entityNodes.push(entity);
      positions.set(entity.id, { x: entity.x, y: entity.y });
    }
  });

  return {
    tableNodes,
    entityNodes,
    tableEdges: routeTableEdges(graph.table_edges, anchors),
    entityEdges: routeEntityEdges(graph.entity_edges, positions),
  };
}
