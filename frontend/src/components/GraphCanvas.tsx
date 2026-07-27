/** GraphCanvas — D3 力导向图谱核心渲染组件。

使用 D3 forceSimulation 渲染节点和边的 SVG。
支持缩放、拖拽、悬停高亮（不限深度）、单击居中、双击详情面板。
消费 Zustand store 中的图谱数据与交互状态。
*/

import { useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";
import { useAnalysisStore } from "../store/analysis";
import type { NodeData, EdgeData } from "../api/analysis";

type D3Node = d3.SimulationNodeDatum & NodeData;
type D3Edge = d3.SimulationLinkDatum<D3Node> & EdgeData;

/** BFS 计算与给定节点连通的所有节点 ID（不限深度）。 */
function getConnectedNodeIds(
  nodeId: string,
  edges: EdgeData[]
): Set<string> {
  const visited = new Set<string>([nodeId]);
  const queue = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      const sourceId = typeof edge.source === "string" ? edge.source : (edge.source as { id: string }).id;
      const targetId = typeof edge.target === "string" ? edge.target : (edge.target as { id: string }).id;

      if (sourceId === current && !visited.has(targetId)) {
        visited.add(targetId);
        queue.push(targetId);
      }
      if (targetId === current && !visited.has(sourceId)) {
        visited.add(sourceId);
        queue.push(sourceId);
      }
    }
  }

  return visited;
}

/** 截取 Java 全限定名的简短类名。 */
function shortClassName(fullName: string | null): string {
  if (!fullName) return "";
  const parts = fullName.split(".");
  return parts[parts.length - 1] || fullName;
}

export default function GraphCanvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<D3Node, D3Edge> | null>(null);

  const graph = useAnalysisStore((s) => s.graph);
  const hoveredNodeId = useAnalysisStore((s) => s.hoveredNodeId);
  const selectedNodeId = useAnalysisStore((s) => s.selectedNodeId);
  const confidenceThreshold = useAnalysisStore((s) => s.confidenceThreshold);
  const setHoveredNode = useAnalysisStore((s) => s.setHoveredNode);
  const setSelectedNode = useAnalysisStore((s) => s.setSelectedNode);
  const openDetailPanel = useAnalysisStore((s) => s.openDetailPanel);

  /** 悬停时计算连通分量并高亮。 */
  const handleNodeHover = useCallback(
    (nodeId: string | null) => {
      setHoveredNode(nodeId);
    },
    [setHoveredNode]
  );

  /** 单击节点居中。 */
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      setSelectedNode(nodeId);
    },
    [setSelectedNode]
  );

  /** 双击节点打开详情面板。 */
  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      openDetailPanel(nodeId);
    },
    [openDetailPanel]
  );

  useEffect(() => {
    if (!graph || !svgRef.current || !containerRef.current) return;

    const nodes: D3Node[] = graph.nodes.map((n) => ({ ...n }));
    const edges: D3Edge[] = graph.edges.map((e) => ({
      ...e,
      source: typeof e.source === "string" ? e.source : e.source,
      target: typeof e.target === "string" ? e.target : e.target,
    }));

    const svg = d3.select(svgRef.current);
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight || 600;

    // 清空
    svg.selectAll("*").remove();

    // SVG 尺寸
    svg.attr("width", width).attr("height", height);

    // 缩放行为
    const zoomGroup = svg.append("g").attr("class", "zoom-group");

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event) => {
        zoomGroup.attr("transform", event.transform.toString());
      });

    svg.call(zoom);

    // 表名颜色映射
    const tableNames = [...new Set(nodes.map((n) => n.source_table))];
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10).domain(tableNames);

    // 节点半径映射（基于度数）
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(nodes, (d) => d.degree) || 1])
      .range([5, 20]);

    // 箭头标记定义
    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 22)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#9ca3af");

    // 边
    const linkGroup = zoomGroup.append("g").attr("class", "links");

    const linkElements = linkGroup
      .selectAll<SVGLineElement, D3Edge>("line")
      .data(edges)
      .join("line")
      .attr("stroke", "#d1d5db")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // 边标签
    const linkLabelGroup = zoomGroup.append("g").attr("class", "link-labels");

    const linkLabelElements = linkLabelGroup
      .selectAll<SVGTextElement, D3Edge>("text")
      .data(edges)
      .join("text")
      .text((d) => d.labels.join(" + "))
      .attr("font-size", 9)
      .attr("fill", "#6b7280")
      .attr("text-anchor", "middle")
      .attr("dy", -6);

    // 节点组
    const nodeGroup = zoomGroup.append("g").attr("class", "nodes");

    const nodeElements = nodeGroup
      .selectAll<SVGGElement, D3Node>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer");

    // 节点圆形
    nodeElements
      .append("circle")
      .attr("r", (d) => radiusScale(d.degree))
      .attr("fill", (d) => colorScale(d.source_table))
      .attr("stroke", "#fff")
      .attr("stroke-width", 1.5);

    // 节点文本 (class_name 简短类名)
    nodeElements
      .append("text")
      .text((d) => shortClassName(d.class_name))
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", 8)
      .attr("fill", "#fff")
      .attr("pointer-events", "none");

    // 拖拽行为
    const drag = d3
      .drag<SVGGElement, D3Node>()
      .on("start", (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulationRef.current?.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeElements.call(drag);

    // 交互事件
    nodeElements
      .on("mouseenter", (_event, d) => {
        handleNodeHover(d.id);
      })
      .on("mouseleave", () => {
        handleNodeHover(null);
      })
      .on("click", (_event, d) => {
        handleNodeClick(d.id);
      })
      .on("dblclick", (_event, d) => {
        handleNodeDoubleClick(d.id);
      });

    // 力导向模拟
    const simulation = d3
      .forceSimulation<D3Node>(nodes)
      .force(
        "link",
        d3
          .forceLink<D3Node, D3Edge>(edges)
          .id((d) => d.id)
          .distance(80)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius((d) => radiusScale((d as D3Node).degree) + 2));

    simulationRef.current = simulation;

    // tick 更新位置
    simulation.on("tick", () => {
      linkElements
        .attr("x1", (d) => (d.source as D3Node).x ?? 0)
        .attr("y1", (d) => (d.source as D3Node).y ?? 0)
        .attr("x2", (d) => (d.target as D3Node).x ?? 0)
        .attr("y2", (d) => (d.target as D3Node).y ?? 0);

      linkLabelElements
        .attr("x", (d) => {
          const sx = (d.source as D3Node).x ?? 0;
          const tx = (d.target as D3Node).x ?? 0;
          return (sx + tx) / 2;
        })
        .attr("y", (d) => {
          const sy = (d.source as D3Node).y ?? 0;
          const ty = (d.target as D3Node).y ?? 0;
          return (sy + ty) / 2;
        });

      nodeElements.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    // cleanup
    return () => {
      simulation.stop();
    };
  }, [
    graph,
    handleNodeHover,
    handleNodeClick,
    handleNodeDoubleClick,
  ]);

  // ── 悬停高亮效果 ──
  useEffect(() => {
    if (!graph || !svgRef.current) return;

    const svg = d3.select(svgRef.current);

    if (hoveredNodeId) {
      const connectedIds = getConnectedNodeIds(hoveredNodeId, graph.edges);

      // 节点高亮/淡出
      svg
        .selectAll<SVGGElement, D3Node>(".nodes g")
        .transition()
        .duration(200)
        .attr("opacity", (d) => (connectedIds.has(d.id) ? 1 : 0.15));

      // 边高亮/淡出
      svg
        .selectAll<SVGLineElement, D3Edge>(".links line")
        .transition()
        .duration(200)
        .attr("opacity", (d) => {
          const sourceId =
            typeof d.source === "string" ? d.source : (d.source as D3Node).id;
          const targetId =
            typeof d.target === "string" ? d.target : (d.target as D3Node).id;
          return connectedIds.has(sourceId) && connectedIds.has(targetId) ? 1 : 0.1;
        });

      // 边标签
      svg
        .selectAll<SVGTextElement, D3Edge>(".link-labels text")
        .transition()
        .duration(200)
        .attr("opacity", (d) => {
          const sourceId =
            typeof d.source === "string" ? d.source : (d.source as D3Node).id;
          const targetId =
            typeof d.target === "string" ? d.target : (d.target as D3Node).id;
          return connectedIds.has(sourceId) && connectedIds.has(targetId) ? 1 : 0;
        });
    } else {
      // 恢复默认
      svg
        .selectAll<SVGGElement, D3Node>(".nodes g")
        .transition()
        .duration(200)
        .attr("opacity", 1);

      svg
        .selectAll<SVGLineElement, D3Edge>(".links line")
        .transition()
        .duration(200)
        .attr("opacity", 1);

      svg
        .selectAll<SVGTextElement, D3Edge>(".link-labels text")
        .transition()
        .duration(200)
        .attr("opacity", 1);
    }
  }, [hoveredNodeId, graph]);

  // ── 置信度筛选 ──
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);

    svg
      .selectAll<SVGLineElement, D3Edge>(".links line")
      .attr("display", (d) =>
        d.confidence >= confidenceThreshold ? null : "none"
      );

    svg
      .selectAll<SVGTextElement, D3Edge>(".link-labels text")
      .attr("display", (d) =>
        d.confidence >= confidenceThreshold ? null : "none"
      );
  }, [confidenceThreshold]);

  // ── 单击节点居中 ──
  useEffect(() => {
    if (!selectedNodeId || !svgRef.current || !graph) return;

    const node = graph.nodes.find((n) => n.id === selectedNodeId);
    if (!node || !containerRef.current) return;

    const sim = simulationRef.current;
    if (!sim) return;

    // 找到 simulation 中的对应节点并固定
    const simNodes = sim.nodes() as D3Node[];
    const target = simNodes.find((n) => n.id === selectedNodeId);
    if (target) {
      const container = containerRef.current;
      const w = container.clientWidth;
      const h = container.clientHeight || 600;
      target.fx = w / 2;
      target.fy = h / 2;
      sim.alpha(0.3).restart();

      // 一段时间后释放
      setTimeout(() => {
        target.fx = null;
        target.fy = null;
      }, 2000);
    }
  }, [selectedNodeId, graph]);

  // ── Resize 响应 ──
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (svgRef.current && container) {
        const w = container.clientWidth;
        const h = container.clientHeight || 600;
        d3.select(svgRef.current).attr("width", w).attr("height", h);
        simulationRef.current?.force("center", d3.forceCenter(w / 2, h / 2));
        simulationRef.current?.alpha(0.1).restart();
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── 空状态 ──
  if (!graph) {
    return (
      <div className="flex items-center justify-center h-[600px] bg-gray-50 rounded-xl border border-gray-200 text-gray-400 text-sm">
        暂无图谱数据
      </div>
    );
  }

  const hasEdges = graph.edges.length > 0;

  return (
    <div className="relative w-full" ref={containerRef}>
      {/* 无关系空状态提示 */}
      {!hasEdges && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-white/80 backdrop-blur-sm rounded-lg px-4 py-2 text-sm text-orange-600 border border-orange-200 shadow-sm">
            未发现任何关系，建议调整表/字段选择
          </div>
        </div>
      )}

      <svg ref={svgRef} className="w-full bg-gray-50/50 rounded-xl border border-gray-200" />
    </div>
  );
}
