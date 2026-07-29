import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import {
  createLayoutClient,
  type LayoutClient,
  StaleLayoutRequestError,
} from "../graph/layoutClient";
import { projectGraph } from "../graph/projection";
import { buildScene, type GraphTransform, type RenderScene } from "../graph/scene";
import { hitTest, type HitTarget } from "../graph/hitTest";
import { visibleEntityRelations } from "../graph/semantics";
import { useAnalysisStore } from "../store/analysis";

const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 600;
const GRID_SIZE = 24;
const ENTITY_SELECTED = "#2dd4bf";
const EDGE = "#52677a";
const TABLE_EDGE = "#8fa0b0";
const MAX_ENTITY_LABELS = 500;
const LABEL_VIEWPORT_PADDING = 24;
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
  const worldPadding = 72;
  const k = Math.max(
    MIN_ZOOM,
    Math.min(
      2,
      Math.min(
        Math.max(1, viewport.width - 96) /
          Math.max(1, maxX - minX + worldPadding * 2),
        Math.max(1, viewport.height - 96) /
          Math.max(1, maxY - minY + worldPadding * 2),
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

function drawLine(
  context: CanvasRenderingContext2D,
  edge: RenderScene["entityEdges"][number],
  stroke: string,
  width: number,
) {
  context.beginPath();
  context.moveTo(edge.from.screen.x, edge.from.screen.y);
  context.lineTo(edge.to.screen.x, edge.to.screen.y);
  context.strokeStyle = stroke;
  context.lineWidth = width;
  context.setLineDash?.(edge.lineStyle === "dashed" ? [6, 5] : []);
  context.stroke();
  context.setLineDash?.([]);
}

function drawScene(
  context: CanvasRenderingContext2D,
  scene: RenderScene,
  width: number,
  height: number,
  selectedNodeId: string | null,
  hoveredNodeId: string | null,
) {
  context.save();
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0d1926";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#213243";
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

  // Aggregate table relations, then entity relations establish the z-order.
  scene.tableEdges.forEach((edge) => drawLine(context, edge, TABLE_EDGE, 1.5));
  scene.entityEdges.forEach((edge) => drawLine(context, edge, EDGE, 1));

  for (const entity of scene.entityDots) {
    context.beginPath();
    context.arc(entity.screen.x, entity.screen.y, entity.screenRadius, 0, Math.PI * 2);
    context.fillStyle = entity.id === selectedNodeId
      ? ENTITY_SELECTED
      : entity.color ?? "#7dd3fc";
    context.fill();
    if (entity.id === hoveredNodeId || entity.id === selectedNodeId) {
      context.strokeStyle = "#f8fafc";
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  // Table anchors are circular category hubs rather than enclosing rectangles.
  for (const table of scene.tableNodes) {
    context.beginPath();
    context.arc(table.screen.x, table.screen.y, table.screenRadius, 0, Math.PI * 2);
    context.fillStyle = "#112438";
    context.fill();
    context.strokeStyle = table.color ?? "#38bdf8";
    context.lineWidth = 3;
    context.stroke();
    context.fillStyle = table.color ?? "#38bdf8";
    context.font = "600 12px system-ui, sans-serif";
    context.textBaseline = "middle";
    context.fillText(
      table.label,
      table.screen.x + table.screenRadius + 8,
      table.screen.y,
    );
  }

  context.font = "600 10px system-ui, sans-serif";
  context.textBaseline = "middle";
  for (const label of scene.edgeLabels) {
    context.fillStyle = label.lineStyle === "solid" ? "#dbeafe" : "#94a3b8";
    context.fillText(label.text, label.screen.x + 5, label.screen.y - 5);
  }

  context.fillStyle = "#dbeafe";
  context.font = "11px system-ui, sans-serif";
  context.textBaseline = "bottom";
  scene.entityLabels
    .filter((label) =>
      label.screen.x >= -LABEL_VIEWPORT_PADDING &&
      label.screen.x <= width + LABEL_VIEWPORT_PADDING &&
      label.screen.y >= -LABEL_VIEWPORT_PADDING &&
      label.screen.y <= height + LABEL_VIEWPORT_PADDING,
    )
    .sort((left, right) => {
      const leftPriority =
        left.nodeId === selectedNodeId ? 0 : left.nodeId === hoveredNodeId ? 1 : 2;
      const rightPriority =
        right.nodeId === selectedNodeId ? 0 : right.nodeId === hoveredNodeId ? 1 : 2;
      return leftPriority - rightPriority ||
        compareText(left.nodeId, right.nodeId);
    })
    .slice(0, MAX_ENTITY_LABELS)
    .forEach((label) =>
      context.fillText(label.text, label.screen.x + 6, label.screen.y - 5),
    );
  context.restore();
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
    layout: Awaited<ReturnType<LayoutClient["layoutGraph"]>>;
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
  const selectedNodeRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
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
  const showIsolatedNodes = useAnalysisStore((state) => state.showIsolatedNodes);
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
  const searchableEntities = useMemo(
    () => [...(projectedGraph?.entity_nodes ?? [])].sort((left, right) =>
      compareText(left.id, right.id),
    ),
    [projectedGraph],
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
      drawScene(context, scene, viewportRef.current.width, viewportRef.current.height, selectedNodeRef.current, hoveredNodeRef.current);
      drawnGenerationRef.current = generation;
      if (keyboardTargetRef.current) {
        lastHitGenerationRef.current = generation;
      }
      setReadyGeneration(generation);
    });
    if (animationFrameRef.current === -1) animationFrameRef.current = frame;
  }, [acquireCanvasContext]);

  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
    hoveredNodeRef.current = hoveredNodeId;
    invalidate();
  }, [hoveredNodeId, invalidate, selectedNodeId]);

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
  }, [invalidate]);

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
    if (source?.graph === projectedGraph) {
      commitScene(source.graph, source.layout);
    }
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
    if (!projectedGraph) {
      sceneSourceRef.current = null;
      retireScene();
      setLayout(null);
      setLayoutError(null);
      return;
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
    void client.layoutGraph(projectedGraph, viewport).then(
      (next) => {
        if (active) {
          const initialTransform = fitTransform(next, viewport);
          transformRef.current = initialTransform;
          if (zoomRef.current && canvasRef.current) {
            d3.select(canvasRef.current).call(
              zoomRef.current.transform,
              initialTransform,
            );
          }
          sceneSourceRef.current = { graph: projectedGraph, layout: next };
          commitScene(projectedGraph, next);
          setLayout(next);
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
  }, [commitScene, projectedGraph, relayoutRequest, retireScene, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
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
    animationFrameRef.current = null;
    scheduledGenerationRef.current = null;
    layoutClientRef.current?.dispose();
    layoutClientRef.current = null;
  }, []);

  const applyHit = useCallback((target: HitTarget | null) => {
    lastHitRef.current = target;
    lastHitGenerationRef.current = target ? drawnGenerationRef.current : null;
    setHoveredNode(target?.kind === "entity-node" ? target.id : null);
  }, [setHoveredNode]);

  const keyboardTargets = useCallback((): KeyboardTarget[] => {
    if (!projectedGraph || !layout) return [];
    const tableData = new Map(
      projectedGraph.table_nodes.map((table) => [table.id, table]),
    );
    const entityData = new Map(
      projectedGraph.entity_nodes.map((entity) => [entity.id, entity]),
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
        const entity = entityData.get(node.id);
        return entity ? [{
        hit: { kind: "entity-node" as const, id: node.id },
          label: `${entity.display_name}，实体`,
          x: node.x,
          y: node.y,
        }] : [];
      }),
    ].sort((left, right) =>
      left.y - right.y || left.x - right.x || compareText(left.hit.id, right.hit.id),
    );
  }, [layout, projectedGraph]);

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
    const query = searchQuery.trim().toLowerCase();
    if (!query || !layout) {
      setKeyboardAnnouncement(query ? `未找到实体：${searchQuery.trim()}` : "请输入实体名称或 ID");
      return;
    }
    const rankedMatches = [
      (entity: (typeof searchableEntities)[number]) =>
        entity.id.toLowerCase() === query,
      (entity: (typeof searchableEntities)[number]) =>
        entity.display_name.toLowerCase() === query,
      (entity: (typeof searchableEntities)[number]) =>
        entity.id.toLowerCase().startsWith(query) ||
        entity.display_name.toLowerCase().startsWith(query),
      (entity: (typeof searchableEntities)[number]) =>
        entity.id.toLowerCase().includes(query) ||
        entity.display_name.toLowerCase().includes(query),
    ];
    const entity = rankedMatches
      .map((matches) => searchableEntities.find(matches))
      .find((candidate) => candidate !== undefined);
    const node = entity
      ? layout.entityNodes.find((candidate) => candidate.id === entity.id)
      : undefined;
    if (!entity || !node) {
      setKeyboardAnnouncement(`未找到实体：${searchQuery.trim()}`);
      return;
    }
    setKeyboardTarget({
      hit: { kind: "entity-node", id: entity.id },
      label: `${entity.display_name}，实体`,
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
  const interactiveScene = () => {
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
  };

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
        onPointerMove={(event) => {
          const scene = interactiveScene();
          applyHit(scene ? hitTest(scene, pointFromEvent(event.currentTarget, event.nativeEvent)) : null);
        }}
        onPointerLeave={() => applyHit(null)}
        onClick={(event) => {
          const scene = interactiveScene();
          selectHit(scene ? hitTest(scene, pointFromEvent(event.currentTarget, event.nativeEvent)) : null);
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
          className="absolute bottom-3 left-3 right-3 z-10 rounded border border-rose-400/30 bg-slate-950/90 px-3 py-2 text-sm text-rose-100"
        >
          <p>{canvasError}</p>
          <button
            type="button"
            onClick={retryCanvas}
            className="mt-2 rounded border border-rose-300/50 px-2 py-1 text-xs font-medium text-rose-100 hover:border-rose-200"
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
