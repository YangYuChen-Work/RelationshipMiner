import type {
  EntityEdgeData,
  EntityRelationData,
  EntityNodeData,
  SemanticGraphData,
  TableEdgeData,
  TableNodeData,
} from "../api/analysis";
import type {
  GraphLayout,
  LayoutEdge,
  LayoutEntityNode,
  LayoutTableNode,
} from "./layout";
import {
  buildQuadraticGeometry,
  quadraticPoint,
  semanticZoomLevel,
  type QuadraticGeometry,
  type SemanticZoomLevel,
  type ScreenBounds,
} from "./edgeGeometry";
import { createHitIndex, type SceneHitIndex } from "./hitTest";
import {
  buildBusinessPresentationIndex,
  type BusinessEntityPresentation,
} from "./businessPresentation";
import { businessRelationLabel } from "./businessRelations";
import {
  computeEntityDegrees,
  visibleEntityRelations,
} from "./semantics";

const TABLE_EDGE_LABEL_ZOOM = 0.02;
const ENTITY_EDGE_LABEL_ZOOM = 0.9;
const TABLE_WORLD_RADIUS = 22;
const ENTITY_BASE_WORLD_RADIUS = 4;
const MIN_NODE_HIT_RADIUS = 6;
const NODE_HIT_PADDING = 4;
const MAX_NODE_SCREEN_RADIUS = 2_800;
const MAX_EDGE_LABELS = 200;
const EDGE_LABEL_BUCKET_WIDTH = 96;
const EDGE_LABEL_BUCKET_HEIGHT = 32;
const EDGE_LABEL_MAX_TEXT_WIDTH = 344;
const EDGE_LABEL_HORIZONTAL_PADDING = 8;
const UNRESOLVED_MIXED_RELATION_LABEL = "相关";
const LAYER_OPACITY = {
  overview: { tableEdges: 0.58, entityEdges: 0.10 },
  work: { tableEdges: 0.12, entityEdges: 0.42 },
  detail: { tableEdges: 0.06, entityEdges: 0.55 },
} as const;
const TABLE_PALETTE = [
  "#38bdf8",
  "#2dd4bf",
  "#a78bfa",
  "#fb7185",
  "#fbbf24",
  "#60a5fa",
  "#34d399",
  "#f472b6",
] as const;
const KNOWN_TABLE_COLORS: Readonly<Record<string, string>> = {
  meprocess: "#fbbf24",
  meoperation: "#2dd4bf",
  mestep: "#38bdf8",
  assembly: "#fb7185",
};

export interface WorldPoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface GraphTransform {
  k: number;
  x: number;
  y: number;
}

export interface ScenePoint {
  world: WorldPoint;
  screen: ScreenPoint;
}

export interface SceneNode {
  id: string;
  label: string;
  color?: string;
  world: WorldPoint;
  screen: ScreenPoint;
  screenRadius: number;
  hitRadius: number;
  /** Undefined for table nodes; present (possibly empty) for entity labels. */
  secondaryLabel?: string;
}

export interface SceneEntityNode extends SceneNode {
  tableId: string;
  className: string | null;
  presentation: BusinessEntityPresentation;
  visibleDegree: number;
}

export interface SceneLabel {
  nodeId: string;
  text: string;
  primary: string;
  secondary: string;
  world: WorldPoint;
  screen: ScreenPoint;
  screenRadius: number;
}

export type SceneEdgeLineStyle = "solid" | "dashed";
export type SceneDirection = "forward" | "reverse" | "undirected";

export interface SceneEdge {
  id: string;
  label: string;
  lineStyle: SceneEdgeLineStyle;
  from: ScenePoint;
  to: ScenePoint;
  sourceId: string;
  targetId: string;
  geometry: QuadraticGeometry;
  direction: SceneDirection;
}

export interface SceneEdgeLabel {
  edgeId: string;
  kind: "table" | "entity";
  text: string;
  maxWidth: number;
  lineStyle: SceneEdgeLineStyle;
  world: WorldPoint;
  screen: ScreenPoint;
}

export interface RenderScene {
  transform: GraphTransform;
  zoomLevel: SemanticZoomLevel;
  layerOpacity: {
    tableEdges: number;
    entityEdges: number;
  };
  tableNodes: SceneNode[];
  tableEdges: SceneEdge[];
  entityDots: SceneEntityNode[];
  entityEdges: SceneEdge[];
  entityLabels: SceneLabel[];
  edgeLabels: SceneEdgeLabel[];
  hitIndex: SceneHitIndex;
}

export interface BuildSceneInput {
  graph: SemanticGraphData;
  layout: GraphLayout;
  transform: GraphTransform;
  confidenceThreshold: number;
  presentations?: ReadonlyMap<string, BusinessEntityPresentation>;
}

function validPoint(point: WorldPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedTransform(transform: GraphTransform): GraphTransform {
  return {
    k: Number.isFinite(transform.k) && transform.k > 0 ? transform.k : 1,
    x: Number.isFinite(transform.x) ? transform.x : 0,
    y: Number.isFinite(transform.y) ? transform.y : 0,
  };
}

function normalizedThreshold(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function toScreen(point: WorldPoint, transform: GraphTransform): ScreenPoint {
  return {
    x: point.x * transform.k + transform.x,
    y: point.y * transform.k + transform.y,
  };
}

export function tableColor(tableId: string): string {
  const knownColor = KNOWN_TABLE_COLORS[tableId.toLowerCase()];
  if (knownColor) return knownColor;
  let hash = 2166136261;
  for (let index = 0; index < tableId.length; index += 1) {
    hash ^= tableId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return TABLE_PALETTE[(hash >>> 0) % TABLE_PALETTE.length];
}

function nodeCommand(
  node: LayoutTableNode | LayoutEntityNode,
  label: string,
  color: string,
  transform: GraphTransform,
  worldRadius: number,
): SceneNode | null {
  const world = { x: node.x, y: node.y };
  if (!validPoint(world)) return null;
  const screen = toScreen(world, transform);
  if (!validPoint(screen)) return null;
  const screenRadius = worldRadius * transform.k;
  if (
    !Number.isFinite(screenRadius) ||
    screenRadius <= 0 ||
    screenRadius > MAX_NODE_SCREEN_RADIUS
  ) {
    return null;
  }
  const hitRadius = Math.max(MIN_NODE_HIT_RADIUS, screenRadius) + NODE_HIT_PADDING;
  if (!Number.isFinite(hitRadius) || hitRadius <= 0) return null;
  return {
    id: node.id,
    label,
    color,
    world,
    screen,
    screenRadius,
    hitRadius,
  };
}

function edgeCommand(
  edge: LayoutEdge,
  transform: GraphTransform,
  label: string,
  lineStyle: SceneEdgeLineStyle,
  source: SceneNode,
  target: SceneNode,
  direction: SceneDirection,
  parallelLane: ParallelLane,
): SceneEdge | null {
  if (!validPoint(edge.from) || !validPoint(edge.to)) return null;
  const from = toScreen(edge.from, transform);
  const to = toScreen(edge.to, transform);
  if (!validPoint(from) || !validPoint(to)) return null;
  return {
    id: edge.id,
    label,
    lineStyle,
    from: { world: { ...edge.from }, screen: from },
    to: { world: { ...edge.to }, screen: to },
    sourceId: edge.source,
    targetId: edge.target,
    geometry: buildQuadraticGeometry({
      edgeId: edge.id,
      from,
      to,
      fromBounds: labelBounds(source),
      toBounds: labelBounds(target),
      parallelOrdinal: parallelLane.ordinal,
      parallelCount: parallelLane.count,
    }),
    direction,
  };
}

function tableEdgeVisible(edge: TableEdgeData, threshold: number): boolean {
  return edge.strong_count > 0 ||
    (Number.isFinite(edge.average_confidence) &&
      edge.average_confidence >= threshold);
}

function relationLabel(
  relations: readonly Pick<EntityRelationData, "display_label" | "relation_type">[],
): string {
  return [...new Set(relations.map(businessRelationLabel))].sort().join(" · ");
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

interface ParallelLane {
  ordinal: number;
  count: number;
}

function parallelLanes<T extends { id: string }>(
  edges: readonly T[],
  endpoints: (edge: T) => readonly [string, string],
): Map<string, ParallelLane> {
  const groups = new Map<string, T[]>();
  for (const edge of edges) {
    const [source, target] = endpoints(edge);
    const pair = compareCodeUnits(source, target) <= 0
      ? [source, target]
      : [target, source];
    const key = JSON.stringify(pair);
    const group = groups.get(key);
    if (group) group.push(edge);
    else groups.set(key, [edge]);
  }
  const lanes = new Map<string, ParallelLane>();
  for (const group of groups.values()) {
    group.sort((left, right) => compareCodeUnits(left.id, right.id));
    group.forEach((edge, ordinal) => {
      lanes.set(edge.id, { ordinal, count: group.length });
    });
  }
  return lanes;
}

function layoutEdgesFor(
  graphEdges: readonly { id: string }[],
  layoutEdges: readonly LayoutEdge[],
): Map<string, LayoutEdge> {
  const layoutById = byId(layoutEdges);
  return new Map(graphEdges.flatMap((edge) => {
    const layoutEdge = layoutById.get(edge.id);
    return layoutEdge ? [[edge.id, layoutEdge] as const] : [];
  }));
}

function entityWorldRadius(degree: number): number {
  return ENTITY_BASE_WORLD_RADIUS + Math.min(6, Math.sqrt(Math.max(0, degree)) * 1.8);
}

function labelBounds(node: SceneNode): readonly ScreenBounds[] {
  const nodePadding = NODE_HIT_PADDING;
  const nodeBounds = {
    left: node.screen.x - node.screenRadius - nodePadding,
    top: node.screen.y - node.screenRadius - nodePadding,
    right: node.screen.x + node.screenRadius + nodePadding,
    bottom: node.screen.y + node.screenRadius + nodePadding,
  };
  const secondary = node.secondaryLabel;
  const labelWidth = secondary === undefined
    ? node.label.length * 7
    : Math.max(node.label.length * 7, secondary.length * 6);
  const labelTop = node.screen.y + node.screenRadius +
    (secondary === undefined ? 3 : 6);
  const labelBottom = node.screen.y + node.screenRadius +
    (secondary === undefined ? 15 : secondary ? 31 : 19);
  return [
    nodeBounds,
    {
      left: node.screen.x - labelWidth / 2,
      top: labelTop,
      right: node.screen.x + labelWidth / 2,
      bottom: labelBottom,
    },
  ];
}

function relationDirection(
  relations: readonly EntityRelationData[],
): SceneDirection {
  const directions = new Set(relations.map((relation) => relation.direction));
  if (directions.size !== 1) return "undirected";
  const [direction] = directions;
  return direction === "source_to_target"
    ? "forward"
    : direction === "target_to_source"
      ? "reverse"
      : "undirected";
}

interface LabelBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overlaps(left: LabelBounds, right: LabelBounds): boolean {
  return left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top;
}

function bucketKeys(bounds: LabelBounds): string[] | null {
  const minColumn = Math.floor(bounds.left / EDGE_LABEL_BUCKET_WIDTH);
  const maxColumn = Math.floor(bounds.right / EDGE_LABEL_BUCKET_WIDTH);
  const minRow = Math.floor(bounds.top / EDGE_LABEL_BUCKET_HEIGHT);
  const maxRow = Math.floor(bounds.bottom / EDGE_LABEL_BUCKET_HEIGHT);
  if (
    ![minColumn, maxColumn, minRow, maxRow].every(Number.isSafeInteger) ||
    maxColumn - minColumn > 16 ||
    maxRow - minRow > 16
  ) {
    return null;
  }
  const keys: string[] = [];
  for (let column = minColumn; column <= maxColumn; column += 1) {
    for (let row = minRow; row <= maxRow; row += 1) {
      keys.push(`${column}:${row}`);
    }
  }
  return keys;
}

function buildEdgeLabels(
  tableEdges: readonly SceneEdge[],
  entityEdges: readonly SceneEdge[],
  transform: GraphTransform,
  reservedBounds: readonly LabelBounds[],
): SceneEdgeLabel[] {
  const occupiedByBucket = new Map<string, LabelBounds[]>();
  const candidates = [
    ...(transform.k >= TABLE_EDGE_LABEL_ZOOM
      ? tableEdges.map((edge) => ({ edge, kind: "table" as const }))
      : []),
    ...(transform.k >= ENTITY_EDGE_LABEL_ZOOM
      ? entityEdges.map((edge) => ({ edge, kind: "entity" as const }))
      : []),
  ].filter(({ edge }) => edge.label.length > 0)
    .sort((left, right) => {
      const leftStrength = left.edge.lineStyle === "solid" ? 0 : 1;
      const rightStrength = right.edge.lineStyle === "solid" ? 0 : 1;
      const leftKind = left.kind === "table" ? 0 : 1;
      const rightKind = right.kind === "table" ? 0 : 1;
      return leftStrength - rightStrength ||
        leftKind - rightKind ||
        compareCodeUnits(left.edge.id, right.edge.id);
    });
  const labels: SceneEdgeLabel[] = [];

  for (const { edge, kind } of candidates) {
    if (labels.length >= MAX_EDGE_LABELS) break;
    const world = {
      x: (edge.from.world.x + edge.to.world.x) / 2,
      y: (edge.from.world.y + edge.to.world.y) / 2,
    };
    if (![world.x, world.y].every((value) =>
      Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    )) continue;
    const screen = {
      ...quadraticPoint(edge.geometry, 0.5),
    };
    const maxWidth = Math.min(
      EDGE_LABEL_MAX_TEXT_WIDTH,
      edge.label.length * 7,
    );
    const halfWidth = maxWidth / 2 + EDGE_LABEL_HORIZONTAL_PADDING;
    const bounds = {
      left: screen.x - halfWidth,
      right: screen.x + halfWidth,
      top: screen.y - 10,
      bottom: screen.y + 10,
    };
    if (
      kind === "entity" &&
      reservedBounds.some((reserved) => overlaps(reserved, bounds))
    ) continue;
    const keys = bucketKeys(bounds);
    if (!keys) continue;
    const nearby = new Set(
      keys.flatMap((key) => occupiedByBucket.get(key) ?? []),
    );
    if ([...nearby].some((existing) => overlaps(existing, bounds))) continue;
    for (const key of keys) {
      const bucket = occupiedByBucket.get(key);
      if (bucket) bucket.push(bounds);
      else occupiedByBucket.set(key, [bounds]);
    }
    labels.push({
      edgeId: edge.id,
      kind,
      text: edge.label,
      maxWidth,
      lineStyle: edge.lineStyle,
      world,
      screen,
    });
  }
  return labels;
}

function tableEdgeSemantics(
  edge: TableEdgeData,
  entityEdges: ReadonlyMap<string, EntityEdgeData>,
  threshold: number,
): Pick<SceneEdge, "label" | "lineStyle" | "direction"> | null {
  const supportingEdges = edge.supporting_entity_edges.flatMap((id) => {
    const supporting = entityEdges.get(id);
    return supporting ? [supporting] : [];
  });
  if (supportingEdges.length > 0) {
    const relations = supportingEdges.flatMap((supporting) =>
      visibleEntityRelations(supporting, threshold)
    );
    if (relations.length === 0) return null;
    return {
      label: relationLabel(relations),
      lineStyle: relations.some((relation) => relation.strength === "strong")
        ? "solid"
        : "dashed",
      direction: relationDirection(relations),
    };
  }
  if (!tableEdgeVisible(edge, threshold)) return null;
  if (edge.strong_count > 0 && edge.weak_count > 0) {
    return {
      label: UNRESOLVED_MIXED_RELATION_LABEL,
      lineStyle: "solid",
      direction: "undirected",
    };
  }
  return {
    label: relationLabel(
      edge.relation_types.map((relation_type) => ({ relation_type })),
    ),
    lineStyle: edge.strong_count > 0 ? "solid" : "dashed",
    direction: "undirected",
  };
}

export function buildScene(input: BuildSceneInput): RenderScene {
  const transform = normalizedTransform(input.transform);
  const zoomLevel = semanticZoomLevel(transform.k);
  const threshold = normalizedThreshold(input.confidenceThreshold);
  const tableData = byId<TableNodeData>(input.graph.table_nodes);
  const entityData = byId<EntityNodeData>(input.graph.entity_nodes);
  const graphEntityEdges = byId(input.graph.entity_edges);
  const tableLayouts = layoutEdgesFor(
    input.graph.table_edges,
    input.layout.tableEdges,
  );
  const entityLayouts = layoutEdgesFor(
    input.graph.entity_edges,
    input.layout.entityEdges,
  );
  const tableLanes = parallelLanes(
    input.graph.table_edges,
    (edge) => [edge.source_table, edge.target_table],
  );
  const entityLanes = parallelLanes(
    input.graph.entity_edges,
    (edge) => [edge.source, edge.target],
  );
  const renderableEntityIds = new Set(
    input.layout.entityNodes.flatMap((node) => {
      const world = { x: node.x, y: node.y };
      if (!entityData.has(node.id) || !validPoint(world)) return [];
      return validPoint(toScreen(world, transform)) ? [node.id] : [];
    }),
  );
  const renderableVisibleEntityEdges = input.graph.entity_edges.filter((edge) => {
    const layoutEdge = entityLayouts.get(edge.id);
    return layoutEdge != null &&
      renderableEntityIds.has(edge.source) &&
      renderableEntityIds.has(edge.target) &&
      validPoint(layoutEdge.from) &&
      validPoint(layoutEdge.to) &&
      validPoint(toScreen(layoutEdge.from, transform)) &&
      validPoint(toScreen(layoutEdge.to, transform)) &&
      visibleEntityRelations(edge, threshold).length > 0;
  });
  const degrees = computeEntityDegrees(
    input.graph.entity_nodes,
    renderableVisibleEntityEdges,
  );
  const presentations = input.presentations ?? buildBusinessPresentationIndex(
    input.graph.entity_nodes,
    degrees,
  );
  const tableNodes = input.layout.tableNodes.flatMap((node) => {
    const data = tableData.get(node.id);
    const command = data
      ? nodeCommand(
        node,
        data.display_name,
        tableColor(node.id),
        transform,
        TABLE_WORLD_RADIUS,
      )
      : null;
    return command ? [command] : [];
  });
  const sceneTables = byId(tableNodes);
  const tableEdges = input.graph.table_edges.flatMap((edge) => {
    const layoutEdge = tableLayouts.get(edge.id);
    const source = sceneTables.get(edge.source_table);
    const target = sceneTables.get(edge.target_table);
    const semantics = tableEdgeSemantics(edge, graphEntityEdges, threshold);
    if (
      !layoutEdge ||
      !source ||
      !target ||
      !semantics
    ) {
      return [];
    }
    const command = edgeCommand(
      layoutEdge,
      transform,
      semantics.label,
      semantics.lineStyle,
      source,
      target,
      semantics.direction,
      tableLanes.get(edge.id) ?? { ordinal: 0, count: 1 },
    );
    return command ? [command] : [];
  });

  const entityDots = input.layout.entityNodes.flatMap((node) => {
      const data = entityData.get(node.id);
      if (!data) return [];
      const visibleDegree = degrees.get(node.id) ?? 0;
      const presentation = presentations.get(data.id);
      if (!presentation) return [];
      const command = nodeCommand(
        node,
        presentation.primary,
        tableColor(node.tableId),
        transform,
        entityWorldRadius(visibleDegree),
      );
      return command
        ? [{
          ...command,
          secondaryLabel: zoomLevel === "overview" ? "" : presentation.secondary,
          tableId: node.tableId,
          className: data.class_name,
          presentation,
          visibleDegree,
        }]
        : [];
    });
  const sceneEntities = byId(entityDots);
  const entityEdges = input.graph.entity_edges.flatMap((edge) => {
      const layoutEdge = entityLayouts.get(edge.id);
      const source = sceneEntities.get(edge.source);
      const target = sceneEntities.get(edge.target);
      const relations = visibleEntityRelations(edge, threshold);
      if (!layoutEdge || !source || !target || relations.length === 0) return [];
      const command = edgeCommand(
        layoutEdge,
        transform,
        relationLabel(relations),
        relations.some((relation) => relation.strength === "strong")
          ? "solid"
          : "dashed",
        source,
        target,
        relationDirection(relations),
        entityLanes.get(edge.id) ?? { ordinal: 0, count: 1 },
      );
      return command ? [command] : [];
    });
  const entityLabels = entityDots
    .filter((node) => zoomLevel !== "overview" || node.visibleDegree > 0)
    .map((node) => ({
      nodeId: node.id,
      text: node.presentation.primary,
      primary: node.presentation.primary,
      secondary: zoomLevel === "overview" ? "" : node.presentation.secondary,
      world: node.world,
      screen: node.screen,
      screenRadius: node.screenRadius,
    }));
  const edgeLabels = buildEdgeLabels(
    tableEdges,
    entityEdges,
    transform,
    entityLabels.map((label) => ({
      left: label.screen.x - Math.max(
        label.primary.length * 7,
        label.secondary.length * 6,
      ) / 2,
      right: label.screen.x + Math.max(
        label.primary.length * 7,
        label.secondary.length * 6,
      ) / 2,
      top: label.screen.y + label.screenRadius + 6,
      bottom: label.screen.y + label.screenRadius + (label.secondary ? 31 : 19),
    })),
  );

  const sceneWithoutIndex = {
    transform,
    zoomLevel,
    layerOpacity: LAYER_OPACITY[zoomLevel],
    tableNodes,
    tableEdges,
    entityDots,
    entityEdges,
    entityLabels,
    edgeLabels,
  };
  return {
    ...sceneWithoutIndex,
    hitIndex: createHitIndex(sceneWithoutIndex),
  };
}
