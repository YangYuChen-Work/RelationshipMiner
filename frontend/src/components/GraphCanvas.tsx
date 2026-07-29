import { useCallback, useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import {
  createLayoutClient,
  type LayoutClient,
  StaleLayoutRequestError,
} from "../graph/layoutClient";
import { buildScene, type GraphTransform, type RenderScene } from "../graph/scene";
import { hitTest, type HitTarget } from "../graph/hitTest";
import { useAnalysisStore } from "../store/analysis";

const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 600;
const GRID_SIZE = 24;
const TABLE_FILL = "#142638";
const TABLE_STROKE = "#365168";
const ENTITY = "#7dd3fc";
const ENTITY_SELECTED = "#2dd4bf";
const EDGE = "#52677a";
const TABLE_EDGE = "#8fa0b0";
const MAX_ENTITY_LABELS = 500;
const LABEL_VIEWPORT_PADDING = 24;

interface KeyboardTarget {
  hit: HitTarget;
  label: string;
  x: number;
  y: number;
}

function getSize(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return {
    width: element.clientWidth || rect.width || FALLBACK_WIDTH,
    height: element.clientHeight || rect.height || FALLBACK_HEIGHT,
  };
}

function graphSummary(entityCount: number, tableCount: number, edgeCount: number) {
  return `语义关系图：${tableCount} 个表，${entityCount} 个实体，${edgeCount} 条关系。使用详情面板和搜索访问图中实体。`;
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
  context.stroke();
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

  // Regions, aggregate table relations, then entity relations establish the z-order.
  for (const region of scene.tableRegions) {
    context.fillStyle = TABLE_FILL;
    context.strokeStyle = TABLE_STROKE;
    context.lineWidth = 1;
    context.fillRect(region.screen.x, region.screen.y, region.screen.width, region.screen.height);
    context.strokeRect(region.screen.x, region.screen.y, region.screen.width, region.screen.height);
  }
  scene.tableEdges.forEach((edge) => drawLine(context, edge, TABLE_EDGE, 1.5));
  scene.entityEdges.forEach((edge) => drawLine(context, edge, EDGE, 1));

  for (const entity of scene.entityDots) {
    context.beginPath();
    context.arc(entity.screen.x, entity.screen.y, entity.screenRadius, 0, Math.PI * 2);
    context.fillStyle = entity.id === selectedNodeId ? ENTITY_SELECTED : ENTITY;
    context.fill();
    if (entity.id === hoveredNodeId || entity.id === selectedNodeId) {
      context.strokeStyle = "#f8fafc";
      context.lineWidth = 1.5;
      context.stroke();
    }
  }

  // Table nodes are compact cards drawn above their regions and edges.
  for (const table of scene.tableNodes) {
    context.fillStyle = "#1c3043";
    context.strokeStyle = "#5d7890";
    context.lineWidth = 1;
    context.fillRect(table.screen.x - 10, table.screen.y - 12, Math.max(100, table.label.length * 7 + 26), 24);
    context.strokeRect(table.screen.x - 10, table.screen.y - 12, Math.max(100, table.label.length * 7 + 26), 24);
    context.fillStyle = "#e2e8f0";
    context.font = "600 12px system-ui, sans-serif";
    context.textBaseline = "middle";
    context.fillText(table.label, table.screen.x, table.screen.y);
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
      return leftPriority - rightPriority || left.nodeId.localeCompare(right.nodeId);
    })
    .slice(0, MAX_ENTITY_LABELS)
    .forEach((label) =>
      context.fillText(label.text, label.screen.x + 6, label.screen.y - 5),
    );
  context.restore();
}

export default function GraphCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<RenderScene | null>(null);
  const transformRef = useRef<GraphTransform>({ k: 1, x: 0, y: 0 });
  const animationFrameRef = useRef<number | null>(null);
  const lastHitRef = useRef<HitTarget | null>(null);
  const selectedNodeRef = useRef<string | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const keyboardTargetRef = useRef<KeyboardTarget | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const layoutClientRef = useRef<LayoutClient | null>(null);
  const viewportRef = useRef({ width: FALLBACK_WIDTH, height: FALLBACK_HEIGHT });
  const [viewport, setViewport] = useState(viewportRef.current);
  const [layout, setLayout] = useState<Awaited<ReturnType<LayoutClient["layoutGraph"]>> | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [keyboardAnnouncement, setKeyboardAnnouncement] = useState("");

  const graph = useAnalysisStore((state) => state.graph);
  const analysisStatus = useAnalysisStore((state) => state.analysisStatus);
  const errorMessage = useAnalysisStore((state) => state.errorMessage);
  const warnings = useAnalysisStore((state) => state.warnings);
  const hoveredNodeId = useAnalysisStore((state) => state.hoveredNodeId);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const confidenceThreshold = useAnalysisStore((state) => state.confidenceThreshold);
  const fitViewRequest = useAnalysisStore((state) => state.fitViewRequest);
  const relayoutRequest = useAnalysisStore((state) => state.relayoutRequest);
  const focusNodeRequest = useAnalysisStore((state) => state.focusNodeRequest);
  const setHoveredNode = useAnalysisStore((state) => state.setHoveredNode);
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);
  const requestNodeFocus = useAnalysisStore((state) => state.requestNodeFocus);
  const selectEntityEdge = useAnalysisStore((state) => state.selectEntityEdge);
  const selectTableEdge = useAnalysisStore((state) => state.selectTableEdge);

  const invalidate = useCallback(() => {
    if (animationFrameRef.current !== null) return;
    // A sentinel keeps synchronous test RAFs from leaving a completed frame queued.
    animationFrameRef.current = -1;
    const frame = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const canvas = canvasRef.current;
      const scene = sceneRef.current;
      if (!canvas || !scene) return;
      const context = canvas.getContext("2d");
      if (!context) return;
      drawScene(context, scene, viewportRef.current.width, viewportRef.current.height, selectedNodeRef.current, hoveredNodeRef.current);
    });
    if (animationFrameRef.current === -1) animationFrameRef.current = frame;
  }, []);

  useEffect(() => {
    selectedNodeRef.current = selectedNodeId;
    hoveredNodeRef.current = hoveredNodeId;
    invalidate();
  }, [hoveredNodeId, invalidate, selectedNodeId]);

  const rebuildScene = useCallback(() => {
    if (!graph || !layout) {
      sceneRef.current = null;
      return;
    }
    sceneRef.current = buildScene({ graph, layout, transform: transformRef.current, confidenceThreshold });
    invalidate();
  }, [confidenceThreshold, graph, invalidate, layout]);

  useEffect(() => {
    rebuildScene();
  }, [rebuildScene]);

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
    const context = canvas.getContext("2d");
    context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    rebuildScene();
  }, [rebuildScene, viewport]);

  useEffect(() => {
    if (!graph) {
      setLayout(null);
      setLayoutError(null);
      return;
    }
    let active = true;
    setLayout(null);
    setLayoutError(null);
    if (relayoutRequest > 0 && zoomRef.current && canvasRef.current) {
      d3.select(canvasRef.current).call(zoomRef.current.transform, d3.zoomIdentity);
    }
    const client = layoutClientRef.current ?? createLayoutClient();
    layoutClientRef.current = client;
    client.reset();
    void client.layoutGraph(graph, viewport).then(
      (next) => {
        if (active) setLayout(next);
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
  }, [graph, relayoutRequest, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const zoom = d3.zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.25, 2.5])
      .on("zoom", (event) => {
        transformRef.current = event.transform;
        rebuildScene();
      });
    zoomRef.current = zoom;
    d3.select(canvas).call(zoom);
    return () => {
      d3.select(canvas).on(".zoom", null);
      zoomRef.current = null;
    };
  }, [rebuildScene]);

  const fitView = useCallback(() => {
    if (!layout || !graph || !zoomRef.current || !canvasRef.current) return;
    const regions = layout.tableRegions;
    if (!regions.length) return;
    const minX = Math.min(...regions.map((region) => region.x));
    const minY = Math.min(...regions.map((region) => region.y));
    const maxX = Math.max(...regions.map((region) => region.x + region.width));
    const maxY = Math.max(...regions.map((region) => region.y + region.height));
    const k = Math.max(0.25, Math.min(2, Math.min((viewport.width - 96) / Math.max(1, maxX - minX), (viewport.height - 96) / Math.max(1, maxY - minY))));
    d3.select(canvasRef.current).call(zoomRef.current.transform, d3.zoomIdentity.translate(viewport.width / 2, viewport.height / 2).scale(k).translate(-(minX + maxX) / 2, -(minY + maxY) / 2));
  }, [graph, layout, viewport]);

  useEffect(() => {
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
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    layoutClientRef.current?.dispose();
    layoutClientRef.current = null;
  }, []);

  const applyHit = useCallback((target: HitTarget | null) => {
    lastHitRef.current = target;
    setHoveredNode(target?.kind === "entity-node" ? target.id : null);
  }, [setHoveredNode]);

  const keyboardTargets = useCallback((): KeyboardTarget[] => {
    const scene = sceneRef.current;
    if (!scene) return [];
    return [
      ...scene.tableNodes.map((node) => ({
        hit: { kind: "table-node" as const, id: node.id },
        label: `${node.label}，表`,
        x: node.screen.x,
        y: node.screen.y,
      })),
      ...scene.entityDots.map((node) => ({
        hit: { kind: "entity-node" as const, id: node.id },
        label: `${node.label}，实体`,
        x: node.screen.x,
        y: node.screen.y,
      })),
    ].sort((left, right) =>
      left.y - right.y || left.x - right.x || left.hit.id.localeCompare(right.hit.id),
    );
  }, []);

  const setKeyboardTarget = useCallback((target: KeyboardTarget | null) => {
    keyboardTargetRef.current = target;
    lastHitRef.current = target?.hit ?? null;
    setKeyboardAnnouncement(target ? `当前目标：${target.label}` : "");
  }, []);

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
          left.hit.id.localeCompare(right.hit.id);
      })[0];
    setKeyboardTarget(next);
  }, [keyboardTargets, setKeyboardTarget]);

  const focusSupportingRelations = useCallback((tableEdgeId: string) => {
    if (!graph || !layout || !zoomRef.current || !canvasRef.current) return;
    const tableEdge = graph.table_edges.find((edge) => edge.id === tableEdgeId);
    if (!tableEdge || tableEdge.supporting_entity_edges.length === 0) return;
    const supportingIds = new Set(tableEdge.supporting_entity_edges);
    const supportingEdges = layout.entityEdges.filter((edge) =>
      supportingIds.has(edge.id),
    );
    if (supportingEdges.length === 0) return;
    const points = supportingEdges.flatMap((edge) => [edge.from, edge.to]);
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const padding = 120;
    const k = Math.max(
      0.25,
      Math.min(
        2.5,
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
  }, [graph, layout, viewport]);

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

  const entityCount = graph?.entity_nodes.length ?? 0;
  const tableCount = graph?.table_nodes.length ?? 0;
  const edgeCount = graph ? graph.entity_edges.length + graph.table_edges.length : 0;
  const notice = layoutError ?? (analysisStatus === "failed" ? errorMessage || "分析失败，以下图谱为可用的部分结果。" : null);

  return (
    <div ref={containerRef} role="group" aria-label={graphSummary(entityCount, tableCount, edgeCount)} className="relative h-full min-h-[420px] overflow-hidden rounded-xl border border-slate-700/70 bg-[#0d1926]">
      <canvas
        ref={canvasRef}
        role="img"
        data-layout-ready={layout ? "true" : "false"}
        tabIndex={0}
        aria-label={graphSummary(entityCount, tableCount, edgeCount)}
        className="block h-full w-full touch-none outline-none focus:ring-2 focus:ring-teal-300"
        onFocus={() => {
          if (!keyboardTargetRef.current) {
            setKeyboardTarget(keyboardTargets()[0] ?? null);
          }
        }}
        onPointerMove={(event) => applyHit(sceneRef.current ? hitTest(sceneRef.current, pointFromEvent(event.currentTarget, event.nativeEvent)) : null)}
        onPointerLeave={() => applyHit(null)}
        onClick={(event) => selectHit(sceneRef.current ? hitTest(sceneRef.current, pointFromEvent(event.currentTarget, event.nativeEvent)) : null)}
        onKeyDown={(event) => {
          if (event.key.startsWith("Arrow")) {
            event.preventDefault();
            moveKeyboardTarget(event.key);
            return;
          }
          if ((event.key === "Enter" || event.key === " ") && lastHitRef.current) {
            event.preventDefault();
            selectHit(lastHitRef.current);
          }
        }}
      />
      <span aria-live="polite" className="sr-only">{keyboardAnnouncement}</span>
      {!graph && <p data-empty-warning className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-slate-400">等待分析结果生成语义关系图。</p>}
      {analysisStatus === "partial" && <p role="status" className="absolute left-3 top-3 rounded bg-amber-400/15 px-3 py-2 text-xs text-amber-100">分析部分完成，正在显示可用关系。</p>}
      {notice && <div role="alert" className="absolute bottom-3 left-3 right-3 rounded border border-amber-400/30 bg-slate-950/85 px-3 py-2 text-sm text-amber-100"><p>{notice}</p>{warnings.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-amber-200">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div>}
    </div>
  );
}
