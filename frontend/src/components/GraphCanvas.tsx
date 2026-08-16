import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as d3 from "d3";
import {
  createLayoutClient,
  type LayoutClient,
  StaleLayoutRequestError,
} from "../graph/layoutClient";
import { buildGraphFocusIndex, resolveGraphFocus, type GraphFocus } from "../graph/focus";
import {
  ENTITY_COLLISION_RADIUS,
  moveLayoutEntity,
  type GraphLayout,
} from "../graph/layout";
import { projectGraph } from "../graph/projection";
import {
  createGraphDragPreview,
  drawGraphScene,
  type GraphDragPreview,
} from "../graph/renderer";
import { buildScene, type GraphTransform, type RenderScene } from "../graph/scene";
import { hitTest, type HitTarget } from "../graph/hitTest";
import { buildBusinessPresentationIndex } from "../graph/businessPresentation";
import { buildBusinessTablePresentationIndex } from "../graph/businessTables";
import { nextSearchIndex, searchNodes } from "../graph/nodeSearch";
import { computeEntityDegrees, visibleEntityRelations } from "../graph/semantics";
import { useAnalysisStore } from "../store/analysis";

const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 600;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.5;
const FOCUS_MOTION_CYCLE_MS = 2400;
const CANVAS_CONTEXT_ERROR =
  "无法创建 Canvas 2D 上下文，当前浏览器不支持图谱画布。";

interface KeyboardTarget {
  hit: HitTarget;
  label: string;
  x: number;
  y: number;
}

interface GraphCanvasProps {
  suppressStatusOverlay?: boolean;
}

function sameTransform(left: GraphTransform, right: GraphTransform): boolean {
  return left.k === right.k && left.x === right.x && left.y === right.y;
}

function preferCoincidentTableEdge(
  scene: RenderScene,
  target: HitTarget | null,
): HitTarget | null {
  if (target?.kind !== "entity-edge") return target;
  const entityEdge = scene.entityEdges.find((edge) => edge.id === target.id);
  if (!entityEdge) return target;
  const tolerance = 0.5;
  const samePoint = (
    left: { x: number; y: number },
    right: { x: number; y: number },
  ) =>
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance;
  const tableEdge = scene.tableEdges.find((edge) =>
    (
      samePoint(edge.from.screen, entityEdge.from.screen) &&
      samePoint(edge.to.screen, entityEdge.to.screen)
    ) || (
      samePoint(edge.from.screen, entityEdge.to.screen) &&
      samePoint(edge.to.screen, entityEdge.from.screen)
    )
  );
  return tableEdge ? { kind: "table-edge", id: tableEdge.id } : target;
}

function fitTransform(
  layout: Awaited<ReturnType<LayoutClient["layoutGraph"]>>,
  viewport: { width: number; height: number },
): d3.ZoomTransform {
  const points = [...layout.tableNodes, ...layout.entityNodes];
  if (!points.length) return d3.zoomIdentity;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const horizontalPadding = ENTITY_COLLISION_RADIUS * 2;
  const verticalPadding = ENTITY_COLLISION_RADIUS;
  const k = Math.max(
    MIN_ZOOM,
    Math.min(
      2,
      Math.min(
        Math.max(1, viewport.width - 96) /
          Math.max(1, maxX - minX + horizontalPadding * 2),
        Math.max(1, viewport.height - 96) /
          Math.max(1, maxY - minY + verticalPadding * 2),
      ),
    ),
  );
  return d3.zoomIdentity
    .translate(viewport.width / 2, viewport.height / 2)
    .scale(k)
    .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function getSize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    width: element.clientWidth || rect.width || FALLBACK_WIDTH,
    height: element.clientHeight || rect.height || FALLBACK_HEIGHT,
  };
}

function mix(left: number, right: number, progress: number): number {
  return left + (right - left) * progress;
}

function interpolateLayout(
  from: GraphLayout,
  to: GraphLayout,
  progress: number,
): GraphLayout {
  const fromTables = new Map(from.tableNodes.map((node) => [node.id, node]));
  const fromEntities = new Map(from.entityNodes.map((node) => [node.id, node]));
  const fromTableEdges = new Map(from.tableEdges.map((edge) => [edge.id, edge]));
  const fromEntityEdges = new Map(from.entityEdges.map((edge) => [edge.id, edge]));
  const point = (left: { x: number; y: number } | undefined, right: { x: number; y: number }) => ({
    x: mix(left?.x ?? right.x, right.x, progress),
    y: mix(left?.y ?? right.y, right.y, progress),
  });
  return {
    tableNodes: to.tableNodes.map((node) => ({
      ...node,
      ...point(fromTables.get(node.id), node),
    })),
    entityNodes: to.entityNodes.map((node) => ({
      ...node,
      ...point(fromEntities.get(node.id), node),
    })),
    tableEdges: to.tableEdges.map((edge) => ({
      ...edge,
      from: point(fromTableEdges.get(edge.id)?.from, edge.from),
      to: point(fromTableEdges.get(edge.id)?.to, edge.to),
    })),
    entityEdges: to.entityEdges.map((edge) => ({
      ...edge,
      from: point(fromEntityEdges.get(edge.id)?.from, edge.from),
      to: point(fromEntityEdges.get(edge.id)?.to, edge.to),
    })),
  };
}

function layoutEase(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - Math.pow(1 - clamped, 3);
}

function graphSummary(
  entityCount: number,
  tableCount: number,
  edgeCount: number,
  fullEntityCount = entityCount,
  fullEdgeCount = edgeCount,
) {
  const fullGraphContext =
    fullEntityCount !== entityCount || fullEdgeCount !== edgeCount
      ? `完整图谱：${fullEntityCount} 个实体，${fullEdgeCount} 条关系。`
      : "";
  return `语义关系图：${tableCount} 个表，${entityCount} 个实体，${edgeCount} 条关系。${fullGraphContext}使用详情面板和搜索访问图中实体。`;
}

function pointFromEvent(canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function reducedMotionRequested(): boolean {
  return import.meta.env.MODE === "test" || (
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false
  );
}

function renderableFocus(
  focus: GraphFocus,
  selectedEntityEdgeId: string | null,
  selectedTableEdgeId: string | null,
  scene: RenderScene | null,
  sceneGeneration: number,
): {
  focus: GraphFocus;
  selectedEntityEdgeId: string | null;
  selectedTableEdgeId: string | null;
} {
  if (!scene || sceneGeneration === 0) {
    return {
      focus: { activeNodeId: null, nodeIds: new Set(), edgeIds: new Set() },
      selectedEntityEdgeId: null,
      selectedTableEdgeId: null,
    };
  }

  const entityNodeIds = new Set(scene.entityDots.map((node) => node.id));
  const entityEdgeIds = new Set(scene.entityEdges.map((edge) => edge.id));
  const tableEdgeIds = new Set(scene.tableEdges.map((edge) => edge.id));
  const activeNodeId = focus.activeNodeId !== null &&
      entityNodeIds.has(focus.activeNodeId)
    ? focus.activeNodeId
    : null;

  return {
    focus: activeNodeId === null
      ? { activeNodeId: null, nodeIds: new Set(), edgeIds: new Set() }
      : {
        activeNodeId,
        nodeIds: new Set(
          [...focus.nodeIds].filter((nodeId) => entityNodeIds.has(nodeId)),
        ),
        edgeIds: new Set(
          [...focus.edgeIds].filter((edgeId) => entityEdgeIds.has(edgeId)),
        ),
      },
    selectedEntityEdgeId: selectedEntityEdgeId !== null &&
        entityEdgeIds.has(selectedEntityEdgeId)
      ? selectedEntityEdgeId
      : null,
    selectedTableEdgeId: selectedTableEdgeId !== null &&
        tableEdgeIds.has(selectedTableEdgeId)
      ? selectedTableEdgeId
      : null,
  };
}

export default function GraphCanvas({ suppressStatusOverlay = false }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RenderScene | null>(null);
  const sceneGenerationRef = useRef(0);
  const drawnGenerationRef = useRef<number | null>(null);
  const scheduledGenerationRef = useRef<number | null>(null);
  const sceneSourceRef = useRef<{
    graph: NonNullable<ReturnType<typeof useAnalysisStore.getState>["graph"]>;
    layout: GraphLayout;
  } | null>(null);
  const sceneInputsRef = useRef<{
    graph: NonNullable<ReturnType<typeof useAnalysisStore.getState>["graph"]>;
    confidenceThreshold: number;
    fitViewRequest: number;
    relayoutRequest: number;
    transform: GraphTransform;
    generation: number;
  } | null>(null);
  const transformRef = useRef<GraphTransform>({ k: 1, x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const motionAnimationFrameRef = useRef<number | null>(null);
  const motionPhaseRef = useRef(0);
  const lastHitRef = useRef<HitTarget | null>(null);
  const lastHitGenerationRef = useRef<number | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const focusRef = useRef<GraphFocus>({
    activeNodeId: null,
    nodeIds: new Set(),
    edgeIds: new Set(),
  });
  const selectedEntityEdgeRef = useRef<string | null>(null);
  const selectedTableEdgeRef = useRef<string | null>(null);
  const pinnedPositionsRef = useRef(new Map<string, { x: number; y: number }>());
  const draggingNodeRef = useRef<string | null>(null);
  const draggingPointerRef = useRef<number | null>(null);
  const dragStartPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragPreviewRef = useRef<{
    preview: GraphDragPreview;
    screen: { x: number; y: number };
    world: { x: number; y: number };
  } | null>(null);
  const dragPreviewFrameRef = useRef<number | null>(null);
  const layoutTransitionFrameRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const pinRelayoutRequestRef = useRef(0);
  const keyboardTargetRef = useRef<KeyboardTarget | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const layoutClientRef = useRef<LayoutClient | null>(null);
  const viewportRef = useRef({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT });
  const [viewport, setViewport] = useState(viewportRef.current);
  const [layout, setLayout] = useState<Awaited<ReturnType<LayoutClient["layoutGraph"]>> | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchResultId, setActiveSearchResultId] = useState<string | null>(null);
  const [layoutPending, setLayoutPending] = useState(false);
  const [sceneGeneration, setSceneGeneration] = useState(0);
  const [readyGeneration, setReadyGeneration] = useState<number | null>(null);

  const graph = useAnalysisStore((state) => state.graph);
  const tableSummaries = useAnalysisStore((state) => state.tableSummaries);
  const tablePresentations = useMemo(
    () => graph
      ? buildBusinessTablePresentationIndex(graph.table_nodes, tableSummaries)
      : new Map<string, string>(),
    [graph, tableSummaries],
  );
  const showIsolatedNodes = useAnalysisStore((state) => state.showIsolatedNodes);
  const businessPresentations = useMemo(
    () => graph
      ? buildBusinessPresentationIndex(
        graph.entity_nodes,
        computeEntityDegrees(graph.entity_nodes, graph.entity_edges),
      )
      : new Map(),
    [graph],
  );
  const projectedGraph = useMemo(
    () => graph ? projectGraph(graph, showIsolatedNodes) : null,
    [graph, showIsolatedNodes],
  );
  const projectedGraphRef = useRef(projectedGraph);
  projectedGraphRef.current = projectedGraph;
  const analysisStatus = useAnalysisStore((state) => state.analysisStatus);
  const errorMessage = useAnalysisStore((state) => state.errorMessage);
  const warnings = useAnalysisStore((state) => state.warnings);
  const hoveredNodeId = useAnalysisStore((state) => state.hoveredNodeId);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const selectedEntityEdgeId = useAnalysisStore(
    (state) => state.selectedEntityEdgeId,
  );
  const selectedTableEdgeId = useAnalysisStore(
    (state) => state.selectedTableEdgeId,
  );
  const confidenceThreshold = useAnalysisStore((state) => state.confidenceThreshold);
  const confidenceThresholdRef = useRef(confidenceThreshold);
  confidenceThresholdRef.current = confidenceThreshold;
  const fitViewRequest = useAnalysisStore((state) => state.fitViewRequest);
  const relayoutRequest = useAnalysisStore((state) => state.relayoutRequest);
  const focusNodeRequest = useAnalysisStore((state) => state.focusNodeRequest);
  const setHoveredNode = useAnalysisStore((state) => state.setHoveredNode);
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);
  const requestNodeFocus = useAnalysisStore((state) => state.requestNodeFocus);
  const requestFitView = useAnalysisStore((state) => state.requestFitView);
  const selectEntityEdge = useAnalysisStore((state) => state.selectEntityEdge);
  const selectTableEdge = useAnalysisStore((state) => state.selectTableEdge);
  const focusIndex = useMemo(
    () => buildGraphFocusIndex(
      projectedGraph?.entity_edges ?? [],
      confidenceThreshold,
    ),
    [confidenceThreshold, projectedGraph],
  );
  const graphFocus = useMemo(
    // Selection owns the active presentation until it is cleared.
    () => resolveGraphFocus(focusIndex, selectedNodeId, hoveredNodeId),
    [focusIndex, hoveredNodeId, selectedNodeId],
  );
  const effectiveFocus = useMemo(
    () => renderableFocus(
      graphFocus,
      selectedEntityEdgeId,
      selectedTableEdgeId,
      sceneRef.current,
      sceneGeneration,
    ),
    [
      graphFocus,
      sceneGeneration,
      selectedEntityEdgeId,
      selectedTableEdgeId,
    ],
  );
  focusRef.current = effectiveFocus.focus;
  selectedEntityEdgeRef.current = effectiveFocus.selectedEntityEdgeId;
  selectedTableEdgeRef.current = effectiveFocus.selectedTableEdgeId;
  const hasFocusedMotion =
    effectiveFocus.focus.activeNodeId !== null ||
    effectiveFocus.selectedEntityEdgeId !== null ||
    effectiveFocus.selectedTableEdgeId !== null;
  const searchableEntities = useMemo(
    () => (projectedGraph?.entity_nodes ?? []).flatMap((entity) => {
      const presentation = businessPresentations.get(entity.id);
      return presentation ? [{ entity, presentation }] : [];
    }).sort((left, right) => compareText(left.entity.id, right.entity.id)),
    [businessPresentations, projectedGraph],
  );
  const searchResults = useMemo(
    () => searchNodes(searchableEntities.map(({ entity, presentation }) => ({
      id: entity.id,
      primary: presentation.primary,
      secondary: presentation.secondary,
      className: entity.class_name,
    })), searchQuery),
    [searchQuery, searchableEntities],
  );
  const activeSearchIndex = useMemo(
    () => activeSearchResultId
      ? searchResults.findIndex((result) => result.id === activeSearchResultId)
      : -1,
    [activeSearchResultId, searchResults],
  );

  useEffect(() => {
    if (!activeSearchResultId || activeSearchIndex >= 0) return;
    setActiveSearchResultId(searchResults[0]?.id ?? null);
  }, [activeSearchIndex, activeSearchResultId, searchResults]);

  const acquireCanvasContext = useCallback(
    (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
      const context = canvas.getContext("2d");
      if (!context) {
        drawnGenerationRef.current = null;
        lastHitGenerationRef.current = null;
        setReadyGeneration(null);
        setCanvasError(CANVAS_CONTEXT_ERROR);
        return null;
      }

      const ratio = window.devicePixelRatio || 1;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      setCanvasError(null);
      return context;
    },
    [],
  );

  const invalidate = useCallback((generation = sceneGenerationRef.current) => {
    if (
      animationFrameRef.current !== null &&
      scheduledGenerationRef.current === generation
    ) {
      return;
    }
    if (animationFrameRef.current !== null && animationFrameRef.current !== -1) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = null;
    scheduledGenerationRef.current = generation;
    // A sentinel keeps synchronous test RAFs from leaving a completed frame queued.
    animationFrameRef.current = -1;
    const frame = requestAnimationFrame(() => {
      if (scheduledGenerationRef.current === generation) {
        animationFrameRef.current = null;
        scheduledGenerationRef.current = null;
      }
      if (generation !== sceneGenerationRef.current) return;
      const canvas = canvasRef.current;
      const scene = sceneRef.current;
      const inputs = sceneInputsRef.current;
      if (!canvas || !scene || inputs?.generation !== generation) return;
      const context = acquireCanvasContext(canvas);
      if (!context) return;
      drawGraphScene(context, scene, {
        width: viewportRef.current.width,
        height: viewportRef.current.height,
        focus: focusRef.current,
        selectedEntityEdgeId: selectedEntityEdgeRef.current,
        selectedTableEdgeId: selectedTableEdgeRef.current,
        motionPhase: motionPhaseRef.current,
      });
      drawnGenerationRef.current = generation;
      if (keyboardTargetRef.current) {
        lastHitGenerationRef.current = generation;
      }
      setReadyGeneration(generation);
    });
    if (animationFrameRef.current === -1) animationFrameRef.current = frame;
  }, [acquireCanvasContext]);

  useEffect(() => {
    if (!hasFocusedMotion || !sceneRef.current || reducedMotionRequested()) {
      motionPhaseRef.current = 0;
      return;
    }
    let active = true;
    const startedAt = performance.now() - motionPhaseRef.current * FOCUS_MOTION_CYCLE_MS;
    const frame = (now: number) => {
      if (!active || reducedMotionRequested()) {
        motionAnimationFrameRef.current = null;
        motionPhaseRef.current = 0;
        invalidate();
        return;
      }
      motionPhaseRef.current = ((now - startedAt) % FOCUS_MOTION_CYCLE_MS) /
        FOCUS_MOTION_CYCLE_MS;
      invalidate();
      motionAnimationFrameRef.current = requestAnimationFrame(frame);
    };
    motionAnimationFrameRef.current = requestAnimationFrame(frame);
    return () => {
      active = false;
      if (motionAnimationFrameRef.current !== null) {
        cancelAnimationFrame(motionAnimationFrameRef.current);
      }
      motionAnimationFrameRef.current = null;
      motionPhaseRef.current = 0;
    };
  }, [hasFocusedMotion, invalidate, sceneGeneration]);

  useEffect(() => {
    hoveredNodeRef.current = hoveredNodeId;
    invalidate();
  }, [
    graphFocus,
    hoveredNodeId,
    invalidate,
    selectedEntityEdgeId,
    selectedTableEdgeId,
  ]);

  const commitScene = useCallback((
    sourceGraph: NonNullable<typeof graph>,
    sourceLayout: Awaited<ReturnType<LayoutClient["layoutGraph"]>>,
  ) => {
    const generation = sceneGenerationRef.current + 1;
    sceneGenerationRef.current = generation;
    const nextScene = buildScene({
      graph: sourceGraph,
      layout: sourceLayout,
      transform: transformRef.current,
      confidenceThreshold: confidenceThresholdRef.current,
      presentations: businessPresentations,
      tablePresentations,
    });
    sceneRef.current = nextScene;
    drawnGenerationRef.current = null;
    const currentAnalysis = useAnalysisStore.getState();
    sceneInputsRef.current = {
      graph: sourceGraph,
      confidenceThreshold: confidenceThresholdRef.current,
      fitViewRequest: currentAnalysis.fitViewRequest,
      relayoutRequest: currentAnalysis.relayoutRequest,
      transform: { ...transformRef.current },
      generation,
    };
    setSceneGeneration(generation);
    setReadyGeneration(null);
    invalidate(generation);
  }, [businessPresentations, invalidate, tablePresentations]);

  const animateLayout = useCallback((
    sourceGraph: NonNullable<typeof graph>,
    fromLayout: GraphLayout,
    toLayout: GraphLayout,
  ) => {
    if (layoutTransitionFrameRef.current !== null) {
      cancelAnimationFrame(layoutTransitionFrameRef.current);
      layoutTransitionFrameRef.current = null;
    }
    if (reducedMotionRequested()) {
      sceneSourceRef.current = { graph: sourceGraph, layout: toLayout };
      commitScene(sourceGraph, toLayout);
      setLayout(toLayout);
      setLayoutPending(false);
      return;
    }
    const startedAt = performance.now();
    const duration = 560;
    const frame = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const nextLayout = interpolateLayout(
        fromLayout,
        toLayout,
        layoutEase(progress),
      );
      sceneSourceRef.current = { graph: sourceGraph, layout: nextLayout };
      commitScene(sourceGraph, nextLayout);
      if (progress < 1) {
        layoutTransitionFrameRef.current = requestAnimationFrame(frame);
        return;
      }
      layoutTransitionFrameRef.current = null;
      sceneSourceRef.current = { graph: sourceGraph, layout: toLayout };
      setLayout(toLayout);
      setLayoutPending(false);
    };
    layoutTransitionFrameRef.current = requestAnimationFrame(frame);
  }, [commitScene]);

  const retireScene = useCallback(() => {
    const generation = sceneGenerationRef.current + 1;
    sceneGenerationRef.current = generation;
    if (animationFrameRef.current !== null && animationFrameRef.current !== -1) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (motionAnimationFrameRef.current !== null) {
      cancelAnimationFrame(motionAnimationFrameRef.current);
    }
    animationFrameRef.current = null;
    motionAnimationFrameRef.current = null;
    motionPhaseRef.current = 0;
    scheduledGenerationRef.current = null;
    sceneRef.current = null;
    drawnGenerationRef.current = null;
    sceneInputsRef.current = null;
    lastHitRef.current = null;
    lastHitGenerationRef.current = null;
    keyboardTargetRef.current = null;
    setSceneGeneration(generation);
    setReadyGeneration(null);
  }, []);

  const rebuildCurrentScene = useCallback(() => {
    const source = sceneSourceRef.current;
    if (source) commitScene(source.graph, source.layout);
  }, [commitScene]);

  useEffect(() => {
    const source = sceneSourceRef.current;
    if (!source || !projectedGraph) return;
    sceneSourceRef.current = { graph: projectedGraph, layout: source.layout };
    commitScene(projectedGraph, source.layout);
  }, [commitScene, confidenceThreshold, projectedGraph]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const next = getSize(container);
      if (next.width === viewportRef.current.width && next.height === viewportRef.current.height) return;
      viewportRef.current = next;
      setViewport(next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.width * ratio);
    canvas.height = Math.round(viewport.height * ratio);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = acquireCanvasContext(canvas);
    if (!context) return;
    rebuildCurrentScene();
  }, [acquireCanvasContext, rebuildCurrentScene, viewport]);

  useEffect(() => {
    if (!graph) {
      sceneSourceRef.current = null;
      retireScene();
      setLayout(null);
      setLayoutError(null);
      setLayoutPending(false);
      return;
    }
    const previousLayout = sceneSourceRef.current?.layout ?? null;
    if (pinRelayoutRequestRef.current !== relayoutRequest) {
      pinRelayoutRequestRef.current = relayoutRequest;
      pinnedPositionsRef.current.clear();
      draggingNodeRef.current = null;
      draggingPointerRef.current = null;
      dragStartPointRef.current = null;
      dragPreviewRef.current = null;
      dragMovedRef.current = false;
      suppressClickRef.current = false;
      if (
        dragPreviewFrameRef.current !== null &&
        dragPreviewFrameRef.current !== -1
      ) {
        cancelAnimationFrame(dragPreviewFrameRef.current);
      }
      dragPreviewFrameRef.current = null;
    }
    let active = true;
    setLayoutPending(true);
    sceneSourceRef.current = null;
    retireScene();
    setLayout(null);
    setLayoutError(null);
    if (relayoutRequest > 0 && zoomRef.current && canvasRef.current) {
      d3.select(canvasRef.current).call(zoomRef.current.transform, d3.zoomIdentity);
    }
    const client = layoutClientRef.current ?? createLayoutClient();
    layoutClientRef.current = client;
    client.reset();
    const layoutInput = projectedGraph ?? graph;
    void client.layoutGraph(layoutInput, viewport, relayoutRequest).then(
      (next) => {
        const currentProjection = projectedGraphRef.current;
        if (active && currentProjection) {
          let positionedLayout = next;
          for (const [nodeId, point] of pinnedPositionsRef.current) {
            positionedLayout = moveLayoutEntity(positionedLayout, nodeId, point);
          }
          const initialTransform = fitTransform(positionedLayout, viewport);
          transformRef.current = initialTransform;
          if (zoomRef.current && canvasRef.current) {
            d3.select(canvasRef.current).call(
              zoomRef.current.transform,
              initialTransform,
            );
          }
          if (previousLayout && relayoutRequest > 0) {
            animateLayout(currentProjection, previousLayout, positionedLayout);
          } else {
            sceneSourceRef.current = {
              graph: currentProjection,
              layout: positionedLayout,
            };
            commitScene(currentProjection, positionedLayout);
            setLayout(positionedLayout);
            setLayoutPending(false);
          }
        }
      },
      (error: unknown) => {
        if (!active || error instanceof StaleLayoutRequestError) return;
        setLayoutError(error instanceof Error ? error.message : "无法计算图谱布局。");
        setLayoutPending(false);
      },
    );
    return () => {
      active = false;
      client.reset();
      if (layoutTransitionFrameRef.current !== null) {
        cancelAnimationFrame(layoutTransitionFrameRef.current);
        layoutTransitionFrameRef.current = null;
      }
    };
  }, [
    animateLayout,
    commitScene,
    graph,
    projectedGraph,
    relayoutRequest,
    retireScene,
    viewport,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter((event) =>
        draggingNodeRef.current === null &&
        (!event.ctrlKey || event.type === "wheel") &&
        !event.button
      )
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        rebuildCurrentScene();
      });
    zoomRef.current = zoom;
    d3.select(canvas).call(zoom);
    return () => {
      d3.select(canvas).on(".zoom", null);
      zoomRef.current = null;
    };
  }, [rebuildCurrentScene]);

  const fitView = useCallback(() => {
    if (!layout || !projectedGraph || !zoomRef.current || !canvasRef.current) return;
    d3.select(canvasRef.current).call(
      zoomRef.current.transform,
      fitTransform(layout, viewport),
    );
  }, [layout, projectedGraph, viewport]);

  const handledFitViewRequestRef = useRef(fitViewRequest);
  useEffect(() => {
    if (handledFitViewRequestRef.current === fitViewRequest) return;
    handledFitViewRequestRef.current = fitViewRequest;
    fitView();
  }, [fitView, fitViewRequest]);

  useEffect(() => {
    const nodeId = focusNodeRequest?.nodeId;
    if (!nodeId || !layout || !zoomRef.current || !canvasRef.current) return;
    const entity = layout.entityNodes.find((node) => node.id === nodeId);
    if (!entity) return;
    const focusIds = new Set([
      nodeId,
      ...(focusIndex.neighborsByNode.get(nodeId) ?? []),
    ]);
    const focusPoints = layout.entityNodes.filter((node) => focusIds.has(node.id));
    const minX = Math.min(...focusPoints.map((point) => point.x));
    const maxX = Math.max(...focusPoints.map((point) => point.x));
    const minY = Math.min(...focusPoints.map((point) => point.y));
    const maxY = Math.max(...focusPoints.map((point) => point.y));
    const focusPadding = 180;
    const detailScale = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        Math.min(
          (viewport.width - focusPadding) / Math.max(1, maxX - minX + focusPadding),
          (viewport.height - focusPadding) / Math.max(1, maxY - minY + focusPadding),
        ),
      ),
    );
    const focusCenterX = (minX + maxX) / 2 || entity.x;
    const focusCenterY = (minY + maxY) / 2 || entity.y;
    d3.select(canvasRef.current).call(zoomRef.current.transform, d3.zoomIdentity.translate(viewport.width / 2, viewport.height / 2).scale(detailScale).translate(-focusCenterX, -focusCenterY));
  }, [focusIndex, focusNodeRequest, layout, viewport]);

  useEffect(() => () => {
    sceneGenerationRef.current += 1;
    if (animationFrameRef.current !== null && animationFrameRef.current !== -1) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (motionAnimationFrameRef.current !== null) {
      cancelAnimationFrame(motionAnimationFrameRef.current);
    }
    if (
      dragPreviewFrameRef.current !== null &&
      dragPreviewFrameRef.current !== -1
    ) {
      cancelAnimationFrame(dragPreviewFrameRef.current);
    }
    animationFrameRef.current = null;
    motionAnimationFrameRef.current = null;
    motionPhaseRef.current = 0;
    dragPreviewFrameRef.current = null;
    if (layoutTransitionFrameRef.current !== null) {
      cancelAnimationFrame(layoutTransitionFrameRef.current);
    }
    layoutTransitionFrameRef.current = null;
    scheduledGenerationRef.current = null;
    layoutClientRef.current?.dispose();
    layoutClientRef.current = null;
  }, []);

  const interactiveScene = useCallback(() => {
    const scene = sceneRef.current;
    const inputs = sceneInputsRef.current;
    return scene &&
      inputs?.generation === sceneGenerationRef.current &&
      drawnGenerationRef.current === inputs.generation &&
      inputs?.graph === projectedGraphRef.current &&
      inputs.confidenceThreshold === confidenceThresholdRef.current &&
      inputs.fitViewRequest === useAnalysisStore.getState().fitViewRequest &&
      inputs.relayoutRequest === useAnalysisStore.getState().relayoutRequest &&
      sameTransform(inputs.transform, transformRef.current)
      ? scene
      : null;
  }, []);

  const applyHit = useCallback((target: HitTarget | null) => {
    lastHitRef.current = target;
    lastHitGenerationRef.current = target ? drawnGenerationRef.current : null;
    const nextHoveredId =
      target?.kind === "entity-node" ? target.id : null;
    if (nextHoveredId !== hoveredNodeRef.current) {
      hoveredNodeRef.current = nextHoveredId;
      setHoveredNode(nextHoveredId);
    }
  }, [setHoveredNode]);

  const scheduleDragPreview = useCallback(() => {
    if (dragPreviewFrameRef.current !== null) return;
    dragPreviewFrameRef.current = -1;
    const frame = requestAnimationFrame(() => {
      dragPreviewFrameRef.current = null;
      const canvas = canvasRef.current;
      const scene = sceneRef.current;
      const preview = dragPreviewRef.current;
      if (!canvas || !scene || !preview) return;
      const context = acquireCanvasContext(canvas);
      if (!context) return;
      drawGraphScene(context, scene, {
        width: viewportRef.current.width,
        height: viewportRef.current.height,
        focus: focusRef.current,
        selectedEntityEdgeId: selectedEntityEdgeRef.current,
        selectedTableEdgeId: selectedTableEdgeRef.current,
        motionPhase: motionPhaseRef.current,
        dragPreview: {
          preview: preview.preview,
          screen: preview.screen,
        },
      });
    });
    if (dragPreviewFrameRef.current === -1) {
      dragPreviewFrameRef.current = frame;
    }
  }, [acquireCanvasContext]);

  const beginNodeDrag = useCallback((
    canvas: HTMLCanvasElement,
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    if (event.button !== 0) return;
    const scene = interactiveScene();
    if (!scene) return;
    const point = pointFromEvent(canvas, event.nativeEvent);
    const target = hitTest(scene, point);
    if (target?.kind !== "entity-node") return;
    const preview = createGraphDragPreview(scene, target.id);
    if (!preview) return;
    const transform = transformRef.current;
    draggingNodeRef.current = target.id;
    draggingPointerRef.current = event.pointerId;
    dragStartPointRef.current = point;
    dragPreviewRef.current = {
      preview,
      screen: point,
      world: {
        x: (point.x - transform.x) / transform.k,
        y: (point.y - transform.y) / transform.k,
      },
    };
    dragMovedRef.current = false;
    suppressClickRef.current = false;
    canvas.setPointerCapture?.(event.pointerId);
    event.stopPropagation();
  }, [interactiveScene]);

  const moveDraggedNode = useCallback((
    canvas: HTMLCanvasElement,
    event: ReactPointerEvent<HTMLCanvasElement>,
  ): boolean => {
    const nodeId = draggingNodeRef.current;
    if (nodeId == null || draggingPointerRef.current !== event.pointerId) {
      return false;
    }
    const screen = pointFromEvent(canvas, event.nativeEvent);
    const transform = transformRef.current;
    const world = {
      x: (screen.x - transform.x) / transform.k,
      y: (screen.y - transform.y) / transform.k,
    };
    if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return true;
    const start = dragStartPointRef.current;
    if (start && Math.hypot(screen.x - start.x, screen.y - start.y) >= 3) {
      dragMovedRef.current = true;
    }
    const preview = dragPreviewRef.current;
    if (preview) {
      dragPreviewRef.current = { ...preview, screen, world };
      scheduleDragPreview();
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  }, [scheduleDragPreview]);

  const resetNodeDrag = useCallback((
    canvas: HTMLCanvasElement,
    pointerId: number,
    options: {
      commit: boolean;
      suppressClick: boolean;
    },
  ): boolean => {
    if (
      draggingNodeRef.current == null ||
      draggingPointerRef.current !== pointerId
    ) {
      return false;
    }
    const nodeId = draggingNodeRef.current;
    const moved = dragMovedRef.current;
    const preview = dragPreviewRef.current;
    if (
      dragPreviewFrameRef.current !== null &&
      dragPreviewFrameRef.current !== -1
    ) {
      cancelAnimationFrame(dragPreviewFrameRef.current);
    }
    dragPreviewFrameRef.current = null;
    draggingNodeRef.current = null;
    draggingPointerRef.current = null;
    dragStartPointRef.current = null;
    dragPreviewRef.current = null;
    dragMovedRef.current = false;
    suppressClickRef.current = options.suppressClick && moved;
    if (canvas.hasPointerCapture?.(pointerId)) {
      canvas.releasePointerCapture?.(pointerId);
    }

    const source = sceneSourceRef.current;
    if (options.commit && moved && preview && source) {
      pinnedPositionsRef.current.set(nodeId, preview.world);
      const nextLayout = moveLayoutEntity(
        source.layout,
        nodeId,
        preview.world,
      );
      sceneSourceRef.current = { ...source, layout: nextLayout };
      setLayout(nextLayout);
      commitScene(source.graph, nextLayout);
    } else {
      invalidate();
    }
    return true;
  }, [commitScene, invalidate]);

  const keyboardTargets = useCallback((): KeyboardTarget[] => {
    if (!projectedGraph || !layout) return [];
    const projectedTableIds = new Set(
      projectedGraph.table_nodes.map((table) => table.id),
    );
    const projectedEntityIds = new Set(
      projectedGraph.entity_nodes.map((entity) => entity.id),
    );
    return [
      ...layout.tableNodes.flatMap((node) => {
        return projectedTableIds.has(node.id) ? [{
          hit: { kind: "table-node" as const, id: node.id },
          label: `${tablePresentations.get(node.id) ?? "业务数据集"}，表`,
          x: node.x,
          y: node.y,
        }] : [];
      }),
      ...layout.entityNodes.flatMap((node) => {
        if (!projectedEntityIds.has(node.id)) return [];
        const presentation = businessPresentations.get(node.id);
        return presentation ? [{
          hit: { kind: "entity-node" as const, id: node.id },
          label: `${presentation.accessibleLabel}，实体`,
          x: node.x,
          y: node.y,
        }] : [];
      }),
    ].sort((left, right) =>
      left.y - right.y || left.x - right.x || compareText(left.hit.id, right.hit.id),
    );
  }, [businessPresentations, layout, projectedGraph, tablePresentations]);

  const revealKeyboardEntity = useCallback((target: KeyboardTarget) => {
    if (
      target.hit.kind !== "entity-node" ||
      !zoomRef.current ||
      !canvasRef.current
    ) {
      return;
    }
    const k = Math.max(1.2, d3.zoomTransform(canvasRef.current).k);
    const transform = d3.zoomIdentity
      .translate(viewport.width / 2, viewport.height / 2)
      .scale(k)
      .translate(-target.x, -target.y);
    d3.select(canvasRef.current).call(zoomRef.current.transform, transform);
  }, [viewport]);

  const setKeyboardTarget = useCallback((target: KeyboardTarget | null) => {
    keyboardTargetRef.current = target;
    lastHitRef.current = target?.hit ?? null;
    lastHitGenerationRef.current = target ? drawnGenerationRef.current : null;
    setKeyboardAnnouncement(target ? `当前目标：${target.label}` : "");
    if (target) revealKeyboardEntity(target);
  }, [revealKeyboardEntity]);

  const moveKeyboardTarget = useCallback((key: string) => {
    const targets = keyboardTargets();
    if (targets.length === 0) return;
    const current = keyboardTargetRef.current ?? targets[0];
    const candidates = targets.filter((target) => {
      if (target.hit.kind === current.hit.kind && target.hit.id === current.hit.id) {
        return false;
      }
      if (key === "ArrowLeft") return target.x < current.x;
      if (key === "ArrowRight") return target.x > current.x;
      if (key === "ArrowUp") return target.y < current.y;
      return target.y > current.y;
    });
    const next = (candidates.length > 0 ? candidates : targets)
      .sort((left, right) => {
        const leftDistance = Math.hypot(left.x - current.x, left.y - current.y);
        const rightDistance = Math.hypot(right.x - current.x, right.y - current.y);
        return leftDistance - rightDistance ||
          left.y - right.y ||
          left.x - right.x ||
          compareText(left.hit.id, right.hit.id);
      })[0];
    setKeyboardTarget(next);
  }, [keyboardTargets, setKeyboardTarget]);

  const focusSearchResult = useCallback((index: number) => {
    const result = searchResults[index];
    const node = result
      ? layout?.entityNodes.find((candidate) => candidate.id === result.id)
      : undefined;
    if (!result || !node) {
      if (!searchQuery.trim()) {
        setKeyboardAnnouncement("请输入实体名称或 ID");
      } else {
        setKeyboardAnnouncement(`未找到实体：${searchQuery.trim()}`);
      }
      return;
    }
    const presentation = businessPresentations.get(result.id);
    if (!presentation) {
      setKeyboardAnnouncement(`未找到实体：${searchQuery.trim()}`);
      return;
    }
    setKeyboardTarget({
      hit: { kind: "entity-node", id: result.id },
      label: `${presentation.accessibleLabel}，实体`,
      x: node.x,
      y: node.y,
    });
    requestNodeFocus(result.id);
    setActiveSearchResultId(result.id);
  }, [businessPresentations, layout, requestNodeFocus, searchQuery, searchResults, setKeyboardTarget]);

  const focusNextSearchResult = useCallback(() => {
    focusSearchResult(nextSearchIndex(activeSearchIndex, searchResults.length));
  }, [activeSearchIndex, focusSearchResult, searchResults.length]);

  const focusSupportingRelations = useCallback((tableEdgeId: string) => {
    if (!projectedGraph || !layout || !zoomRef.current || !canvasRef.current) return;
    const tableEdge = projectedGraph.table_edges.find((edge) => edge.id === tableEdgeId);
    if (!tableEdge || tableEdge.supporting_entity_edges.length === 0) return;
    const supportingIds = new Set(tableEdge.supporting_entity_edges);
    const visibleSupportingIds = new Set(
      projectedGraph.entity_edges
        .filter((edge) =>
          supportingIds.has(edge.id) &&
          visibleEntityRelations(edge, confidenceThreshold).length > 0
        )
        .map((edge) => edge.id),
    );
    const supportingEdges = layout.entityEdges.filter((edge) =>
      visibleSupportingIds.has(edge.id),
    );
    if (supportingEdges.length === 0) return;
    const points = supportingEdges.flatMap((edge) => [edge.from, edge.to]);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const padding = 120;
    const k = Math.max(
      MIN_ZOOM,
      Math.min(
        MAX_ZOOM,
        Math.min(
          (viewport.width - padding * 2) / Math.max(1, maxX - minX),
          (viewport.height - padding * 2) / Math.max(1, maxY - minY),
        ),
      ),
    );
    const transform = d3.zoomIdentity
      .translate(viewport.width / 2, viewport.height / 2)
      .scale(k)
      .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);
    d3.select(canvasRef.current).call(zoomRef.current.transform, transform);
  }, [confidenceThreshold, layout, projectedGraph, viewport]);

  const focusTableNode = useCallback((tableId: string) => {
    if (!layout || !zoomRef.current || !canvasRef.current) return;
    const table = layout.tableNodes.find((node) => node.id === tableId);
    if (!table) return;
    const k = d3.zoomTransform(canvasRef.current).k;
    const transform = d3.zoomIdentity
      .translate(viewport.width / 2, viewport.height / 2)
      .scale(k)
      .translate(-table.x, -table.y);
    d3.select(canvasRef.current).call(zoomRef.current.transform, transform);
  }, [layout, viewport]);

  const retryCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sceneSourceRef.current) return;
    if (!acquireCanvasContext(canvas)) return;
    rebuildCurrentScene();
  }, [acquireCanvasContext, rebuildCurrentScene]);

  const clearGraphFocus = useCallback(() => {
    setSelectedNode(null);
    selectEntityEdge(null);
    selectTableEdge(null);
    setSearchQuery("");
    setActiveSearchResultId(null);
    requestFitView();
  }, [requestFitView, selectEntityEdge, selectTableEdge, setSelectedNode]);

  const selectHit = useCallback((target: HitTarget | null) => {
    if (!target) {
      setSelectedNode(null);
      selectEntityEdge(null);
      return;
    }
    if (target.kind === "entity-node") {
      requestNodeFocus(target.id);
    } else if (target.kind === "table-node") {
      focusTableNode(target.id);
    } else if (target.kind === "entity-edge") {
      selectEntityEdge(target.id);
    } else if (target.kind === "table-edge") {
      // The table edge is the aggregate focus for its supporting entity relations.
      selectTableEdge(target.id);
      focusSupportingRelations(target.id);
    }
  }, [focusSupportingRelations, focusTableNode, requestNodeFocus, selectEntityEdge, selectTableEdge, setSelectedNode]);

  const entityCount = projectedGraph?.entity_nodes.length ?? 0;
  const tableCount = projectedGraph?.table_nodes.length ?? 0;
  const edgeCount = projectedGraph
    ? projectedGraph.entity_edges.length + projectedGraph.table_edges.length
    : 0;
  const fullEntityCount = graph?.entity_nodes.length ?? 0;
  const fullEdgeCount = graph
    ? graph.entity_edges.length + graph.table_edges.length
    : 0;
  const notice = layoutError ?? (analysisStatus === "failed" ? errorMessage || "分析失败，以下图谱为可用的部分结果。" : null);
  const currentInputs = sceneInputsRef.current;
  const sceneIsReady =
    readyGeneration === sceneGeneration &&
    drawnGenerationRef.current === sceneGeneration &&
    currentInputs?.generation === sceneGeneration &&
    currentInputs.graph === projectedGraph &&
    currentInputs.confidenceThreshold === confidenceThreshold &&
    currentInputs.fitViewRequest === fitViewRequest &&
    currentInputs.relayoutRequest === relayoutRequest &&
    sameTransform(currentInputs.transform, transformRef.current);
  const isFocused = Boolean(
    effectiveFocus.focus.activeNodeId ||
    effectiveFocus.selectedEntityEdgeId ||
    effectiveFocus.selectedTableEdgeId,
  );
  const activeFocusLabel = effectiveFocus.focus.activeNodeId
    ? businessPresentations.get(effectiveFocus.focus.activeNodeId)?.primary
    : effectiveFocus.selectedEntityEdgeId || effectiveFocus.selectedTableEdgeId
      ? "当前关系"
      : null;
  return (
    <div ref={containerRef} role="group" aria-label={graphSummary(entityCount, tableCount, edgeCount, fullEntityCount, fullEdgeCount)} className="graph-canvas-frame relative h-full min-h-[420px] overflow-hidden rounded-xl border border-slate-700/70 bg-[#0d1926]">
      <canvas
        ref={canvasRef}
        role="img"
        data-layout-ready={sceneIsReady ? "true" : "false"}
        data-scene-ready={sceneIsReady ? "true" : "false"}
        data-scene-generation={sceneGeneration}
        data-ready-generation={sceneIsReady ? readyGeneration : ""}
        tabIndex={0}
        aria-label={graphSummary(entityCount, tableCount, edgeCount, fullEntityCount, fullEdgeCount)}
        className="block h-full w-full touch-none outline-none focus:ring-2 focus:ring-teal-300"
        onFocus={() => {
          if (interactiveScene() && !keyboardTargetRef.current) {
            setKeyboardTarget(keyboardTargets()[0] ?? null);
          }
        }}
        onPointerDownCapture={(event) => {
          beginNodeDrag(event.currentTarget, event);
        }}
        onPointerMove={(event) => {
          if (moveDraggedNode(event.currentTarget, event)) return;
          const scene = interactiveScene();
          applyHit(scene ? hitTest(scene, pointFromEvent(event.currentTarget, event.nativeEvent)) : null);
        }}
        onPointerLeave={() => applyHit(null)}
        onPointerUp={(event) => {
          resetNodeDrag(event.currentTarget, event.pointerId, {
            commit: true,
            suppressClick: true,
          });
        }}
        onPointerCancel={(event) => {
          resetNodeDrag(event.currentTarget, event.pointerId, {
            commit: false,
            suppressClick: false,
          });
          applyHit(null);
        }}
        onLostPointerCapture={(event) => {
          resetNodeDrag(event.currentTarget, event.pointerId, {
            commit: false,
            suppressClick: false,
          });
          applyHit(null);
        }}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          const scene = interactiveScene();
          const target = scene
            ? hitTest(
              scene,
              pointFromEvent(event.currentTarget, event.nativeEvent),
            )
            : null;
          selectHit(scene ? preferCoincidentTableEdge(scene, target) : null);
        }}
        onKeyDown={(event) => {
          if (!interactiveScene()) return;
          if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            moveKeyboardTarget(event.key);
            return;
          }
          if (
            (event.key === "Enter" || event.key === " ") &&
            lastHitRef.current &&
            lastHitGenerationRef.current === drawnGenerationRef.current
          ) {
            event.preventDefault();
            selectHit(lastHitRef.current);
          }
        }}
      />
      <span aria-live="polite" className="sr-only">{keyboardAnnouncement}</span>
      {fullEntityCount <= 1_000 && <div className="graph-view-indicator">
        {layoutPending ? (
          <span className="graph-view-status">正在整理全网布局…</span>
        ) : isFocused ? (
          <div className="graph-focus-status">
            <span>
              <small>局部业务路径</small>
              <strong>{activeFocusLabel ?? "已聚焦关系"}</strong>
            </span>
            <button type="button" onClick={clearGraphFocus}>回到总览</button>
          </div>
        ) : (
          <div className="graph-overview-status">
            <small>GLOBAL RELATION UNIVERSE</small>
            <strong>总业务关系宇宙</strong>
            <span>搜索或选中对象，进入可解释的局部业务路径</span>
          </div>
        )}
      </div>}
      {canvasError && (
        <div
          role="alert"
          className="graph-canvas-error absolute bottom-3 left-3 right-3 z-10 rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-800 shadow-sm"
        >
          <p>{canvasError}</p>
          <button
            type="button"
            onClick={retryCanvas}
            className="mt-2 rounded border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-800 hover:border-rose-500"
          >
            重试画布
          </button>
        </div>
      )}
      {graph && (
        <form
          role="search"
          className="graph-canvas-search absolute right-3 top-3 flex gap-1 rounded-md bg-slate-950/85 p-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            focusSearchResult(0);
          }}
        >
          <input
            type="search"
            aria-label="查找实体"
            placeholder="搜索业务对象"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setActiveSearchResultId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                focusSearchResult(0);
              }
            }}
            className="w-44 rounded bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          {searchQuery.trim() && (
            <span className="self-center whitespace-nowrap px-1 text-xs text-slate-200">
              {searchResults.length > 0
                ? `${activeSearchIndex >= 0 ? activeSearchIndex + 1 : 0} / ${searchResults.length}`
                : "未找到匹配节点"}
            </span>
          )}
          <button
            type="submit"
            className="rounded bg-[var(--signal-cyan)] px-2 py-1 text-xs font-semibold text-[var(--graphite-950)]"
          >
            定位
          </button>
          <button
            type="button"
            aria-label="下一个匹配节点"
            disabled={searchResults.length === 0}
            onClick={focusNextSearchResult}
            className="rounded bg-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            下一个
          </button>
        </form>
      )}
      {!graph && <p data-empty-warning className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">等待分析结果生成语义关系图。</p>}
      {!suppressStatusOverlay && analysisStatus === "partial" && <p role="status" className="absolute left-3 top-3 rounded bg-amber-400/15 px-3 py-2 text-xs text-amber-100">分析部分完成，正在显示可用关系。</p>}
      {!suppressStatusOverlay && notice && <div role="alert" className="absolute bottom-3 left-3 right-3 rounded border border-amber-400/30 bg-slate-950/85 px-3 py-2 text-sm text-amber-100"><p>{notice}</p>{warnings.filter((warning) => warning !== notice).length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-amber-200">{warnings.filter((warning) => warning !== notice).map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
    </div>
  );
}
