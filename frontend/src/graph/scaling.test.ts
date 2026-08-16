import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import GraphCanvas from "../components/GraphCanvas";
import { useAnalysisStore } from "../store/analysis";
import {
  computeFallbackScatterLayout,
  computeNebulaLayout,
  ENTITY_COLLISION_RADIUS,
  type GraphLayout,
  type LayoutGraph,
} from "./layout";
import { buildScene } from "./scene";

const ENTITY_COUNT = 7_000;
const TABLE_COUNT = 7;
const VIEWPORT = { width: 960, height: 600 };

const graph: SemanticGraphData = {
  table_nodes: Array.from({ length: TABLE_COUNT }, (_, tableIndex) => ({
    id: `table-${tableIndex}`,
    display_name: `Table ${tableIndex}`,
    entity_count: ENTITY_COUNT / TABLE_COUNT,
  })),
  entity_nodes: Array.from({ length: ENTITY_COUNT }, (_, entityIndex) => ({
    id: `entity-${entityIndex}`,
    table_id: `table-${entityIndex % TABLE_COUNT}`,
    display_name: `Entity ${entityIndex}`,
    class_name: null,
    dimensions: { name: `Entity ${entityIndex}` },
  })),
  table_edges: [],
  entity_edges: [],
};

function closePairStats(
  nodes: GraphLayout["entityNodes"],
  minimumDistance: number,
) {
  const cells = new Map<string, typeof nodes>();
  let closePairs = 0;
  let minimumObservedDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const cellX = Math.floor(node.x / minimumDistance);
    const cellY = Math.floor(node.y / minimumDistance);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (
          const other of cells.get(`${cellX + offsetX},${cellY + offsetY}`) ??
            []
        ) {
          const distance = Math.hypot(node.x - other.x, node.y - other.y);
          minimumObservedDistance = Math.min(
            minimumObservedDistance,
            distance,
          );
          if (distance < minimumDistance) closePairs += 1;
        }
      }
    }
    const key = `${cellX},${cellY}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(node);
    else cells.set(key, [node]);
  }
  return { closePairs, minimumObservedDistance };
}

function mixedComponentGraph(sameTable: boolean): LayoutGraph {
  return {
    table_nodes: graph.table_nodes,
    entity_nodes: graph.entity_nodes,
    table_edges: graph.table_edges,
    entity_edges: Array.from({ length: 30 }, (_, index) => ({
      id: `mixed-edge-${index}`,
      source: sameTable
        ? `entity-${index * TABLE_COUNT}`
        : `entity-${index * 2}`,
      target: sameTable
        ? `entity-${(index + 30) * TABLE_COUNT}`
        : `entity-${index * 2 + 1}`,
      weight: 1,
    })),
  };
}

function packedDisconnectedComponentGraph(): LayoutGraph {
  const entityCount = 1_201;
  return {
    table_nodes: [{ id: "table-0", display_name: "Table 0" }],
    entity_nodes: Array.from({ length: entityCount }, (_, index) => ({
      id: `packed-entity-${index}`,
      table_id: "table-0",
      class_name: null,
    })),
    table_edges: [],
    entity_edges: Array.from({ length: 30 }, (_, index) => ({
      id: `packed-component-${index}`,
      source: `packed-entity-${index * 2}`,
      target: `packed-entity-${index * 2 + 1}`,
      weight: 1,
    })),
  };
}

function packedCrossTableComponentGraph(): LayoutGraph {
  const entityCount = 1_202;
  return {
    table_nodes: [
      { id: "table-0", display_name: "MEProcess" },
      { id: "table-1", display_name: "MEOperation" },
    ],
    entity_nodes: Array.from({ length: entityCount }, (_, index) => ({
      id: `cross-table-entity-${index}`,
      table_id: `table-${index % 2}`,
      class_name: null,
    })),
    table_edges: [],
    entity_edges: Array.from({ length: 30 }, (_, index) => ({
      id: `cross-table-component-${index}`,
      source: `cross-table-entity-${index * 2}`,
      target: `cross-table-entity-${index * 2 + 1}`,
      weight: 1,
    })),
  };
}

function paddedBounds(
  nodes: readonly { x: number; y: number }[],
  padding: number,
) {
  return {
    left: Math.min(...nodes.map((node) => node.x)) - padding,
    right: Math.max(...nodes.map((node) => node.x)) + padding,
    top: Math.min(...nodes.map((node) => node.y)) - padding,
    bottom: Math.max(...nodes.map((node) => node.y)) + padding,
  };
}

function boundsOverlap(
  left: ReturnType<typeof paddedBounds>,
  right: ReturnType<typeof paddedBounds>,
) {
  return left.right > right.left && right.right > left.left &&
    left.bottom > right.top && right.bottom > left.top;
}

class ScalingLayoutWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;

  postMessage(message: {
    requestId: number;
    graph: LayoutGraph;
    viewport: { width: number; height: number };
    seedOffset?: number;
  }) {
    this.onmessage?.({
      data: {
        requestId: message.requestId,
        layout: computeNebulaLayout(
          message.graph,
          message.viewport,
          { seedOffset: message.seedOffset },
        ),
      },
    } as MessageEvent);
  }

  terminate() {}
}

function canvasContext(): CanvasRenderingContext2D {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: "",
    font: "",
    lineWidth: 1,
    strokeStyle: "",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

describe("7000-entity graph scaling", () => {
  beforeEach(() => {
    vi.stubGlobal("Worker", ScalingLayoutWorker);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext(),
    );
    vi.spyOn(
      HTMLCanvasElement.prototype,
      "getBoundingClientRect",
    ).mockReturnValue({
      x: 0,
      y: 0,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      top: 0,
      left: 0,
      bottom: VIEWPORT.height,
      right: VIEWPORT.width,
      toJSON: () => ({}),
    });
    act(() => {
      useAnalysisStore.setState({
        graph,
        phase: "done",
        analysisStatus: "complete",
        warnings: [],
        errorMessage: null,
        hoveredNodeId: null,
        selectedNodeId: null,
        confidenceThreshold: 0,
        fitViewRequest: 0,
        relayoutRequest: 0,
        focusNodeRequest: null,
        selectedEntityEdgeId: null,
        selectedTableEdgeId: null,
      });
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    act(() => useAnalysisStore.setState({ graph: null }));
  });

  it("keeps the organic overview bounded and omits entity labels", () => {
    const layout = computeNebulaLayout(
      {
        table_nodes: graph.table_nodes,
        entity_nodes: graph.entity_nodes,
        table_edges: graph.table_edges,
        entity_edges: graph.entity_edges.map((edge) => ({ ...edge, weight: 0.35 })),
      },
      VIEWPORT,
    );
    const scene = buildScene({
      graph,
      layout,
      transform: { k: 0.5, x: 0, y: 0 },
      confidenceThreshold: 0,
    });

    expect(layout.entityNodes).toHaveLength(ENTITY_COUNT);
    expect(layout.tableNodes.length).toBeLessThanOrEqual(10);
    expect(scene.entityLabels).toHaveLength(0);
    const tableRows = layout.tableNodes.map((table) => table.y);
    // Table markers follow their organic entity components instead of recreating
    // the retired single-row table lane.
    expect(Math.max(...tableRows) - Math.min(...tableRows)).toBeGreaterThan(
      ENTITY_COLLISION_RADIUS,
    );
    const stats = closePairStats(
      layout.entityNodes,
      ENTITY_COLLISION_RADIUS * 2,
    );
    expect(stats.closePairs).toBe(0);
    expect(stats.minimumObservedDistance).toBeGreaterThanOrEqual(
      ENTITY_COLLISION_RADIUS * 2,
    );
  });

  it("keeps fallback nodes collision-spaced across organic components", () => {
    const layout = computeFallbackScatterLayout(
      {
        table_nodes: graph.table_nodes,
        entity_nodes: graph.entity_nodes,
        table_edges: graph.table_edges,
        entity_edges: [],
      },
      VIEWPORT,
    );

    expect(
      closePairStats(
        layout.entityNodes,
        ENTITY_COLLISION_RADIUS * 2 - 2,
      ).closePairs,
    ).toBe(0);
  });

  it.each([
    ["nebula", computeNebulaLayout],
    ["fallback", computeFallbackScatterLayout],
  ])("preserves label spacing after separating mixed components in %s", (
    _label,
    computeLayout,
  ) => {
    const startedAt = performance.now();
    for (let seedOffset = 0; seedOffset < 5; seedOffset += 1) {
      const layout = computeLayout(
        mixedComponentGraph(false),
        VIEWPORT,
        { seedOffset },
      );
      const stats = closePairStats(
        layout.entityNodes,
        ENTITY_COLLISION_RADIUS * 2 - 2,
      );

      expect(stats.closePairs, `seed ${seedOffset}`).toBe(0);
      expect(
        stats.minimumObservedDistance,
        `seed ${seedOffset}`,
      ).toBeGreaterThanOrEqual(ENTITY_COLLISION_RADIUS * 2 - 2);
    }
    expect(performance.now() - startedAt).toBeLessThan(15_000);
  }, 20_000);

  it.each([
    ["nebula", computeNebulaLayout],
    ["fallback", computeFallbackScatterLayout],
  ])("lays out same-table mixed components without exhausting %s separation", (
    _label,
    computeLayout,
  ) => {
    const layout = computeLayout(mixedComponentGraph(true), VIEWPORT);
    const stats = closePairStats(
      layout.entityNodes,
      ENTITY_COLLISION_RADIUS * 2 - 2,
    );

    expect(stats.closePairs).toBe(0);
    expect(stats.minimumObservedDistance).toBeGreaterThanOrEqual(
      ENTITY_COLLISION_RADIUS * 2 - 2,
    );
  }, 10_000);

  it("keeps linked fallback components visible at minimum overview zoom", () => {
    const mixedGraph = mixedComponentGraph(false);
    const layout = computeFallbackScatterLayout(mixedGraph, VIEWPORT);
    const allPoints = [...layout.tableNodes, ...layout.entityNodes];
    const left = Math.min(...allPoints.map((point) => point.x));
    const right = Math.max(...allPoints.map((point) => point.x));
    const top = Math.min(...allPoints.map((point) => point.y));
    const bottom = Math.max(...allPoints.map((point) => point.y));
    const width = right - left;
    const height = bottom - top;
    const scale = Math.max(
      0.02,
      Math.min(
        2,
        (VIEWPORT.width - 96) / (width + 144),
        (VIEWPORT.height - 96) / (height + 144),
      ),
    );
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;
    const linkedNodeIds = new Set(
      mixedGraph.entity_edges.flatMap((edge) => [edge.source, edge.target]),
    );
    const visibleLinkedNodes = layout.entityNodes
      .filter((node) => linkedNodeIds.has(node.id))
      .filter((node) => {
        const screenX = VIEWPORT.width / 2 + (node.x - centerX) * scale;
        const screenY = VIEWPORT.height / 2 + (node.y - centerY) * scale;
        return screenX >= 48 && screenX <= VIEWPORT.width - 48 &&
          screenY >= 48 && screenY <= VIEWPORT.height - 48;
      });

    expect.soft(width).toBeLessThanOrEqual(43_056);
    expect.soft(height).toBeLessThanOrEqual(25_056);
    expect.soft(visibleLinkedNodes).toHaveLength(60);
  }, 10_000);

  it("keeps >1000 same-table components deterministic and compact", () => {
    const packedGraph = packedDisconnectedComponentGraph();
    const first = computeNebulaLayout(packedGraph, VIEWPORT);
    const second = computeNebulaLayout(packedGraph, VIEWPORT);
    const positions = new Map(
      first.entityNodes.map((node) => [node.id, node]),
    );
    for (const edge of packedGraph.entity_edges) {
      const source = positions.get(edge.source)!;
      const target = positions.get(edge.target)!;
      const memberDistance = Math.hypot(
        source.x - target.x,
        source.y - target.y,
      );

      expect(memberDistance).toBeGreaterThanOrEqual(
        ENTITY_COLLISION_RADIUS * 2,
      );
      expect(memberDistance).toBeLessThan(
        ENTITY_COLLISION_RADIUS * 2 + 1,
      );
    }
    expect(second).toEqual(first);
  }, 10_000);

  it("separates >1000 cross-table components without losing deterministic spacing", () => {
    const packedGraph = packedCrossTableComponentGraph();
    const first = computeNebulaLayout(packedGraph, VIEWPORT);
    const second = computeNebulaLayout(packedGraph, VIEWPORT);
    const positions = new Map(
      first.entityNodes.map((node) => [node.id, node]),
    );
    const componentBounds = packedGraph.entity_edges.map((edge) => {
      const source = positions.get(edge.source)!;
      const target = positions.get(edge.target)!;
      expect(source.tableId).not.toBe(target.tableId);
      expect(Math.hypot(source.x - target.x, source.y - target.y))
        .toBeGreaterThanOrEqual(ENTITY_COLLISION_RADIUS * 2);
      return paddedBounds(
        [source, target],
        ENTITY_COLLISION_RADIUS,
      );
    });

    for (let left = 0; left < componentBounds.length; left += 1) {
      for (let right = left + 1; right < componentBounds.length; right += 1) {
        expect(
          boundsOverlap(componentBounds[left], componentBounds[right]),
          `components ${left} and ${right}`,
        ).toBe(false);
      }
    }
    expect(second).toEqual(first);
  }, 10_000);

  it("renders through one canvas without per-entity DOM nodes", async () => {
    const { container } = render(createElement(GraphCanvas));

    await waitFor(() => {
      expect(container.querySelector("canvas")).toHaveAttribute(
        "data-scene-ready",
        "true",
      );
    });

    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(container.querySelectorAll("*").length).toBeLessThanOrEqual(10);
  });
});
