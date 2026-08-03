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
import { computeEntityDegrees, visibleEntityRelations } from "../graph/semantics";
import { useAnalysisStore } from "../store/analysis";

const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 600;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 2.5;
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

function normalizedSearchQuery(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase();
}

function getSize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    width: element.clientWidth || rect.width || FALLBACK_WIDTH,
    height: element.clientHeight || rect.height || FALLBACK_HEIGHT,
  };
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
  focusRef.current = graphFocus;
  selectedEntityEdgeRef.current = selectedEntityEdgeId;
  selectedTableEdgeRef.current = selectedTableEdgeId;
  const searchableEntities = useMemo(
    () => (projectedGraph?.entity_nodes ?? []).flatMap((entity) => {
      const presentation = businessPresentations.get(entity.id);
      return presentation ? [{ entity, presentation }] : [];
    }).sort((left, right) => compareText(left.entity.id, right.entity.id)),
    [businessPresentations, projectedGraph],
  );

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

  const retireScene = useCallback(() => {
    const generation = sceneGenerationRef.current + 1;
    sceneGenerationRef.current = generation;
    if (animationFrameRef.current !== null && animationFrameRef.current !== -1) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = null;
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
      return;
    }
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
    void client.layoutGraph(graph, viewport, relayoutRequest).then(
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
          sceneSourceRef.current = {
            graph: currentProjection,
            layout: positionedLayout,
          };
          commitScene(currentProjection, positionedLayout);
          setLayout(positionedLayout);
        }
      },
      (error: unknown) => {
        if (!active || error instanceof StaleLayoutRequestError) return;
        setLayoutError(error instanceof Error ? error.message : "无法计算图谱布局。");
      },
    );
    return () => {
      active = false;
      client.reset();
    };
  }, [commitScene, graph, relayoutRequest, retireScene, viewport]);

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
    d3.select(canvasRef.current).call(zoomRef.current.transform, d3.zoomIdentity.translate(viewport.width / 2, viewport.height / 2).scale(transformRef.current.k).translate(-entity.x, -entity.y));
  }, [focusNodeRequest, layout, viewport]);

  useEffect(() => () => {
    sceneGenerationRef.current += 1;
    if (animationFrameRef.current !== null && animationFrameRef.current !== -1) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (
      dragPreviewFrameRef.current !== null &&
      dragPreviewFrameRef.current !== -1
    ) {
      cancelAnimationFrame(dragPreviewFrameRef.current);
    }
    animationFrameRef.current = null;
    dragPreviewFrameRef.current = null;
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
    const tableData = new Map(
      projectedGraph.table_nodes.map((table) => [table.id, table]),
    );
    const projectedEntityIds = new Set(
      projectedGraph.entity_nodes.map((entity) => entity.id),
    );
    return [
      ...layout.tableNodes.flatMap((node) => {
        const table = tableData.get(node.id);
        return table ? [{
        hit: { kind: "table-node" as const, id: node.id },
          label: `${table.display_name}，表`,
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
  }, [businessPresentations, layout, projectedGraph]);

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

  const locateEntity = useCallback(() => {
    const query = normalizedSearchQuery(searchQuery);
    if (!query || !layout) {
      setKeyboardAnnouncement(query ? `未找到实体：${searchQuery.trim()}` : "请输入实体名称或 ID");
      return;
    }
    const rankedMatches = [
      (candidate: (typeof searchableEntities)[number]) =>
        candidate.presentation.searchText === query,
      (candidate: (typeof searchableEntities)[number]) =>
        candidate.presentation.searchText.startsWith(query),
      (candidate: (typeof searchableEntities)[number]) =>
        candidate.presentation.searchText.includes(query),
    ];
    const businessMatch = rankedMatches
      .map((matches) => searchableEntities.find(matches))
      .find((candidate) => candidate !== undefined);
    const technicalCompatibilityMatch = businessMatch
      ? undefined
      : searchableEntities.find(({ entity }) =>
        normalizedSearchQuery(entity.id) === query
      );
    const match = businessMatch ?? technicalCompatibilityMatch;
    const entity = match?.entity;
    const presentation = match?.presentation;
    const node = entity
      ? layout.entityNodes.find((candidate) => candidate.id === entity.id)
      : undefined;
    if (!entity || !presentation || !node) {
      setKeyboardAnnouncement(`未找到实体：${searchQuery.trim()}`);
      return;
    }
    setKeyboardTarget({
      hit: { kind: "entity-node", id: entity.id },
      label: `${presentation.accessibleLabel}，实体`,
      x: node.x,
      y: node.y,
    });
    requestNodeFocus(entity.id);
  }, [layout, requestNodeFocus, searchQuery, searchableEntities, setKeyboardTarget]);

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
  return (
    <div ref={containerRef} role="group" aria-label={graphSummary(entityCount, tableCount, edgeCount, fullEntityCount, fullEdgeCount)} className="relative h-full min-h-[420px] overflow-hidden rounded-xl border border-slate-700/70 bg-[#0d1926]">
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
      {canvasError && (
        <div
          role="alert"
          className="absolute bottom-3 left-3 right-3 z-10 rounded border border-rose-200 bg-white px-3 py-2 text-sm text-rose-800 shadow-sm"
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
          className="absolute right-3 top-3 flex gap-1 rounded-md bg-slate-950/85 p-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            locateEntity();
          }}
        >
          <input
            type="search"
            aria-label="查找实体"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                locateEntity();
              }
            }}
            className="w-44 rounded bg-slate-800 px-2 py-1 text-xs text-slate-100"
          />
          <button
            type="submit"
            className="rounded bg-teal-400 px-2 py-1 text-xs font-semibold text-slate-950"
          >
            定位
          </button>
        </form>
      )}
      {!graph && <p data-empty-warning className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">等待分析结果生成语义关系图。</p>}
      {!suppressStatusOverlay && analysisStatus === "partial" && <p role="status" className="absolute left-3 top-3 rounded bg-amber-400/15 px-3 py-2 text-xs text-amber-100">分析部分完成，正在显示可用关系。</p>}
      {!suppressStatusOverlay && notice && <div role="alert" className="absolute bottom-3 left-3 right-3 rounded border border-amber-400/30 bg-slate-950/85 px-3 py-2 text-sm text-amber-100"><p>{notice}</p>{warnings.filter((warning) => warning !== notice).length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-amber-200">{warnings.filter((warning) => warning !== notice).map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
    </div>
  );
}
