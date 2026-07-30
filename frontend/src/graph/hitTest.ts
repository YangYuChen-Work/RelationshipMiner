import type { ScreenPoint, RenderScene, SceneEdge, SceneNode } from "./scene";
import { sampleQuadratic } from "./edgeGeometry";

const GRID_CELL_SIZE = 64;
const EDGE_HIT_TOLERANCE = 6;
const MAX_CURVE_DEVIATION = EDGE_HIT_TOLERANCE / 2;
const MAX_CURVE_SAMPLE_SEGMENTS = 4_096;
const MAX_NODE_INDEX_RADIUS = 2_804;
const MAX_INDEX_CELLS_PER_ITEM = 8_192;
const MAX_EDGE_TRAVERSAL_STEPS = 100_000;

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

export interface HitTestDiagnostics {
  nodeCandidates: number;
  edgeCandidates: number;
  inspectedNodes: number;
  inspectedEdges: number;
}

export interface HitTestResult {
  target: HitTarget | null;
  diagnostics: HitTestDiagnostics;
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
  if (
    !finitePoint(node.screen) ||
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius > MAX_NODE_INDEX_RADIUS
  ) {
    return;
  }
  const minX = cellCoordinate(node.screen.x - radius);
  const maxX = cellCoordinate(node.screen.x + radius);
  const minY = cellCoordinate(node.screen.y - radius);
  const maxY = cellCoordinate(node.screen.y + radius);
  const columns = maxX - minX + 1;
  const rows = maxY - minY + 1;
  if (
    ![minX, maxX, minY, maxY].every(Number.isSafeInteger) ||
    !Number.isSafeInteger(columns) ||
    !Number.isSafeInteger(rows) ||
    columns <= 0 ||
    rows <= 0 ||
    columns * rows > MAX_INDEX_CELLS_PER_ITEM
  ) {
    return;
  }
  for (let column = minX; column <= maxX; column += 1) {
    for (let row = minY; row <= maxY; row += 1) {
      addToCell(grid, cellKey(column, row), node);
    }
  }
}

function addExpandedEdgeCell(
  keys: Set<string>,
  column: number,
  row: number,
): boolean {
  const padding = Math.ceil(EDGE_HIT_TOLERANCE / GRID_CELL_SIZE);
  for (let columnOffset = -padding; columnOffset <= padding; columnOffset += 1) {
    for (let rowOffset = -padding; rowOffset <= padding; rowOffset += 1) {
      const expandedColumn = column + columnOffset;
      const expandedRow = row + rowOffset;
      if (!Number.isSafeInteger(expandedColumn) || !Number.isSafeInteger(expandedRow)) {
        return false;
      }
      keys.add(cellKey(expandedColumn, expandedRow));
      if (keys.size > MAX_INDEX_CELLS_PER_ITEM) return false;
    }
  }
  return true;
}

function addTraversedSegmentCells(
  keys: Set<string>,
  from: ScreenPoint,
  to: ScreenPoint,
): boolean {
  if (!finitePoint(from) || !finitePoint(to)) return false;

  let column = cellCoordinate(from.x);
  let row = cellCoordinate(from.y);
  const endColumn = cellCoordinate(to.x);
  const endRow = cellCoordinate(to.y);
  if (![column, row, endColumn, endRow].every(Number.isSafeInteger)) return false;

  const columnDistance = Math.abs(endColumn - column);
  const rowDistance = Math.abs(endRow - row);
  const maxSteps = columnDistance + rowDistance + 1;
  if (
    !Number.isSafeInteger(maxSteps) ||
    maxSteps <= 0 ||
    maxSteps > MAX_EDGE_TRAVERSAL_STEPS
  ) {
    return false;
  }

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : GRID_CELL_SIZE / Math.abs(dx);
  const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : GRID_CELL_SIZE / Math.abs(dy);
  let tMaxX = stepX > 0
    ? ((column + 1) * GRID_CELL_SIZE - from.x) / dx
    : stepX < 0
      ? (from.x - column * GRID_CELL_SIZE) / -dx
      : Number.POSITIVE_INFINITY;
  let tMaxY = stepY > 0
    ? ((row + 1) * GRID_CELL_SIZE - from.y) / dy
    : stepY < 0
      ? (from.y - row * GRID_CELL_SIZE) / -dy
      : Number.POSITIVE_INFINITY;
  for (let steps = 0; steps < maxSteps; steps += 1) {
    if (!addExpandedEdgeCell(keys, column, row)) return false;
    if (column === endColumn && row === endRow) return true;

    if (tMaxX < tMaxY) {
      column += stepX;
      tMaxX += tDeltaX;
    } else if (tMaxY < tMaxX) {
      row += stepY;
      tMaxY += tDeltaY;
    } else {
      if (
        !addExpandedEdgeCell(keys, column + stepX, row) ||
        !addExpandedEdgeCell(keys, column, row + stepY)
      ) {
        return false;
      }
      column += stepX;
      row += stepY;
      tMaxX += tDeltaX;
      tMaxY += tDeltaY;
    }
  }
  return false;
}

function curveSamples(edge: SceneEdge): ScreenPoint[] | null {
  const { from, control, to } = edge.geometry;
  if (![from, control, to].every(finitePoint)) return null;
  const scale = Math.max(
    1,
    Math.abs(from.x),
    Math.abs(from.y),
    Math.abs(control.x),
    Math.abs(control.y),
    Math.abs(to.x),
    Math.abs(to.y),
  );
  const curvature = Math.hypot(
    from.x / scale - 2 * control.x / scale + to.x / scale,
    from.y / scale - 2 * control.y / scale + to.y / scale,
  ) * scale;
  const segments = Math.max(
    16,
    Math.ceil(Math.sqrt(curvature / (4 * MAX_CURVE_DEVIATION))),
  );
  if (!Number.isSafeInteger(segments) || segments > MAX_CURVE_SAMPLE_SEGMENTS) {
    return null;
  }
  return sampleQuadratic(edge.geometry, segments);
}

function traversedEdgeCells(edge: SceneEdge): Set<string> | null {
  const samples = curveSamples(edge);
  if (!samples) return null;
  const keys = new Set<string>();
  for (let index = 1; index < samples.length; index += 1) {
    if (!addTraversedSegmentCells(keys, samples[index - 1], samples[index])) return null;
  }
  return keys;
}

function addEdge(grid: Grid<SceneEdge>, edge: SceneEdge) {
  const keys = traversedEdgeCells(edge);
  if (!keys) return;
  for (const key of keys) {
    addToCell(grid, key, edge);
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

function distanceToSegment(
  point: ScreenPoint,
  from: ScreenPoint,
  to: ScreenPoint,
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(point.x - from.x, point.y - from.y);
  }
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return Math.hypot(
    point.x - (from.x + projection * dx),
    point.y - (from.y + projection * dy),
  );
}

function distanceToEdge(point: ScreenPoint, edge: SceneEdge): number {
  const samples = curveSamples(edge);
  if (!samples) return Number.POSITIVE_INFINITY;
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < samples.length; index += 1) {
    distance = Math.min(distance, distanceToSegment(point, samples[index - 1], samples[index]));
  }
  return distance;
}

function hitNode(
  nodes: SceneNode[],
  point: ScreenPoint,
  diagnostics: HitTestDiagnostics,
): SceneNode | null {
  for (const node of [...nodes].reverse()) {
    diagnostics.inspectedNodes += 1;
    if (containsNode(node, point)) return node;
  }
  return null;
}

function hitEdge(
  edges: SceneEdge[],
  point: ScreenPoint,
  diagnostics: HitTestDiagnostics,
): SceneEdge | null {
  for (const edge of [...edges].reverse()) {
    diagnostics.inspectedEdges += 1;
    if (distanceToEdge(point, edge) <= EDGE_HIT_TOLERANCE) return edge;
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

export function hitTestWithDiagnostics(
  scene: RenderScene,
  point: ScreenPoint,
): HitTestResult {
  const diagnostics: HitTestDiagnostics = {
    nodeCandidates: 0,
    edgeCandidates: 0,
    inspectedNodes: 0,
    inspectedEdges: 0,
  };
  if (!finitePoint(point)) return { target: null, diagnostics };

  const entityNodes = nearby(scene.hitIndex.entityNodes, point);
  const tableNodes = nearby(scene.hitIndex.tableNodes, point);
  const entityEdges = nearby(scene.hitIndex.entityEdges, point);
  const tableEdges = nearby(scene.hitIndex.tableEdges, point);
  diagnostics.nodeCandidates = entityNodes.length + tableNodes.length;
  diagnostics.edgeCandidates = entityEdges.length + tableEdges.length;

  const entityNode = hitNode(entityNodes, point, diagnostics);
  if (entityNode) {
    return { target: { kind: "entity-node", id: entityNode.id }, diagnostics };
  }
  const tableNode = hitNode(tableNodes, point, diagnostics);
  if (tableNode) {
    return { target: { kind: "table-node", id: tableNode.id }, diagnostics };
  }
  const entityEdge = hitEdge(entityEdges, point, diagnostics);
  if (entityEdge) {
    return { target: { kind: "entity-edge", id: entityEdge.id }, diagnostics };
  }
  const tableEdge = hitEdge(tableEdges, point, diagnostics);
  if (tableEdge) {
    return { target: { kind: "table-edge", id: tableEdge.id }, diagnostics };
  }
  return { target: null, diagnostics };
}

export function hitTest(scene: RenderScene, point: ScreenPoint): HitTarget | null {
  return hitTestWithDiagnostics(scene, point).target;
}
