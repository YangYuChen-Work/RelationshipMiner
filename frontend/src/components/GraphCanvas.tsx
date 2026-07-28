import { useEffect, useId, useRef } from "react";
import * as d3 from "d3";
import type { EdgeData, NodeData } from "../api/analysis";
import { useAnalysisStore } from "../store/analysis";
import {
  getDirectNeighborIds,
  getRectBoundaryPoint,
  getVisibleEdgeCount,
} from "./graphGeometry";

const CARD_WIDTH = 168;
const CARD_HEIGHT = 64;
const HALF_CARD_WIDTH = CARD_WIDTH / 2;
const HALF_CARD_HEIGHT = CARD_HEIGHT / 2;
const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 600;
const GRID_COLUMN_GAP = 48;
const GRID_ROW_GAP = 44;
const GRID_PADDING = 56;
const ACCENT = "#2dd4bf";
const BASE_EDGE = "#52677a";
const BASE_CARD_STROKE = "#354b60";

const TABLE_COLORS = [
  "#8795a6",
  "#858aa3",
  "#76969a",
  "#938a9a",
  "#7f91a0",
  "#8a9186",
];

type D3Node = d3.SimulationNodeDatum & NodeData;

type D3Edge = d3.SimulationLinkDatum<D3Node> &
  Omit<EdgeData, "source" | "target"> & {
    source: string | D3Node;
    target: string | D3Node;
  };

function endpointId(endpoint: string | D3Node): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function shortClassName(fullName: string | null): string {
  if (!fullName) return "";
  const parts = fullName.split(".");
  return parts.at(-1) || fullName;
}

function clipped(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1)}…`
    : value;
}

function nodeTitle(node: NodeData): string {
  return clipped(shortClassName(node.class_name) || node.id, 24);
}

function nodeAccessibleLabel(node: NodeData): string {
  const identity = node.class_name
    ? `${node.class_name}，ID ${node.id}`
    : `ID ${node.id}`;
  return `${identity}，来源 ${node.source_table}，${node.degree} 个关联`;
}

function edgeLabel(edge: Pick<EdgeData, "labels">): string {
  return clipped(edge.labels.join(" · ") || "关联", 28);
}

function canvasSize(container: HTMLDivElement) {
  const bounds = container.getBoundingClientRect();
  return {
    width: container.clientWidth || bounds.width || FALLBACK_WIDTH,
    height: container.clientHeight || bounds.height || FALLBACK_HEIGHT,
  };
}

function arrangeGrid(nodes: D3Node[], width: number) {
  const columnPitch = CARD_WIDTH + GRID_COLUMN_GAP;
  const rowPitch = CARD_HEIGHT + GRID_ROW_GAP;
  const columns = Math.max(
    1,
    Math.floor((width - GRID_PADDING * 2 + GRID_COLUMN_GAP) / columnPitch),
  );

  nodes.forEach((node, index) => {
    node.x =
      GRID_PADDING + HALF_CARD_WIDTH + (index % columns) * columnPitch;
    node.y =
      GRID_PADDING +
      HALF_CARD_HEIGHT +
      Math.floor(index / columns) * rowPitch;
    node.vx = 0;
    node.vy = 0;
    node.fx = null;
    node.fy = null;
  });
}

export default function GraphCanvas() {
  const instanceId = useId().replace(/:/g, "");
  const gridId = `graph-canvas-grid-${instanceId}`;
  const arrowId = `graph-arrow-${instanceId}`;
  const accentArrowId = `graph-arrow-accent-${instanceId}`;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Edge> | null>(null);
  const fitViewRef = useRef<() => void>(() => {});
  const relayoutRef = useRef<() => void>(() => {});
  const focusNodeRef = useRef<(nodeId: string) => void>(() => {});

  const graph = useAnalysisStore((state) => state.graph);
  const hoveredNodeId = useAnalysisStore((state) => state.hoveredNodeId);
  const selectedNodeId = useAnalysisStore((state) => state.selectedNodeId);
  const confidenceThreshold = useAnalysisStore(
    (state) => state.confidenceThreshold,
  );
  const fitViewRequest = useAnalysisStore((state) => state.fitViewRequest);
  const relayoutRequest = useAnalysisStore(
    (state) => state.relayoutRequest,
  );
  const focusNodeRequest = useAnalysisStore(
    (state) => state.focusNodeRequest,
  );
  const setHoveredNode = useAnalysisStore((state) => state.setHoveredNode);
  const setSelectedNode = useAnalysisStore((state) => state.setSelectedNode);

  const lastFitViewRequest = useRef(fitViewRequest);
  const lastRelayoutRequest = useRef(relayoutRequest);
  const lastFocusNodeRequest = useRef(focusNodeRequest?.version ?? 0);

  useEffect(() => {
    const svgElement = svgRef.current;
    const container = containerRef.current;
    if (!graph || !svgElement || !container) return;

    const reducedMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let reducedMotion = reducedMotionQuery?.matches ?? false;
    const hasEdges = graph.edges.length > 0;
    const nodes: D3Node[] = graph.nodes
      .map((node) => ({ ...node }))
      .sort((left, right) =>
        hasEdges
          ? 0
          : left.source_table.localeCompare(right.source_table) ||
            left.id.localeCompare(right.id),
      );
    const edges: D3Edge[] = graph.edges.map((edge) => ({ ...edge }));
    const tableNames = [...new Set(nodes.map((node) => node.source_table))];
    const tableColor = new Map(
      tableNames.map((table, index) => [
        table,
        TABLE_COLORS[index % TABLE_COLORS.length],
      ]),
    );

    const svg = d3.select(svgElement);
    svg.selectAll("*").remove();
    svg.property("__zoom", d3.zoomIdentity);

    let { width, height } = canvasSize(container);
    svg
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("preserveAspectRatio", "xMidYMid meet");

    const defs = svg.append("defs");
    const pattern = defs
      .append("pattern")
      .attr("id", gridId)
      .attr("width", 24)
      .attr("height", 24)
      .attr("patternUnits", "userSpaceOnUse");
    pattern
      .append("path")
      .attr("d", "M 24 0 L 0 0 0 24")
      .attr("fill", "none")
      .attr("stroke", "#213243")
      .attr("stroke-width", 0.7)
      .attr("opacity", 0.42);

    const makeMarker = (id: string, fill: string) => {
      defs
        .append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 10)
        .attr("refY", 0)
        .attr("markerWidth", 7)
        .attr("markerHeight", 7)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-4L10,0L0,4Z")
        .attr("fill", fill);
    };
    makeMarker(arrowId, BASE_EDGE);
    makeMarker(accentArrowId, ACCENT);

    const background = svg
      .append("rect")
      .attr("class", "canvas-grid")
      .attr("width", width)
      .attr("height", height)
      .attr("fill", `url(#${gridId})`);

    const zoomGroup = svg
      .append("g")
      .attr("class", "zoom-group")
      .attr("transform", d3.zoomIdentity.toString());
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 2.5])
      .on("zoom", (event) => {
        zoomGroup.attr("transform", event.transform.toString());
      });
    svg.call(zoom);

    const linkElements = zoomGroup
      .append("g")
      .attr("class", "links")
      .selectAll<SVGLineElement, D3Edge>("line")
      .data(edges)
      .join("line")
      .attr("data-edge-id", (edge) => {
        return `${endpointId(edge.source)}--${endpointId(edge.target)}`;
      })
      .attr("stroke", BASE_EDGE)
      .attr("stroke-width", 1.25)
      .attr("marker-end", `url(#${arrowId})`);

    const labelElements = zoomGroup
      .append("g")
      .attr("class", "edge-labels")
      .selectAll<SVGGElement, D3Edge>("g")
      .data(edges)
      .join("g")
      .attr("class", "edge-label")
      .attr("data-edge-label-id", (edge) => {
        return `${endpointId(edge.source)}--${endpointId(edge.target)}`;
      })
      .attr("pointer-events", "none");

    labelElements
      .append("rect")
      .attr("x", (edge) => -(edgeLabel(edge).length * 5.8 + 14) / 2)
      .attr("y", -10)
      .attr("width", (edge) => edgeLabel(edge).length * 5.8 + 14)
      .attr("height", 20)
      .attr("rx", 5)
      .attr("fill", "#0b1723")
      .attr("stroke", "#314557")
      .attr("stroke-width", 0.75);
    labelElements
      .append("text")
      .text(edgeLabel)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 10)
      .attr("font-weight", 600)
      .attr("fill", "#aab8c6");

    const nodeElements = zoomGroup
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, D3Node>("g")
      .data(nodes, (node) => node.id)
      .join("g")
      .attr("data-node-id", (node) => node.id)
      .attr("role", "button")
      .attr("tabindex", 0)
      .attr("aria-label", nodeAccessibleLabel)
      .attr("aria-pressed", "false")
      .attr("cursor", "pointer");

    nodeElements.append("title").text(nodeAccessibleLabel);
    nodeElements
      .append("rect")
      .attr("class", "node-card")
      .attr("x", -HALF_CARD_WIDTH)
      .attr("y", -HALF_CARD_HEIGHT)
      .attr("width", CARD_WIDTH)
      .attr("height", CARD_HEIGHT)
      .attr("rx", 9)
      .attr("fill", "#142638")
      .attr("stroke", BASE_CARD_STROKE)
      .attr("stroke-width", 1.25);
    nodeElements
      .append("text")
      .attr("class", "node-source")
      .attr("x", -HALF_CARD_WIDTH + 13)
      .attr("y", -14)
      .attr("font-size", 9)
      .attr("font-weight", 700)
      .attr("letter-spacing", "0.09em")
      .attr("fill", (node) => tableColor.get(node.source_table) || "#8795a6")
      .text((node) => clipped(node.source_table, 25));
    nodeElements
      .append("text")
      .attr("class", "node-title")
      .attr("x", -HALF_CARD_WIDTH + 13)
      .attr("y", 5)
      .attr("font-size", 13)
      .attr("font-weight", 650)
      .attr("fill", "#eef5fa")
      .text(nodeTitle);
    nodeElements
      .append("text")
      .attr("class", "node-degree")
      .attr("x", -HALF_CARD_WIDTH + 13)
      .attr("y", 22)
      .attr("font-size", 9.5)
      .attr("fill", "#8fa0b0")
      .text((node) => `关联 ${node.degree}`);

    const renderPositions = () => {
      linkElements
        .attr("x1", (edge) => {
          const source = edge.source as D3Node;
          const target = edge.target as D3Node;
          return getRectBoundaryPoint(
            { x: source.x ?? 0, y: source.y ?? 0 },
            { x: target.x ?? 0, y: target.y ?? 0 },
            HALF_CARD_WIDTH,
            HALF_CARD_HEIGHT,
          ).x;
        })
        .attr("y1", (edge) => {
          const source = edge.source as D3Node;
          const target = edge.target as D3Node;
          return getRectBoundaryPoint(
            { x: source.x ?? 0, y: source.y ?? 0 },
            { x: target.x ?? 0, y: target.y ?? 0 },
            HALF_CARD_WIDTH,
            HALF_CARD_HEIGHT,
          ).y;
        })
        .attr("x2", (edge) => {
          const source = edge.source as D3Node;
          const target = edge.target as D3Node;
          return getRectBoundaryPoint(
            { x: target.x ?? 0, y: target.y ?? 0 },
            { x: source.x ?? 0, y: source.y ?? 0 },
            HALF_CARD_WIDTH,
            HALF_CARD_HEIGHT,
          ).x;
        })
        .attr("y2", (edge) => {
          const source = edge.source as D3Node;
          const target = edge.target as D3Node;
          return getRectBoundaryPoint(
            { x: target.x ?? 0, y: target.y ?? 0 },
            { x: source.x ?? 0, y: source.y ?? 0 },
            HALF_CARD_WIDTH,
            HALF_CARD_HEIGHT,
          ).y;
        });

      labelElements.attr("transform", (edge) => {
        const source = edge.source as D3Node;
        const target = edge.target as D3Node;
        const x = ((source.x ?? 0) + (target.x ?? 0)) / 2;
        const y = ((source.y ?? 0) + (target.y ?? 0)) / 2;
        return `translate(${x},${y})`;
      });
      nodeElements.attr(
        "transform",
        (node) => `translate(${node.x ?? 0},${node.y ?? 0})`,
      );
    };

    const fitView = () => {
      if (nodes.length === 0) return;

      const minX =
        d3.min(nodes, (node) => (node.x ?? 0) - HALF_CARD_WIDTH) ?? 0;
      const maxX =
        d3.max(nodes, (node) => (node.x ?? 0) + HALF_CARD_WIDTH) ?? width;
      const minY =
        d3.min(nodes, (node) => (node.y ?? 0) - HALF_CARD_HEIGHT) ?? 0;
      const maxY =
        d3.max(nodes, (node) => (node.y ?? 0) + HALF_CARD_HEIGHT) ?? height;
      const boundsWidth = Math.max(1, maxX - minX);
      const boundsHeight = Math.max(1, maxY - minY);
      const scale = Math.min(
        2,
        Math.max(
          0.25,
          Math.min(
            (width - GRID_PADDING * 2) / boundsWidth,
            (height - GRID_PADDING * 2) / boundsHeight,
          ),
        ),
      );
      const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(scale)
        .translate(-(minX + maxX) / 2, -(minY + maxY) / 2);

      svg.call(zoom.transform, transform);
    };
    fitViewRef.current = fitView;
    focusNodeRef.current = (nodeId) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node || node.x === undefined || node.y === undefined) return;

      const currentTransform = d3.zoomTransform(svgElement);
      const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(currentTransform.k)
        .translate(-node.x, -node.y);
      svg.call(zoom.transform, transform);
    };

    svg.on("click.canvas", (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest?.("[data-node-id]")) setSelectedNode(null);
    });

    nodeElements
      .on("mouseenter.node", (_event, node) => setHoveredNode(node.id))
      .on("mouseleave.node", () => setHoveredNode(null))
      .on("click.node", (event, node) => {
        event.stopPropagation();
        setSelectedNode(node.id);
      })
      .on("keydown.node", (event: KeyboardEvent, node) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setSelectedNode(node.id);
        }
      });

    const drag = d3
      .drag<SVGGElement, D3Node>()
      .on("start", (event, node) => {
        if (!event.active && !reducedMotion) {
          simulationRef.current?.alphaTarget(0.25).restart();
        }
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event, node) => {
        node.fx = event.x;
        node.fy = event.y;
        node.x = event.x;
        node.y = event.y;
        renderPositions();
      })
      .on("end", (event) => {
        if (!event.active) {
          simulationRef.current?.alphaTarget(0);
          if (reducedMotion) simulationRef.current?.stop();
        }
      });
    nodeElements.call(drag);

    let autoFitTimer: number | undefined;
    let autoFitDone = false;
    let stabilizeSimulation = () => {};
    const performInitialFit = () => {
      if (autoFitDone) return;
      autoFitDone = true;
      fitView();
    };

    if (hasEdges) {
      const simulation = d3
        .forceSimulation<D3Node>(nodes)
        .force(
          "link",
          d3
            .forceLink<D3Node, D3Edge>(edges)
            .id((node) => node.id)
            .distance(250)
            .strength(0.72),
        )
        .force("charge", d3.forceManyBody().strength(-780))
        .force("center", d3.forceCenter(width / 2, height / 2))
        .force("x", d3.forceX(width / 2).strength(0.035))
        .force("y", d3.forceY(height / 2).strength(0.035))
        .force(
          "collide",
          d3.forceCollide<D3Node>(HALF_CARD_WIDTH + 22).iterations(2),
        )
        .on("tick", renderPositions)
        .on("end.auto-fit", performInitialFit);
      simulationRef.current = simulation;
      stabilizeSimulation = () => {
        simulation.stop();
        simulation.alpha(1).tick(300);
        renderPositions();
        performInitialFit();
      };
      if (reducedMotion) {
        stabilizeSimulation();
      } else {
        renderPositions();
        autoFitTimer = window.setTimeout(performInitialFit, 6_000);
      }
    } else {
      simulationRef.current = null;
      arrangeGrid(nodes, width);
      renderPositions();
      autoFitTimer = window.setTimeout(performInitialFit, 0);
    }

    relayoutRef.current = () => {
      if (!hasEdges) {
        arrangeGrid(nodes, width);
        renderPositions();
        return;
      }

      nodes.forEach((node) => {
        node.fx = null;
        node.fy = null;
      });
      if (reducedMotion) {
        stabilizeSimulation();
      } else {
        simulationRef.current?.alpha(1).restart();
      }
    };

    const handleReducedMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      if (reducedMotion) {
        if (autoFitTimer !== undefined) {
          window.clearTimeout(autoFitTimer);
          autoFitTimer = undefined;
        }
        stabilizeSimulation();
      } else if (hasEdges) {
        simulationRef.current?.alpha(0.35).restart();
      }
    };
    reducedMotionQuery?.addEventListener(
      "change",
      handleReducedMotionChange,
    );

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        const next = canvasSize(container);
        if (next.width === width && next.height === height) return;

        width = next.width;
        height = next.height;
        svg.attr("viewBox", `0 0 ${width} ${height}`);
        background.attr("width", width).attr("height", height);

        if (hasEdges) {
          simulationRef.current
            ?.force("center", d3.forceCenter(width / 2, height / 2))
            .force("x", d3.forceX(width / 2).strength(0.035))
            .force("y", d3.forceY(height / 2).strength(0.035));
          if (reducedMotion) {
            stabilizeSimulation();
          } else {
            simulationRef.current?.alpha(0.25).restart();
          }
        } else {
          arrangeGrid(nodes, width);
          renderPositions();
          fitView();
        }
      });
      resizeObserver.observe(container);
    }

    return () => {
      if (autoFitTimer !== undefined) window.clearTimeout(autoFitTimer);
      reducedMotionQuery?.removeEventListener(
        "change",
        handleReducedMotionChange,
      );
      resizeObserver?.disconnect();
      simulationRef.current
        ?.on("tick", null)
        .on("end.auto-fit", null)
        .stop();
      simulationRef.current = null;
      nodeElements.on(".node", null).on(".drag", null);
      svg.on(".zoom", null).on(".canvas", null);
      svg.selectAll("*").interrupt();
      fitViewRef.current = () => {};
      relayoutRef.current = () => {};
      focusNodeRef.current = () => {};
    };
  }, [
    accentArrowId,
    arrowId,
    graph,
    gridId,
    setHoveredNode,
    setSelectedNode,
  ]);

  useEffect(() => {
    if (!graph || !svgRef.current) return;

    const neighbors = hoveredNodeId
      ? getDirectNeighborIds(hoveredNodeId, graph.edges)
      : null;
    const svg = d3.select(svgRef.current);

    svg
      .selectAll<SVGGElement, D3Node>("[data-node-id]")
      .attr("aria-pressed", (node) =>
        node.id === selectedNodeId ? "true" : "false",
      )
      .attr("opacity", (node) =>
        !neighbors || neighbors.has(node.id) ? 1 : 0.18,
      )
      .select<SVGRectElement>("rect.node-card")
      .attr("stroke", (node) => {
        if (node.id === selectedNodeId) return ACCENT;
        if (neighbors?.has(node.id)) return ACCENT;
        return BASE_CARD_STROKE;
      })
      .attr("stroke-width", (node) =>
        node.id === selectedNodeId ? 2.5 : neighbors?.has(node.id) ? 1.5 : 1.25,
      );

    svg
      .selectAll<SVGLineElement, D3Edge>("[data-edge-id]")
      .attr("opacity", (edge) => {
        if (!hoveredNodeId) return 1;
        return endpointId(edge.source) === hoveredNodeId ||
          endpointId(edge.target) === hoveredNodeId
          ? 1
          : 0.08;
      })
      .attr("stroke", (edge) => {
        if (!hoveredNodeId) return BASE_EDGE;
        return endpointId(edge.source) === hoveredNodeId ||
          endpointId(edge.target) === hoveredNodeId
          ? ACCENT
          : BASE_EDGE;
      })
      .attr("marker-end", (edge) => {
        const emphasized =
          hoveredNodeId &&
          (endpointId(edge.source) === hoveredNodeId ||
            endpointId(edge.target) === hoveredNodeId);
        return emphasized
          ? `url(#${accentArrowId})`
          : `url(#${arrowId})`;
      });

    svg
      .selectAll<SVGGElement, D3Edge>("[data-edge-label-id]")
      .attr("opacity", (edge) => {
        if (!hoveredNodeId) return 1;
        return endpointId(edge.source) === hoveredNodeId ||
          endpointId(edge.target) === hoveredNodeId
          ? 1
          : 0.08;
      });
  }, [accentArrowId, arrowId, graph, hoveredNodeId, selectedNodeId]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    svg
      .selectAll<SVGLineElement, D3Edge>("[data-edge-id]")
      .attr("display", (edge) =>
        edge.confidence >= confidenceThreshold ? null : "none",
      );
    svg
      .selectAll<SVGGElement, D3Edge>("[data-edge-label-id]")
      .attr("display", (edge) =>
        edge.confidence >= confidenceThreshold ? null : "none",
      );
  }, [confidenceThreshold, graph]);

  useEffect(() => {
    if (fitViewRequest === lastFitViewRequest.current) return;
    lastFitViewRequest.current = fitViewRequest;
    fitViewRef.current();
  }, [fitViewRequest]);

  useEffect(() => {
    if (relayoutRequest === lastRelayoutRequest.current) return;
    lastRelayoutRequest.current = relayoutRequest;
    relayoutRef.current();
  }, [relayoutRequest]);

  useEffect(() => {
    if (
      !focusNodeRequest ||
      focusNodeRequest.version === lastFocusNodeRequest.current
    ) {
      return;
    }
    lastFocusNodeRequest.current = focusNodeRequest.version;
    focusNodeRef.current(focusNodeRequest.nodeId);
  }, [focusNodeRequest]);

  if (!graph) {
    return (
      <div className="flex h-full min-h-[420px] items-center justify-center bg-[#0a1622] text-sm text-slate-500">
        暂无图谱数据
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div
        role="status"
        className="flex h-full min-h-[420px] items-center justify-center bg-[#0a1622] px-6 text-center"
      >
        <div className="max-w-md rounded-xl border border-slate-700 bg-slate-900/75 px-5 py-6">
          <h2 className="text-sm font-semibold text-slate-100">
            未生成任何实体
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            请点击上方“新分析”，调整数据表或字段后重新尝试。
          </p>
        </div>
      </div>
    );
  }

  const visibleEdgeCount = getVisibleEdgeCount(
    graph.edges,
    confidenceThreshold,
  );

  return (
    <div
      ref={containerRef}
      className="relative h-full min-h-[420px] w-full overflow-hidden bg-[#0a1622]"
    >
      {graph.edges.length === 0 && (
        <p
          data-empty-warning
          className="pointer-events-none absolute left-3 top-3 z-10 max-w-sm rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-300 shadow-lg"
          role="status"
        >
          未发现任何关系，实体已按来源表排列
        </p>
      )}
      <svg
        ref={svgRef}
        className="block h-full w-full bg-[#0a1622]"
        role="group"
        aria-label={`${graph.nodes.length} 个实体，${visibleEdgeCount} 条可见关系`}
      />
    </div>
  );
}
