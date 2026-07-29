import type { ScreenPoint, RenderScene, SceneEdge, SceneNode } from "./scene";

const GRID_CELL_SIZE = 64;
const EDGE_HIT_TOLERANCE = 6;

type Grid<T extends { id: string }> = Map<string, T[]>;

export type HitTarget =
  | { kind: "entity-node"; id: string }
  | { kind: "table-node"; id: string }
  | { kind: "entity-edge"; id: string }
  | { kind: "table-edge"; id: string };

export interface HitTestCandidates {
  nodeIds: string[];
  edgeIds: string[];
}

export interface SceneHitIndex {
  readonly cellSize: number;
  readonly entityNodes: Grid<SceneNode>;
  readonly tableNodes: Grid<SceneNode>;
  readonly entityEdges: Grid<SceneEdge>;
  readonly tableEdges: Grid<SceneEdge>;
}

function finitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function cellCoordinate(value: number): number {
  return Math.floor(value / GRID_CELL_SIZE);
}

function cellKey(column: number, row: number): string {
  return `${column}:${row}`;
}

function addToCell<T extends { id: string }>(grid: Grid<T>, key: string, item: T) {
  const cell = grid.get(key);
  if (cell) cell.push(item);
  else grid.set(key, [item]);
}

function addNode(grid: Grid<SceneNode>, node: SceneNode) {
  const radius = node.hitRadius;
  const minX = cellCoordinate(node.screen.x - radius);
  const maxX = cellCoordinate(node.screen.x + radius);
  const minY = cellCoordinate(node.screen.y - radius);
  const maxY = cellCoordinate(node.screen.y + radius);
  for (let column = minX; column <= maxX; column += 1) {
    for (let row = minY; row <= maxY; row += 1) {
      addToCell(grid, cellKey(column, row), node);
    }
  }
}

function addEdge(grid: Grid<SceneEdge>, edge: SceneEdge) {
  const minX = cellCoordinate(Math.min(edge.from.screen.x, edge.to.screen.x) - EDGE_HIT_TOLERANCE);
  const maxX = cellCoordinate(Math.max(edge.from.screen.x, edge.to.screen.x) + EDGE_HIT_TOLERANCE);
  const minY = cellCoordinate(Math.min(edge.from.screen.y, edge.to.screen.y) - EDGE_HIT_TOLERANCE);
  const maxY = cellCoordinate(Math.max(edge.from.screen.y, edge.to.screen.y) + EDGE_HIT_TOLERANCE);
  for (let column = minX; column <= maxX; column += 1) {
    for (let row = minY; row <= maxY; row += 1) {
      addToCell(grid, cellKey(column, row), edge);
    }
  }
}

export function createHitIndex(
  scene: Pick<RenderScene, "entityDots" | "tableNodes" | "entityEdges" | "tableEdges">,
): SceneHitIndex {
  const index: SceneHitIndex = {
    cellSize: GRID_CELL_SIZE,
    entityNodes: new Map(),
    tableNodes: new Map(),
    entityEdges: new Map(),
    tableEdges: new Map(),
  };
  scene.entityDots.forEach((node) => addNode(index.entityNodes, node));
  scene.tableNodes.forEach((node) => addNode(index.tableNodes, node));
  scene.entityEdges.forEach((edge) => addEdge(index.entityEdges, edge));
  scene.tableEdges.forEach((edge) => addEdge(index.tableEdges, edge));
  return index;
}

function nearby<T extends { id: string }>(grid: Grid<T>, point: ScreenPoint): T[] {
  const column = cellCoordinate(point.x);
  const row = cellCoordinate(point.y);
  const byId = new Map<string, T>();
  for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      for (const candidate of grid.get(cellKey(column + columnOffset, row + rowOffset)) ?? []) {
        byId.set(candidate.id, candidate);
      }
    }
  }
  return [...byId.values()];
}

function containsNode(node: SceneNode, point: ScreenPoint): boolean {
  const dx = point.x - node.screen.x;
  const dy = point.y - node.screen.y;
  return dx * dx + dy * dy <= node.hitRadius * node.hitRadius;
}

function distanceToSegment(point: ScreenPoint, edge: SceneEdge): number {
  const dx = edge.to.screen.x - edge.from.screen.x;
  const dy = edge.to.screen.y - edge.from.screen.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - edge.from.screen.x, point.y - edge.from.screen.y);
  }
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - edge.from.screen.x) * dx + (point.y - edge.from.screen.y) * dy) / lengthSquared),
  );
  return Math.hypot(
    point.x - (edge.from.screen.x + projection * dx),
    point.y - (edge.from.screen.y + projection * dy),
  );
}

function hitNode(nodes: SceneNode[], point: ScreenPoint): SceneNode | null {
  for (const node of [...nodes].reverse()) {
    if (containsNode(node, point)) return node;
  }
  return null;
}

function hitEdge(edges: SceneEdge[], point: ScreenPoint): SceneEdge | null {
  for (const edge of [...edges].reverse()) {
    if (distanceToSegment(point, edge) <= EDGE_HIT_TOLERANCE) return edge;
  }
  return null;
}

export function getHitTestCandidates(scene: RenderScene, point: ScreenPoint): HitTestCandidates {
  if (!finitePoint(point)) return { nodeIds: [], edgeIds: [] };
  return {
    nodeIds: [
      ...nearby(scene.hitIndex.entityNodes, point),
      ...nearby(scene.hitIndex.tableNodes, point),
    ].map((candidate) => candidate.id),
    edgeIds: [
      ...nearby(scene.hitIndex.entityEdges, point),
      ...nearby(scene.hitIndex.tableEdges, point),
    ].map((candidate) => candidate.id),
  };
}

export function hitTest(scene: RenderScene, point: ScreenPoint): HitTarget | null {
  if (!finitePoint(point)) return null;
  const entityNode = hitNode(nearby(scene.hitIndex.entityNodes, point), point);
  if (entityNode) return { kind: "entity-node", id: entityNode.id };
  const tableNode = hitNode(nearby(scene.hitIndex.tableNodes, point), point);
  if (tableNode) return { kind: "table-node", id: tableNode.id };
  const entityEdge = hitEdge(nearby(scene.hitIndex.entityEdges, point), point);
  if (entityEdge) return { kind: "entity-edge", id: entityEdge.id };
  const tableEdge = hitEdge(nearby(scene.hitIndex.tableEdges, point), point);
  if (tableEdge) return { kind: "table-edge", id: tableEdge.id };
  return null;
}
