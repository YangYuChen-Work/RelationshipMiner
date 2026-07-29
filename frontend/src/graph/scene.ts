import type {
  EntityEdgeData,
  EntityNodeData,
  SemanticGraphData,
  TableEdgeData,
  TableNodeData,
} from "../api/analysis";
import type { GraphLayout, LayoutEdge, LayoutEntityNode, LayoutTableNode, TableRegion } from "./layout";
import { createHitIndex, type SceneHitIndex } from "./hitTest";

const TABLE_ONLY_ZOOM = 0.65;
const ENTITY_LABEL_ZOOM = 1.2;
const TABLE_WORLD_RADIUS = 14;
const ENTITY_WORLD_RADIUS = 4;
const MIN_NODE_HIT_RADIUS = 6;
const NODE_HIT_PADDING = 4;
const MAX_NODE_SCREEN_RADIUS = 4_000;

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
  world: WorldPoint;
  screen: ScreenPoint;
  screenRadius: number;
  hitRadius: number;
}

export interface SceneEntityNode extends SceneNode {
  tableId: string;
  className: string | null;
}

export interface SceneLabel {
  nodeId: string;
  text: string;
  world: WorldPoint;
  screen: ScreenPoint;
}

export interface SceneEdge {
  id: string;
  from: ScenePoint;
  to: ScenePoint;
}

export interface SceneTableRegion {
  id: string;
  world: Pick<TableRegion, "x" | "y" | "width" | "height">;
  screen: Pick<TableRegion, "x" | "y" | "width" | "height">;
}

export interface RenderScene {
  transform: GraphTransform;
  tableRegions: SceneTableRegion[];
  tableNodes: SceneNode[];
  tableEdges: SceneEdge[];
  entityDots: SceneEntityNode[];
  entityEdges: SceneEdge[];
  entityLabels: SceneLabel[];
  hitIndex: SceneHitIndex;
}

export interface BuildSceneInput {
  graph: SemanticGraphData;
  layout: GraphLayout;
  transform: GraphTransform;
  confidenceThreshold: number;
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

function nodeCommand(
  node: LayoutTableNode | LayoutEntityNode,
  label: string,
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
    world,
    screen,
    screenRadius,
    hitRadius,
  };
}

function edgeCommand(edge: LayoutEdge, transform: GraphTransform): SceneEdge | null {
  if (!validPoint(edge.from) || !validPoint(edge.to)) return null;
  const from = toScreen(edge.from, transform);
  const to = toScreen(edge.to, transform);
  if (!validPoint(from) || !validPoint(to)) return null;
  return {
    id: edge.id,
    from: { world: { ...edge.from }, screen: from },
    to: { world: { ...edge.to }, screen: to },
  };
}

function relationVisible(relation: EntityEdgeData["relations"][number], threshold: number): boolean {
  return relation.strength === "strong" || (Number.isFinite(relation.confidence) && relation.confidence >= threshold);
}

function entityEdgeVisible(edge: EntityEdgeData, threshold: number): boolean {
  return edge.relations.some((relation) => relationVisible(relation, threshold));
}

function tableEdgeVisible(edge: TableEdgeData, threshold: number): boolean {
  return edge.strong_count > 0 || (Number.isFinite(edge.average_confidence) && edge.average_confidence >= threshold);
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function tableRegionCommand(region: TableRegion, transform: GraphTransform): SceneTableRegion | null {
  const world = { x: region.x, y: region.y, width: region.width, height: region.height };
  if (
    !Object.values(world).every(Number.isFinite) ||
    world.width <= 0 ||
    world.height <= 0
  ) {
    return null;
  }
  const screen = {
    x: world.x * transform.k + transform.x,
    y: world.y * transform.k + transform.y,
    width: world.width * transform.k,
    height: world.height * transform.k,
  };
  if (!Object.values(screen).every((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return {
    id: region.id,
    world,
    screen,
  };
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

export function buildScene(input: BuildSceneInput): RenderScene {
  const transform = normalizedTransform(input.transform);
  const threshold = normalizedThreshold(input.confidenceThreshold);
  const tableData = byId<TableNodeData>(input.graph.table_nodes);
  const entityData = byId<EntityNodeData>(input.graph.entity_nodes);
  const layoutTables = byId(input.layout.tableNodes);
  const layoutEntities = byId(input.layout.entityNodes);
  const tableLayouts = layoutEdgesFor(input.graph.table_edges, input.layout.tableEdges);
  const entityLayouts = layoutEdgesFor(input.graph.entity_edges, input.layout.entityEdges);
  const tableRegions = input.layout.tableRegions
    .filter((region) => tableData.has(region.id))
    .flatMap((region) => {
      const command = tableRegionCommand(region, transform);
      return command ? [command] : [];
    });
  const tableNodes = input.layout.tableNodes.flatMap((node) => {
    const data = tableData.get(node.id);
    const command = data ? nodeCommand(node, data.display_name, transform, TABLE_WORLD_RADIUS) : null;
    return command ? [command] : [];
  });
  const tableEdges = input.graph.table_edges.flatMap((edge) => {
    const layoutEdge = tableLayouts.get(edge.id);
    const source = layoutTables.get(edge.source_table);
    const target = layoutTables.get(edge.target_table);
    if (!layoutEdge || !source || !target || !tableEdgeVisible(edge, threshold)) return [];
    const command = edgeCommand(layoutEdge, transform);
    return command ? [command] : [];
  });

  const showEntities = transform.k >= TABLE_ONLY_ZOOM;
  const entityDots = showEntities
    ? input.layout.entityNodes.flatMap((node) => {
      const data = entityData.get(node.id);
      if (!data) return [];
      const command = nodeCommand(node, data.display_name, transform, ENTITY_WORLD_RADIUS);
      return command ? [{ ...command, tableId: node.tableId, className: data.class_name }] : [];
    })
    : [];
  const entityEdges = showEntities
    ? input.graph.entity_edges.flatMap((edge) => {
      const layoutEdge = entityLayouts.get(edge.id);
      const source = layoutEntities.get(edge.source);
      const target = layoutEntities.get(edge.target);
      if (!layoutEdge || !source || !target || !entityEdgeVisible(edge, threshold)) return [];
      const command = edgeCommand(layoutEdge, transform);
      return command ? [command] : [];
    })
    : [];
  const entityLabels = transform.k >= ENTITY_LABEL_ZOOM
    ? entityDots.map((node) => ({ nodeId: node.id, text: node.label, world: node.world, screen: node.screen }))
    : [];

  const sceneWithoutIndex = {
    transform,
    tableRegions,
    tableNodes,
    tableEdges,
    entityDots,
    entityEdges,
    entityLabels,
  };
  return { ...sceneWithoutIndex, hitIndex: createHitIndex(sceneWithoutIndex) };
}
