import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  randomLcg,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3";
import type { SemanticGraphData } from "../api/analysis";

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

export interface LayoutTableInput {
  readonly id: string;
  readonly display_name: string;
}

export interface LayoutEntityInput {
  readonly id: string;
  readonly table_id: string;
  readonly class_name: string | null;
}

export interface LayoutTableEdgeInput {
  readonly id: string;
  readonly source_table: string;
  readonly target_table: string;
}

export interface LayoutEntityEdgeInput {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly weight: number;
}

export interface LayoutGraph {
  readonly table_nodes: readonly LayoutTableInput[];
  readonly entity_nodes: readonly LayoutEntityInput[];
  readonly table_edges: readonly LayoutTableEdgeInput[];
  readonly entity_edges: readonly LayoutEntityEdgeInput[];
}

export interface LayoutOptions {
  readonly seedOffset?: number;
}

export const ENTITY_COLLISION_RADIUS = 58;

const PROCESS_CLASS_ORDER = [
  "MEProcess",
  "MEOperation",
  "MEStep",
  "Assembly",
] as const;
const UINT32_RANGE = 4_294_967_296;
const TABLE_ANCHOR_GAP = 320;
const COMPONENT_ANCHOR_GAP = 260;
const COMPONENT_BOUNDS_PADDING = 20;
const LARGE_GRAPH_THRESHOLD = 1_000;

interface SimulationEntity extends SimulationNodeDatum {
  id: string;
  tableId: string;
  x: number;
  y: number;
}

interface SimulationEdge extends SimulationLinkDatum<SimulationEntity> {
  id: string;
  source: string | SimulationEntity;
  target: string | SimulationEntity;
  weight: number;
}

interface Component {
  id: string;
  nodeIds: string[];
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function processClassIndex(table: LayoutTableInput): number {
  const id = table.id.toLowerCase();
  const displayName = table.display_name.toLowerCase();
  const index = PROCESS_CLASS_ORDER.findIndex((known) => {
    const normalized = known.toLowerCase();
    return id === normalized || displayName === normalized;
  });
  return index < 0 ? PROCESS_CLASS_ORDER.length : index;
}

function sortedTables(tables: readonly LayoutTableInput[]): LayoutTableInput[] {
  return [...tables].sort((left, right) => {
    const classOrder = processClassIndex(left) - processClassIndex(right);
    return classOrder || compareIds(left.id, right.id);
  });
}

function sortedEntities(
  entities: readonly LayoutEntityInput[],
): LayoutEntityInput[] {
  return [...entities].sort((left, right) => compareIds(left.id, right.id));
}

function sortedEntityEdges(
  edges: readonly LayoutEntityEdgeInput[],
): LayoutEntityEdgeInput[] {
  return [...edges].sort((left, right) => compareIds(left.id, right.id));
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

function validateGraph(graph: LayoutGraph) {
  assertUniqueIds(graph.table_nodes, "table node");
  assertUniqueIds(graph.entity_nodes, "entity node");
  assertUniqueIds(graph.table_edges, "table edge");
  assertUniqueIds(graph.entity_edges, "entity edge");
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

function hashString(value: string, initial = 2_166_136_261): number {
  let hash = initial >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function stableGraphSignature(graph: LayoutGraph): string {
  const tables = [...graph.table_nodes]
    .sort((left, right) => compareIds(left.id, right.id))
    .map((table) => `${table.id}:${table.display_name}`)
    .join("|");
  const entities = [...graph.entity_nodes]
    .sort((left, right) => compareIds(left.id, right.id))
    .map((entity) =>
      `${entity.id}:${entity.table_id}:${entity.class_name ?? ""}`
    )
    .join("|");
  const tableEdges = [...graph.table_edges]
    .sort((left, right) => compareIds(left.id, right.id))
    .map((edge) => `${edge.id}:${edge.source_table}:${edge.target_table}`)
    .join("|");
  const entityEdges = sortedEntityEdges(graph.entity_edges)
    .map((edge) => `${edge.id}:${edge.source}:${edge.target}:${edge.weight}`)
    .join("|");
  return `${tables}#${entities}#${tableEdges}#${entityEdges}`;
}

function seedFor(graph: LayoutGraph, seedOffset: number): number {
  const base = hashString(stableGraphSignature(graph));
  return hashString(String(Number.isFinite(seedOffset) ? seedOffset : 0), base);
}

function randomFromSeed(seed: number) {
  return randomLcg((seed >>> 0) / UINT32_RANGE);
}

function validEntities(
  graph: LayoutGraph,
  tables: readonly LayoutTableInput[],
): LayoutEntityInput[] {
  const tableIds = new Set(tables.map((table) => table.id));
  return sortedEntities(graph.entity_nodes)
    .filter((entity) => tableIds.has(entity.table_id));
}

function validEntityEdges(
  graph: LayoutGraph,
  entities: readonly LayoutEntityInput[],
): LayoutEntityEdgeInput[] {
  const entityIds = new Set(entities.map((entity) => entity.id));
  return sortedEntityEdges(graph.entity_edges).filter((edge) =>
    entityIds.has(edge.source) && entityIds.has(edge.target)
  );
}

function connectedComponents(
  entities: readonly LayoutEntityInput[],
  edges: readonly LayoutEntityEdgeInput[],
): {
  components: Component[];
  componentByNode: Map<string, string>;
} {
  const adjacency = new Map(
    entities.map((entity) => [entity.id, [] as string[]]),
  );
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    if (edge.target !== edge.source) {
      adjacency.get(edge.target)?.push(edge.source);
    }
  }
  for (const neighbors of adjacency.values()) neighbors.sort(compareIds);

  const visited = new Set<string>();
  const components: Component[] = [];
  const componentByNode = new Map<string, string>();
  for (const entity of entities) {
    if (visited.has(entity.id)) continue;
    const pending = [entity.id];
    const nodeIds: string[] = [];
    visited.add(entity.id);
    while (pending.length > 0) {
      const current = pending.pop()!;
      nodeIds.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    nodeIds.sort(compareIds);
    const component = { id: nodeIds[0], nodeIds };
    components.push(component);
    for (const nodeId of nodeIds) componentByNode.set(nodeId, component.id);
  }
  components.sort((left, right) => compareIds(left.id, right.id));
  return { components, componentByNode };
}

function stableUnitVector(key: string): LayoutPoint {
  let x = (hashString(`${key}:x`) / UINT32_RANGE) * 2 - 1;
  let y = (hashString(`${key}:y`) / UINT32_RANGE) * 2 - 1;
  let magnitude = Math.hypot(x, y);
  if (magnitude < 0.000_001) {
    x = 1;
    y = 0;
    magnitude = 1;
  }
  return { x: x / magnitude, y: y / magnitude };
}

function seededRectangularAnchors(
  ids: readonly string[],
  seed: number,
  viewport: Viewport,
  minimumGap: number,
): Map<string, LayoutPoint> {
  if (ids.length === 0) return new Map();
  const columns = Math.max(1, Math.ceil(Math.sqrt(
    ids.length * viewport.width / viewport.height,
  )));
  const rows = Math.max(1, Math.ceil(ids.length / columns));
  const width = Math.max(viewport.width, columns * minimumGap * 1.35);
  const height = Math.max(viewport.height, rows * minimumGap * 1.35);
  const randomX = randomFromSeed(seed ^ 0x9e37_79b9);
  const randomY = randomFromSeed(seed ^ 0x85eb_ca6b);
  const points = ids.map((id) => ({
    id,
    x: (randomX() - 0.5) * width,
    y: (randomY() - 0.5) * height,
  }));
  relaxPointCollisions(points, minimumGap, 80);
  return new Map(points.map(({ id, x, y }) => [id, { x, y }]));
}

function tableMemberCounts(
  entities: readonly LayoutEntityInput[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entity of entities) {
    counts.set(entity.table_id, (counts.get(entity.table_id) ?? 0) + 1);
  }
  return counts;
}

function tableScatterSpan(memberCount: number): number {
  return Math.max(
    ENTITY_COLLISION_RADIUS * 4,
    Math.sqrt(memberCount) * ENTITY_COLLISION_RADIUS * 2.4,
  );
}

function scalableTableAnchorGap(
  countsByTable: ReadonlyMap<string, number>,
): number {
  const largestTable = Math.max(1, ...countsByTable.values());
  return Math.max(
    TABLE_ANCHOR_GAP,
    tableScatterSpan(largestTable) * 1.25,
  );
}

function relaxPointCollisions<T extends LayoutPoint & { id: string }>(
  points: T[],
  minimumDistance: number,
  passes: number,
  useHashDirection = false,
) {
  const cellSize = minimumDistance;
  for (let pass = 0; pass < passes; pass += 1) {
    let overlapFound = false;
    const cells = new Map<string, number[]>();
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const cellX = Math.floor(point.x / cellSize);
      const cellY = Math.floor(point.y / cellSize);
      const key = `${cellX},${cellY}`;
      const bucket = cells.get(key);
      if (bucket) bucket.push(index);
      else cells.set(key, [index]);
    }

    for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
      const left = points[leftIndex];
      const cellX = Math.floor(left.x / cellSize);
      const cellY = Math.floor(left.y / cellSize);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const bucket = cells.get(`${cellX + offsetX},${cellY + offsetY}`);
          if (!bucket) continue;
          for (const rightIndex of bucket) {
            if (rightIndex <= leftIndex) continue;
            const right = points[rightIndex];
            let deltaX = right.x - left.x;
            let deltaY = right.y - left.y;
            let distance = Math.hypot(deltaX, deltaY);
            if (distance >= minimumDistance) continue;
            overlapFound = true;
            if (distance < 0.000_001) {
              const direction = stableUnitVector(`${left.id}:${right.id}`);
              deltaX = direction.x;
              deltaY = direction.y;
              distance = 1;
            }
            let unitX = deltaX / distance;
            let unitY = deltaY / distance;
            let projection = 1;
            if (useHashDirection) {
              const stableDirection = stableUnitVector(
                `${left.id}:${right.id}:relax`,
              );
              const alignment = stableDirection.x * unitX +
                stableDirection.y * unitY;
              const orientation = alignment < 0 ? -1 : 1;
              unitX = stableDirection.x * orientation;
              unitY = stableDirection.y * orientation;
              projection = Math.max(Math.abs(alignment), 0.25);
            }
            const shift = (minimumDistance - distance) /
              (2 * projection) + 0.001;
            left.x -= unitX * shift;
            left.y -= unitY * shift;
            right.x += unitX * shift;
            right.y += unitY * shift;
          }
        }
      }
    }
    if (!overlapFound) return;
  }
}

function componentBounds(
  component: Component,
  positions: ReadonlyMap<string, SimulationEntity>,
) {
  const nodes = component.nodeIds
    .map((id) => positions.get(id))
    .filter((node): node is SimulationEntity => Boolean(node));
  return {
    left: Math.min(...nodes.map((node) => node.x)) - COMPONENT_BOUNDS_PADDING,
    right: Math.max(...nodes.map((node) => node.x)) + COMPONENT_BOUNDS_PADDING,
    top: Math.min(...nodes.map((node) => node.y)) - COMPONENT_BOUNDS_PADDING,
    bottom: Math.max(...nodes.map((node) => node.y)) + COMPONENT_BOUNDS_PADDING,
  };
}

function translateComponent(
  component: Component,
  positions: ReadonlyMap<string, SimulationEntity>,
  deltaX: number,
  deltaY: number,
) {
  for (const nodeId of component.nodeIds) {
    const node = positions.get(nodeId);
    if (!node) continue;
    node.x += deltaX;
    node.y += deltaY;
  }
}

function expandComponentCenters(
  components: readonly Component[],
  positions: ReadonlyMap<string, SimulationEntity>,
  epoch: number,
) {
  const items = components.map((component) => {
    const bounds = componentBounds(component, positions);
    return {
      component,
      centerX: (bounds.left + bounds.right) / 2,
      centerY: (bounds.top + bounds.bottom) / 2,
    };
  });
  const centerX = items.reduce((sum, item) => sum + item.centerX, 0) /
    items.length;
  const centerY = items.reduce((sum, item) => sum + item.centerY, 0) /
    items.length;
  const expansion = 1.18 + Math.min(epoch, 4) * 0.015;
  const jitterScale = COMPONENT_BOUNDS_PADDING * (0.4 + epoch * 0.12);
  for (const item of items) {
    const jitter = stableUnitVector(
      `${item.component.id}:organic:${epoch}`,
    );
    translateComponent(
      item.component,
      positions,
      (item.centerX - centerX) * (expansion - 1) +
        jitter.x * jitterScale,
      (item.centerY - centerY) * (expansion - 1) +
        jitter.y * jitterScale,
    );
  }
}

function separateComponentBounds(
  components: readonly Component[],
  nodes: SimulationEntity[],
) {
  if (
    components.length < 2 ||
    components.every((component) => component.nodeIds.length === 1)
  ) {
    return;
  }
  const positions = new Map(nodes.map((node) => [node.id, node]));
  const cellSize = ENTITY_COLLISION_RADIUS * 4;
  for (let pass = 0; pass < 384; pass += 1) {
    const bounds = components.map((component) =>
      componentBounds(component, positions)
    );
    const cells = new Map<string, number[]>();
    for (let index = 0; index < bounds.length; index += 1) {
      const bound = bounds[index];
      const leftCell = Math.floor(bound.left / cellSize);
      const rightCell = Math.floor(bound.right / cellSize);
      const topCell = Math.floor(bound.top / cellSize);
      const bottomCell = Math.floor(bound.bottom / cellSize);
      for (let cellX = leftCell; cellX <= rightCell; cellX += 1) {
        for (let cellY = topCell; cellY <= bottomCell; cellY += 1) {
          const key = `${cellX},${cellY}`;
          const bucket = cells.get(key);
          if (bucket) bucket.push(index);
          else cells.set(key, [index]);
        }
      }
    }
    const pairKeys = new Set<number>();
    for (const bucket of cells.values()) {
      for (let left = 0; left < bucket.length; left += 1) {
        for (let right = left + 1; right < bucket.length; right += 1) {
          const leftIndex = Math.min(bucket[left], bucket[right]);
          const rightIndex = Math.max(bucket[left], bucket[right]);
          pairKeys.add(leftIndex * components.length + rightIndex);
        }
      }
    }

    let overlapFound = false;
    for (const pairKey of [...pairKeys].sort((left, right) => left - right)) {
      const leftIndex = Math.floor(pairKey / components.length);
      const rightIndex = pairKey % components.length;
      const leftComponent = components[leftIndex];
      const rightComponent = components[rightIndex];
      const left = componentBounds(leftComponent, positions);
      const right = componentBounds(rightComponent, positions);
      const overlapX = Math.min(left.right, right.right) -
        Math.max(left.left, right.left);
      const overlapY = Math.min(left.bottom, right.bottom) -
        Math.max(left.top, right.top);
      if (overlapX <= 0 || overlapY <= 0) continue;
      overlapFound = true;
      if (overlapX <= overlapY) {
        const direction = (left.left + left.right) <=
            (right.left + right.right)
          ? 1
          : -1;
        const shift = overlapX / 2 + 0.001;
        translateComponent(leftComponent, positions, -direction * shift, 0);
        translateComponent(rightComponent, positions, direction * shift, 0);
      } else {
        const direction = (left.top + left.bottom) <=
            (right.top + right.bottom)
          ? 1
          : -1;
        const shift = overlapY / 2 + 0.001;
        translateComponent(leftComponent, positions, 0, -direction * shift);
        translateComponent(rightComponent, positions, 0, direction * shift);
      }
    }
    if (!overlapFound) return;
    if ((pass + 1) % 32 === 0) {
      expandComponentCenters(
        components,
        positions,
        Math.floor(pass / 32),
      );
    }
  }
  throw new Error("Unable to separate graph component bounds.");
}

function recenterDelta(
  points: readonly LayoutPoint[],
  viewport: Viewport,
): LayoutPoint {
  if (points.length === 0) {
    return { x: viewport.width / 2, y: viewport.height / 2 };
  }
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  return {
    x: viewport.width / 2 - (left + right) / 2,
    y: viewport.height / 2 - (top + bottom) / 2,
  };
}

function tableNodesFromEntities(
  tables: readonly LayoutTableInput[],
  nodes: readonly SimulationEntity[],
  emptyAnchors: ReadonlyMap<string, LayoutPoint>,
): LayoutTableNode[] {
  const members = new Map<string, SimulationEntity[]>();
  for (const node of nodes) {
    const group = members.get(node.tableId);
    if (group) group.push(node);
    else members.set(node.tableId, [node]);
  }
  return tables.map((table) => {
    const group = members.get(table.id);
    if (group && group.length > 0) {
      return {
        id: table.id,
        x: group.reduce((sum, node) => sum + node.x, 0) / group.length,
        y: group.reduce((sum, node) => sum + node.y, 0) / group.length,
      };
    }
    const anchor = emptyAnchors.get(table.id) ?? { x: 0, y: 0 };
    return {
      id: table.id,
      x: anchor.x,
      y: anchor.y,
    };
  });
}

function routeTableEdges(
  edges: readonly LayoutTableEdgeInput[],
  positions: ReadonlyMap<string, LayoutPoint>,
): LayoutEdge[] {
  return [...edges]
    .sort((left, right) => compareIds(left.id, right.id))
    .flatMap((edge) => {
      const from = positions.get(edge.source_table);
      const to = positions.get(edge.target_table);
      return from && to
        ? [{
          id: edge.id,
          source: edge.source_table,
          target: edge.target_table,
          from: { x: from.x, y: from.y },
          to: { x: to.x, y: to.y },
        }]
        : [];
    });
}

function routeEntityEdges(
  edges: readonly LayoutEntityEdgeInput[],
  positions: ReadonlyMap<string, LayoutPoint>,
): LayoutEdge[] {
  return sortedEntityEdges(edges).flatMap((edge) => {
    const from = positions.get(edge.source);
    const to = positions.get(edge.target);
    return from && to
      ? [{
        id: edge.id,
        source: edge.source,
        target: edge.target,
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
      }]
      : [];
  });
}

function buildLayout(
  graph: LayoutGraph,
  tables: readonly LayoutTableInput[],
  edges: readonly LayoutEntityEdgeInput[],
  nodes: SimulationEntity[],
  tableAnchors: ReadonlyMap<string, LayoutPoint>,
  viewport: Viewport,
): GraphLayout {
  const rawTableNodes = tableNodesFromEntities(
    tables,
    nodes,
    tableAnchors,
  );
  const delta = recenterDelta([...nodes, ...rawTableNodes], viewport);
  for (const node of nodes) {
    node.x += delta.x;
    node.y += delta.y;
  }
  const tableNodes = rawTableNodes.map((node) => ({
    ...node,
    x: node.x + delta.x,
    y: node.y + delta.y,
  }));
  const entityNodes = nodes.map(({ id, tableId, x, y }) => ({
    id,
    tableId,
    x,
    y,
  }));
  const tablePositions = new Map(
    tableNodes.map(({ id, x, y }) => [id, { x, y }]),
  );
  const entityPositions = new Map(
    entityNodes.map(({ id, x, y }) => [id, { x, y }]),
  );
  const layout = {
    tableNodes,
    entityNodes,
    tableEdges: routeTableEdges(graph.table_edges, tablePositions),
    entityEdges: routeEntityEdges(edges, entityPositions),
  };
  assertFiniteLayout(layout);
  return layout;
}

function assertFiniteLayout(layout: GraphLayout) {
  const points = [
    ...layout.tableNodes,
    ...layout.entityNodes,
    ...layout.tableEdges.flatMap((edge) => [edge.from, edge.to]),
    ...layout.entityEdges.flatMap((edge) => [edge.from, edge.to]),
  ];
  if (points.some(({ x, y }) => !Number.isFinite(x) || !Number.isFinite(y))) {
    throw new Error("Graph layout produced non-finite coordinates.");
  }
}

export function compactLayoutGraph(
  graph: SemanticGraphData | LayoutGraph,
): LayoutGraph {
  return {
    table_nodes: graph.table_nodes.map(({ id, display_name }) => ({
      id,
      display_name,
    })),
    entity_nodes: graph.entity_nodes.map(({ id, table_id, class_name }) => ({
      id,
      table_id,
      class_name,
    })),
    table_edges: graph.table_edges.map(
      ({ id, source_table, target_table }) => ({
        id,
        source_table,
        target_table,
      }),
    ),
    entity_edges: graph.entity_edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      weight: "relations" in edge
        ? edge.relations.some((relation) => relation.strength === "strong")
          ? 1
          : 0.35
        : edge.weight,
    })),
  };
}

export function computeNebulaLayout(
  graph: LayoutGraph,
  rawViewport: Viewport,
  options: LayoutOptions = {},
): GraphLayout {
  validateGraph(graph);
  const viewport = normalizedViewport(rawViewport);
  const tables = sortedTables(graph.table_nodes);
  const entities = validEntities(graph, tables);
  const edges = validEntityEdges(graph, entities);
  if (tables.length === 0 && entities.length === 0) {
    return { tableNodes: [], entityNodes: [], tableEdges: [], entityEdges: [] };
  }

  const seed = seedFor(graph, options.seedOffset ?? 0);
  const { components, componentByNode } = connectedComponents(entities, edges);
  const componentSizes = new Map(
    components.map((component) => [component.id, component.nodeIds.length]),
  );
  const countsByTable = tableMemberCounts(entities);
  const largeGraph = entities.length > LARGE_GRAPH_THRESHOLD;
  const tableAnchors = seededRectangularAnchors(
    tables.map((table) => table.id),
    seed ^ 0xa341_316c,
    viewport,
    largeGraph ? scalableTableAnchorGap(countsByTable) : TABLE_ANCHOR_GAP,
  );
  const componentAnchors = seededRectangularAnchors(
    components
      .filter((component) => !largeGraph || component.nodeIds.length > 1)
      .map((component) => component.id),
    seed ^ 0xc801_3ea4,
    viewport,
    COMPONENT_ANCHOR_GAP,
  );
  const randomX = randomFromSeed(seed ^ 0xad90_777d);
  const randomY = randomFromSeed(seed ^ 0x7e95_761e);
  const nodes: SimulationEntity[] = entities.map((entity) => {
    const tableAnchor = tableAnchors.get(entity.table_id)!;
    const componentId = componentByNode.get(entity.id)!;
    const componentAnchor = componentAnchors.get(componentId) ?? tableAnchor;
    const componentWeight = largeGraph &&
        componentSizes.get(componentId) === 1
      ? 0
      : 0.38;
    const tableWeight = 1 - componentWeight;
    const scatterSpan = largeGraph
      ? tableScatterSpan(countsByTable.get(entity.table_id) ?? 1)
      : 84;
    return {
      id: entity.id,
      tableId: entity.table_id,
      x: tableAnchor.x * tableWeight + componentAnchor.x * componentWeight +
        (randomX() - 0.5) * scatterSpan,
      y: tableAnchor.y * tableWeight + componentAnchor.y * componentWeight +
        (randomY() - 0.5) * scatterSpan,
    };
  });
  const linkedNodeIds = new Set(
    edges.flatMap((edge) => [edge.source, edge.target]),
  );
  const representedTables = new Set<string>();
  const representativeNodeIds = new Set<string>();
  for (const node of nodes) {
    if (representedTables.has(node.tableId)) continue;
    representedTables.add(node.tableId);
    representativeNodeIds.add(node.id);
  }
  const simulationNodes = largeGraph
    ? nodes.filter((node) =>
      linkedNodeIds.has(node.id) || representativeNodeIds.has(node.id)
    )
    : nodes;
  const links: SimulationEdge[] = edges.map((edge) => ({ ...edge }));
  const random = randomFromSeed(seed);
  const charge = forceManyBody<SimulationEntity>().strength(-115);
  if (simulationNodes.length > 1_000) {
    charge.distanceMax(720).theta(1.2);
  }
  const simulation = forceSimulation<SimulationEntity, SimulationEdge>(
    simulationNodes,
  )
    .randomSource(random)
    .force(
      "links",
      forceLink<SimulationEntity, SimulationEdge>(links)
        .id((node) => node.id)
        .distance((link) => link.weight >= 1 ? 92 : 148)
        .strength((link) => link.weight >= 1 ? 0.72 : 0.22),
    )
    .force("charge", charge)
    .force(
      "collision",
      forceCollide<SimulationEntity>(ENTITY_COLLISION_RADIUS)
        .strength(0.95)
        .iterations(2),
    )
    .force(
      "table-x",
      forceX<SimulationEntity>((node) => tableAnchors.get(node.tableId)!.x)
        .strength(0.055),
    )
    .force(
      "table-y",
      forceY<SimulationEntity>((node) => tableAnchors.get(node.tableId)!.y)
        .strength(0.055),
    )
    .force(
      "component-x",
      forceX<SimulationEntity>((node) =>
        (componentAnchors.get(componentByNode.get(node.id)!) ??
          tableAnchors.get(node.tableId)!).x
      ).strength(0.025),
    )
    .force(
      "component-y",
      forceY<SimulationEntity>((node) =>
        (componentAnchors.get(componentByNode.get(node.id)!) ??
          tableAnchors.get(node.tableId)!).y
      ).strength(0.025),
    )
    .stop();

  for (let tick = 0; tick < 360; tick += 1) simulation.tick();
  simulation.stop();
  relaxPointCollisions(
    nodes,
    ENTITY_COLLISION_RADIUS * 2,
    largeGraph ? 96 : 12,
  );
  separateComponentBounds(components, nodes);
  return buildLayout(graph, tables, edges, nodes, tableAnchors, viewport);
}

export function computeFallbackScatterLayout(
  graph: LayoutGraph,
  rawViewport: Viewport,
  options: LayoutOptions = {},
): GraphLayout {
  validateGraph(graph);
  const viewport = normalizedViewport(rawViewport);
  const tables = sortedTables(graph.table_nodes);
  const entities = validEntities(graph, tables);
  const edges = validEntityEdges(graph, entities);
  if (tables.length === 0 && entities.length === 0) {
    return { tableNodes: [], entityNodes: [], tableEdges: [], entityEdges: [] };
  }

  const seed = seedFor(graph, options.seedOffset ?? 0);
  const countsByTable = tableMemberCounts(entities);
  const largeGraph = entities.length > LARGE_GRAPH_THRESHOLD;
  const tableAnchors = seededRectangularAnchors(
    tables.map((table) => table.id),
    seed ^ 0x4cf5_ad43,
    viewport,
    largeGraph ? scalableTableAnchorGap(countsByTable) : TABLE_ANCHOR_GAP,
  );
  const randomX = randomFromSeed(seed ^ 0x9f6a_bc1d);
  const randomY = randomFromSeed(seed ^ 0x3c6e_f372);
  const nodes: SimulationEntity[] = entities.map((entity) => {
    const anchor = tableAnchors.get(entity.table_id)!;
    const memberCount = countsByTable.get(entity.table_id) ?? 1;
    const span = tableScatterSpan(memberCount);
    return {
      id: entity.id,
      tableId: entity.table_id,
      x: anchor.x + (randomX() - 0.5) * span,
      y: anchor.y + (randomY() - 0.5) * span,
    };
  });
  relaxPointCollisions(
    nodes,
    ENTITY_COLLISION_RADIUS * 2,
    48,
    true,
  );
  if (largeGraph) {
    relaxPointCollisions(nodes, ENTITY_COLLISION_RADIUS * 2, 96);
  }
  const { components } = connectedComponents(entities, edges);
  separateComponentBounds(components, nodes);
  return buildLayout(graph, tables, edges, nodes, tableAnchors, viewport);
}

/**
 * Backward-compatible test helper. Runtime Worker traffic uses
 * computeNebulaLayout with an already compact graph.
 */
export function computeGroupedLayout(
  graph: SemanticGraphData | LayoutGraph,
  viewport: Viewport,
  options?: LayoutOptions,
): GraphLayout {
  return computeNebulaLayout(compactLayoutGraph(graph), viewport, options);
}

export function moveLayoutEntity(
  layout: GraphLayout,
  nodeId: string,
  point: LayoutPoint,
): GraphLayout {
  const nextPoint = { x: point.x, y: point.y };
  return {
    tableNodes: [...layout.tableNodes],
    entityNodes: layout.entityNodes.map((node) =>
      node.id === nodeId ? { ...node, ...nextPoint } : node
    ),
    tableEdges: [...layout.tableEdges],
    entityEdges: layout.entityEdges.map((edge) => {
      if (edge.source !== nodeId && edge.target !== nodeId) return edge;
      return {
        ...edge,
        from: edge.source === nodeId ? { ...nextPoint } : edge.from,
        to: edge.target === nodeId ? { ...nextPoint } : edge.to,
      };
    }),
  };
}
