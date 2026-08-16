import type { GraphFocus } from "./focus";
import { quadraticPoint } from "./edgeGeometry";
import type {
  RenderScene,
  SceneEdge,
  SceneEdgeLabel,
  SceneEntityNode,
  SceneLabel,
  SceneNode,
  ScreenPoint,
} from "./scene";

const GRID_SIZE = 28;
const MAX_ENTITY_LABELS = 500;
const LABEL_VIEWPORT_PADDING = 24;
const ENTITY_SELECTED = "#5edbd1";
const GRAPH_BACKGROUND = "#0e151d";
const GRAPH_GRID = "#1a2a34";
const ENTITY_EDGE = "#4f6872";
const TABLE_EDGE = "#6f8a8e";
const PRIMARY_TEXT = "#f4f0e8";
const SECONDARY_TEXT = "#8d9aa0";
const NODE_OUTLINE = "#b8ded7";
const ACTIVE_NODE_OUTLINE = "#c7a675";
const UNRELATED_NODE_OPACITY = 0.07;
const UNRELATED_EDGE_OPACITY = 0.028;
const FOCUS_EDGE_WIDTH = 2.2;
const EMPTY_EDGE_IDS: ReadonlySet<string> = new Set();

export interface GraphDragPreview {
  readonly node: SceneEntityNode;
  readonly incidentEdges: readonly SceneEdge[];
  readonly incidentEdgeIds: ReadonlySet<string>;
  readonly incidentLabels: readonly SceneEdgeLabel[];
}

export interface DrawGraphOptions {
  readonly width: number;
  readonly height: number;
  readonly focus: GraphFocus;
  readonly selectedEntityEdgeId: string | null;
  readonly selectedTableEdgeId: string | null;
  readonly dragPreview?: {
    readonly preview: GraphDragPreview;
    readonly screen: ScreenPoint;
  };
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface DrawState {
  readonly focusedNodeIds: ReadonlySet<string>;
  readonly focusedTableNodeIds: ReadonlySet<string>;
  readonly focusedEntityEdgeIds: ReadonlySet<string>;
  readonly focusedTableEdgeIds: ReadonlySet<string>;
  readonly activeNodeId: string | null;
  readonly hasFocus: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function semanticLayer(
  context: CanvasRenderingContext2D,
  alpha: number,
  draw: () => void,
): void {
  context.save();
  context.globalAlpha = alpha;
  draw();
  context.restore();
  // Some test and embedded Canvas implementations do not restore properties.
  context.globalAlpha = 1;
}

function focusedDrawState(
  scene: RenderScene,
  options: DrawGraphOptions,
): DrawState {
  const focusedNodeIds = new Set(options.focus.nodeIds);
  const focusedTableNodeIds = new Set<string>();
  const focusedEntityEdgeIds = new Set(options.focus.edgeIds);
  const focusedTableEdgeIds = new Set<string>();
  let activeNodeId = options.focus.activeNodeId;

  if (options.selectedEntityEdgeId) {
    const edge = scene.entityEdges.find(
      (candidate) => candidate.id === options.selectedEntityEdgeId,
    );
    if (edge) {
      focusedEntityEdgeIds.add(edge.id);
      focusedNodeIds.add(edge.sourceId);
      focusedNodeIds.add(edge.targetId);
      activeNodeId = null;
    }
  }
  if (options.selectedTableEdgeId) {
    const edge = scene.tableEdges.find(
      (candidate) => candidate.id === options.selectedTableEdgeId,
    );
    if (edge) {
      focusedTableEdgeIds.add(edge.id);
      focusedTableNodeIds.add(edge.sourceId);
      focusedTableNodeIds.add(edge.targetId);
    }
    activeNodeId = null;
  }

  const entityById = new Map(scene.entityDots.map((node) => [node.id, node]));
  for (const nodeId of focusedNodeIds) {
    const entity = entityById.get(nodeId);
    if (entity) focusedTableNodeIds.add(entity.tableId);
  }

  return {
    focusedNodeIds,
    focusedTableNodeIds,
    focusedEntityEdgeIds,
    focusedTableEdgeIds,
    activeNodeId,
    hasFocus:
      activeNodeId != null ||
      focusedEntityEdgeIds.size > 0 ||
      focusedTableEdgeIds.size > 0,
  };
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  semanticLayer(context, 1, () => {
    context.clearRect(0, 0, width, height);
    context.fillStyle = GRAPH_BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = GRAPH_GRID;
    context.lineWidth = 0.7;
    for (let x = 0; x <= width; x += GRID_SIZE) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
    for (let y = 0; y <= height; y += GRID_SIZE) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }
  });
}

function drawCurve(
  context: CanvasRenderingContext2D,
  edge: SceneEdge,
  stroke: string,
  width: number,
): void {
  context.beginPath();
  context.moveTo(edge.geometry.from.x, edge.geometry.from.y);
  context.quadraticCurveTo?.(
    edge.geometry.control.x,
    edge.geometry.control.y,
    edge.geometry.to.x,
    edge.geometry.to.y,
  );
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.setLineDash?.(edge.lineStyle === "dashed" ? [6, 5] : []);
  context.stroke();
  context.setLineDash?.([]);
}

function arrowTip(edge: SceneEdge) {
  if (edge.direction === "reverse") {
    return {
      tip: edge.geometry.from,
      tangentFrom: edge.geometry.control,
    };
  }
  return {
    tip: edge.geometry.to,
    tangentFrom: edge.geometry.control,
  };
}

function drawArrowhead(
  context: CanvasRenderingContext2D,
  edge: SceneEdge,
  color: string,
): void {
  if (edge.direction === "undirected") return;
  const { tip, tangentFrom } = arrowTip(edge);
  const angle = Math.atan2(tip.y - tangentFrom.y, tip.x - tangentFrom.x);
  const length = 8;
  const wing = Math.PI / 7;
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(
    tip.x - Math.cos(angle - wing) * length,
    tip.y - Math.sin(angle - wing) * length,
  );
  context.lineTo(
    tip.x - Math.cos(angle + wing) * length,
    tip.y - Math.sin(angle + wing) * length,
  );
  context.closePath?.();
  context.fillStyle = color;
  context.fill();
}

function drawEdges(
  context: CanvasRenderingContext2D,
  edges: readonly SceneEdge[],
  stroke: string,
  width: number,
  alpha: number,
): void {
  if (edges.length === 0) return;
  semanticLayer(context, alpha, () => {
    for (const edge of edges) {
      drawCurve(context, edge, stroke, width);
    }
  });
}

function drawArrowheads(
  context: CanvasRenderingContext2D,
  edges: readonly SceneEdge[],
  color: string,
  alpha: number,
): void {
  if (edges.length === 0) return;
  semanticLayer(context, alpha, () => {
    for (const edge of edges) drawArrowhead(context, edge, color);
  });
}

function drawEntityNode(
  context: CanvasRenderingContext2D,
  entity: SceneEntityNode,
  active: boolean,
): void {
  context.beginPath();
  context.arc(
    entity.screen.x,
    entity.screen.y,
    entity.screenRadius,
    0,
    Math.PI * 2,
  );
  context.fillStyle = entity.color ?? "#7dd3fc";
  context.fill();
  context.strokeStyle = active ? ACTIVE_NODE_OUTLINE : NODE_OUTLINE;
  context.lineWidth = active ? 3 : 1.5;
  context.stroke();
}

function drawEntityNodes(
  context: CanvasRenderingContext2D,
  nodes: readonly SceneEntityNode[],
  alpha: number,
  activeNodeId: string | null,
): void {
  if (nodes.length === 0) return;
  semanticLayer(context, alpha, () => {
    for (const node of nodes) {
      drawEntityNode(context, node, node.id === activeNodeId);
    }
  });
}

function drawTableNode(
  context: CanvasRenderingContext2D,
  table: SceneNode,
): void {
  context.beginPath();
  context.arc(
    table.screen.x,
    table.screen.y,
    table.screenRadius,
    0,
    Math.PI * 2,
  );
  context.fillStyle = table.color ?? "#38bdf8";
  context.fill();
  context.strokeStyle = NODE_OUTLINE;
  context.lineWidth = 1.5;
  context.stroke();
  context.fillStyle = PRIMARY_TEXT;
  context.font = "650 12px Manrope, Noto Sans SC, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    table.label,
    table.screen.x,
    table.screen.y + table.screenRadius + 9,
  );
}

function overlaps(left: Bounds, right: Bounds): boolean {
  return left.left < right.right &&
    left.right > right.left &&
    left.top < right.bottom &&
    left.bottom > right.top;
}

function labelBounds(
  context: CanvasRenderingContext2D,
  label: SceneLabel,
): Bounds {
  const primaryWidth = context.measureText?.(label.primary).width ??
    label.primary.length * 7;
  const secondaryWidth = label.secondary
    ? context.measureText?.(label.secondary).width ?? label.secondary.length * 6
    : 0;
  return {
    left: label.screen.x - Math.max(primaryWidth, secondaryWidth) / 2,
    top: label.screen.y + label.screenRadius + 6,
    right: label.screen.x + Math.max(primaryWidth, secondaryWidth) / 2,
    bottom: label.screen.y + label.screenRadius + (label.secondary ? 31 : 19),
  };
}

function inViewport(label: SceneLabel, options: DrawGraphOptions): boolean {
  return label.screen.x >= -LABEL_VIEWPORT_PADDING &&
    label.screen.x <= options.width + LABEL_VIEWPORT_PADDING &&
    label.screen.y >= -LABEL_VIEWPORT_PADDING &&
    label.screen.y <= options.height + LABEL_VIEWPORT_PADDING;
}

function drawEntityLabel(
  context: CanvasRenderingContext2D,
  label: SceneLabel,
): void {
  const labelTop = label.screen.y + label.screenRadius + 6;
  context.fillStyle = PRIMARY_TEXT;
  context.font = "650 11px Manrope, Noto Sans SC, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(label.primary, label.screen.x, labelTop);
  if (label.secondary) {
    context.fillStyle = SECONDARY_TEXT;
    context.font = "9px Manrope, Noto Sans SC, sans-serif";
    context.textBaseline = "top";
    context.fillText(label.secondary, label.screen.x, labelTop + 14);
  }
}

function drawBackgroundLabels(
  context: CanvasRenderingContext2D,
  labels: readonly SceneLabel[],
  options: DrawGraphOptions,
  occupied: Bounds[],
  alpha: number,
): void {
  semanticLayer(context, alpha, () => {
    let drawn = 0;
    for (const label of labels) {
      if (drawn >= MAX_ENTITY_LABELS || !inViewport(label, options)) continue;
      const bounds = labelBounds(context, label);
      if (occupied.some((existing) => overlaps(existing, bounds))) continue;
      occupied.push(bounds);
      drawEntityLabel(context, label);
      drawn += 1;
    }
  });
}

function drawEdgeLabel(
  context: CanvasRenderingContext2D,
  label: SceneEdgeLabel,
  focused: boolean,
): void {
  context.font = "600 10px Manrope, Noto Sans SC, sans-serif";
  context.textAlign = "start";
  context.textBaseline = "middle";
  if (focused) {
    context.fillStyle = "rgba(18, 28, 37, 0.94)";
    context.fillRect(
      label.screen.x - label.maxWidth / 2 - 5,
      label.screen.y - 10,
      label.maxWidth + 10,
      20,
    );
  }
  context.fillStyle = focused
    ? ENTITY_SELECTED
    : label.lineStyle === "solid" ? PRIMARY_TEXT : SECONDARY_TEXT;
  context.fillText(
    label.text,
    label.screen.x - label.maxWidth / 2,
    label.screen.y - 5,
    label.maxWidth,
  );
}

function edgeLabelDrawState(
  label: SceneEdgeLabel,
  hasFocus: boolean,
  focusedEntityEdgeIds: ReadonlySet<string>,
  focusedTableEdgeIds: ReadonlySet<string>,
): { visible: boolean; focused: boolean } {
  const focused = label.kind === "entity"
    ? focusedEntityEdgeIds.has(label.edgeId)
    : focusedTableEdgeIds.has(label.edgeId);
  return {
    visible: !hasFocus || focused,
    focused,
  };
}

export function drawGraphScene(
  context: CanvasRenderingContext2D,
  scene: RenderScene,
  options: DrawGraphOptions,
): void {
  const state = focusedDrawState(scene, options);
  const excludedNodeId = options.dragPreview?.preview.node.id ?? null;
  const excludedEdgeIds = options.dragPreview?.preview.incidentEdgeIds;
  const entityEdges = excludedEdgeIds
    ? scene.entityEdges.filter((edge) => !excludedEdgeIds.has(edge.id))
    : scene.entityEdges;
  const entityDots = excludedNodeId
    ? scene.entityDots.filter((node) => node.id !== excludedNodeId)
    : scene.entityDots;
  const entityLabels = excludedNodeId
    ? scene.entityLabels.filter((label) => label.nodeId !== excludedNodeId)
    : scene.entityLabels;
  const unrelatedEntityEdges = state.hasFocus
    ? entityEdges.filter((edge) => !state.focusedEntityEdgeIds.has(edge.id))
    : entityEdges;
  const relatedEntityEdges = state.hasFocus
    ? entityEdges.filter((edge) => state.focusedEntityEdgeIds.has(edge.id))
    : [];
  const unrelatedTableEdges = state.hasFocus
    ? scene.tableEdges.filter((edge) => !state.focusedTableEdgeIds.has(edge.id))
    : scene.tableEdges;
  const relatedTableEdges = state.hasFocus
    ? scene.tableEdges.filter((edge) => state.focusedTableEdgeIds.has(edge.id))
    : [];
  const unrelatedNodes = state.hasFocus
    ? entityDots.filter((node) => !state.focusedNodeIds.has(node.id))
    : entityDots;
  const unrelatedTableNodes = state.hasFocus
    ? scene.tableNodes.filter(
      (node) => !state.focusedTableNodeIds.has(node.id),
    )
    : scene.tableNodes;
  const relatedTableNodes = state.hasFocus
    ? scene.tableNodes.filter((node) => state.focusedTableNodeIds.has(node.id))
    : [];
  const relatedNodes = state.hasFocus
    ? entityDots.filter(
      (node) =>
        state.focusedNodeIds.has(node.id) && node.id !== state.activeNodeId,
    )
    : [];
  const activeNode = state.activeNodeId == null
    ? null
    : entityDots.find((node) => node.id === state.activeNodeId) ?? null;
  const activeLabel = activeNode
    ? {
      nodeId: activeNode.id,
      text: activeNode.presentation.primary,
      primary: activeNode.presentation.primary,
      secondary: activeNode.presentation.secondary,
      world: activeNode.world,
      screen: activeNode.screen,
      screenRadius: activeNode.screenRadius,
    }
    : null;
  const occupied: Bounds[] = [];
  if (activeLabel) occupied.push(labelBounds(context, activeLabel));

  drawGrid(context, options.width, options.height);

  drawEdges(
    context,
    unrelatedTableEdges,
    TABLE_EDGE,
    1.5,
    state.hasFocus ? UNRELATED_EDGE_OPACITY : scene.layerOpacity.tableEdges,
  );
  drawEdges(
    context,
    unrelatedEntityEdges,
    ENTITY_EDGE,
    1,
    state.hasFocus ? UNRELATED_EDGE_OPACITY : scene.layerOpacity.entityEdges,
  );

  drawEntityNodes(
    context,
    unrelatedNodes,
    state.hasFocus ? UNRELATED_NODE_OPACITY : 1,
    null,
  );
  semanticLayer(context, state.hasFocus ? UNRELATED_NODE_OPACITY : 1, () => {
    for (const table of unrelatedTableNodes) drawTableNode(context, table);
  });
  const unrelatedLabels = entityLabels
    .filter((label) =>
      !state.hasFocus || !state.focusedNodeIds.has(label.nodeId)
    )
    .sort((left, right) => compareText(left.nodeId, right.nodeId));
  drawBackgroundLabels(
    context,
    unrelatedLabels,
    options,
    occupied,
    state.hasFocus ? UNRELATED_NODE_OPACITY : 1,
  );

  drawEntityNodes(context, relatedNodes, 0.82, null);
  semanticLayer(context, 1, () => {
    for (const table of relatedTableNodes) drawTableNode(context, table);
  });
  drawEdges(
    context,
    relatedTableEdges,
    TABLE_EDGE,
    FOCUS_EDGE_WIDTH,
    1,
  );
  drawEdges(
    context,
    relatedEntityEdges,
    ENTITY_SELECTED,
    FOCUS_EDGE_WIDTH,
    1,
  );

  if (activeNode) drawEntityNodes(context, [activeNode], 1, activeNode.id);

  const relatedLabels = entityLabels
    .filter((label) =>
      state.focusedNodeIds.has(label.nodeId) &&
      label.nodeId !== state.activeNodeId
    )
    .sort((left, right) => compareText(left.nodeId, right.nodeId));
  drawBackgroundLabels(context, relatedLabels, options, occupied, 0.9);
  if (activeLabel) {
    semanticLayer(context, 1, () => drawEntityLabel(context, activeLabel));
  }

  semanticLayer(context, 1, () => {
    for (const label of scene.edgeLabels) {
      if (excludedEdgeIds?.has(label.edgeId)) continue;
      const labelState = edgeLabelDrawState(
        label,
        state.hasFocus,
        state.focusedEntityEdgeIds,
        state.focusedTableEdgeIds,
      );
      if (labelState.visible) {
        drawEdgeLabel(context, label, labelState.focused);
      }
    }
  });

  if (options.dragPreview) {
    drawGraphDragPreview(
      context,
      options.dragPreview.preview,
      options.dragPreview.screen,
      state.focusedEntityEdgeIds,
      state.hasFocus,
    );
  }
  if (scene.zoomLevel === "detail" && !state.hasFocus) {
    drawArrowheads(
      context,
      unrelatedEntityEdges,
      ENTITY_EDGE,
      scene.layerOpacity.entityEdges,
    );
  }
  drawArrowheads(context, relatedTableEdges, TABLE_EDGE, 1);
  drawArrowheads(context, relatedEntityEdges, ENTITY_SELECTED, 1);
}

export function createGraphDragPreview(
  scene: RenderScene,
  nodeId: string,
): GraphDragPreview | null {
  const node = scene.entityDots.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const incidentEdges = scene.entityEdges.filter(
    (edge) => edge.sourceId === nodeId || edge.targetId === nodeId,
  );
  const incidentEdgeIds = new Set(incidentEdges.map((edge) => edge.id));
  return {
    node,
    incidentEdges,
    incidentEdgeIds,
    incidentLabels: scene.edgeLabels.filter(
      (label) =>
        label.kind === "entity" &&
        incidentEdgeIds.has(label.edgeId),
    ),
  };
}

function shiftedPreviewEdge(
  edge: SceneEdge,
  nodeId: string,
  delta: ScreenPoint,
): SceneEdge {
  const shiftsFrom = edge.sourceId === nodeId;
  const shiftsTo = edge.targetId === nodeId;
  const controlFactor = (shiftsFrom ? 0.5 : 0) + (shiftsTo ? 0.5 : 0);
  const shift = (point: ScreenPoint, factor: number): ScreenPoint => ({
    x: point.x + delta.x * factor,
    y: point.y + delta.y * factor,
  });
  return {
    ...edge,
    geometry: {
      ...edge.geometry,
      from: shift(edge.geometry.from, shiftsFrom ? 1 : 0),
      control: shift(edge.geometry.control, controlFactor),
      to: shift(edge.geometry.to, shiftsTo ? 1 : 0),
    },
  };
}

export function drawGraphDragPreview(
  context: CanvasRenderingContext2D,
  preview: GraphDragPreview,
  screen: ScreenPoint,
  focusedEdgeIds: ReadonlySet<string> = EMPTY_EDGE_IDS,
  hasFocus = false,
): void {
  const delta = {
    x: screen.x - preview.node.screen.x,
    y: screen.y - preview.node.screen.y,
  };
  const edges = preview.incidentEdges.map((edge) =>
    shiftedPreviewEdge(edge, preview.node.id, delta)
  );
  drawEdges(context, edges, ENTITY_SELECTED, FOCUS_EDGE_WIDTH, 1);
  const node = {
    ...preview.node,
    screen: { ...screen },
  };
  drawEntityNodes(context, [node], 1, node.id);
  semanticLayer(context, 1, () =>
    drawEntityLabel(context, {
      nodeId: node.id,
      text: node.presentation.primary,
      primary: node.presentation.primary,
      secondary: node.presentation.secondary,
      world: node.world,
      screen: node.screen,
      screenRadius: node.screenRadius,
    })
  );
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]));
  semanticLayer(context, 1, () => {
    for (const label of preview.incidentLabels) {
      const edge = edgesById.get(label.edgeId);
      if (!edge) continue;
      const labelState = edgeLabelDrawState(
        label,
        hasFocus,
        focusedEdgeIds,
        EMPTY_EDGE_IDS,
      );
      if (!labelState.visible) continue;
      drawEdgeLabel(
        context,
        {
          ...label,
          screen: quadraticPoint(edge.geometry, 0.5),
        },
        labelState.focused,
      );
    }
  });
  drawArrowheads(context, edges, ENTITY_SELECTED, 1);
}
