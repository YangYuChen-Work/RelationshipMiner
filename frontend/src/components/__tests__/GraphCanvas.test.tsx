import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as d3 from "d3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraphData } from "../../api/analysis";
import { computeGroupedLayout } from "../../graph/layout";
import { useAnalysisStore } from "../../store/analysis";
import GraphCanvas from "../GraphCanvas";

const graph: SemanticGraphData = {
  table_nodes: [
    { id: "accounts", display_name: "Accounts", entity_count: 2 },
    { id: "billing", display_name: "Billing", entity_count: 1 },
  ],
  entity_nodes: [
    { id: "a", table_id: "accounts", display_name: "Account A", class_name: "Account", dimensions: {} },
    { id: "b", table_id: "accounts", display_name: "Account B", class_name: "Account", dimensions: {} },
    { id: "invoice", table_id: "billing", display_name: "Invoice", class_name: "Invoice", dimensions: {} },
  ],
  table_edges: [{ id: "accounts--billing", source_table: "accounts", target_table: "billing", relation_types: ["owns"], strong_count: 1, weak_count: 0, entity_edge_count: 1, average_confidence: 0.9, supporting_entity_edges: ["a--invoice"] }],
  entity_edges: [{ id: "a--invoice", source: "a", target: "invoice", relations: [{ source: "a", target: "invoice", relation_type: "owns", direction: "source_to_target", strength: "strong", confidence: 0.9, explanation: "fixture", evidence: [], model_id: null, task_id: null }] }],
};

function canvasContext() {
  return {
    arc: vi.fn(), beginPath: vi.fn(), clearRect: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(), moveTo: vi.fn(), restore: vi.fn(), save: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
    fillStyle: "", font: "", lineWidth: 1, strokeStyle: "", textBaseline: "alphabetic" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
}

class LayoutWorker {
  static instances: LayoutWorker[] = [];
  static autoReply = true;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  terminate = vi.fn();
  readonly messages: {
    requestId: number;
    graph: SemanticGraphData;
    viewport: { width: number; height: number };
  }[] = [];
  constructor() {
    LayoutWorker.instances.push(this);
  }
  postMessage(message: { requestId: number; graph: SemanticGraphData; viewport: { width: number; height: number } }) {
    this.messages.push(message);
    if (LayoutWorker.autoReply) this.reply(message);
  }
  reply(message = this.messages.at(-1)!) {
    this.onmessage?.({ data: { requestId: message.requestId, layout: computeGroupedLayout(message.graph, message.viewport) } } as MessageEvent);
  }
}

function setGraph(next: SemanticGraphData | null = graph) {
  useAnalysisStore.setState({
    graph: next, phase: next ? "done" : "select", analysisStatus: next ? "complete" : null,
    warnings: [], errorMessage: null, hoveredNodeId: null, selectedNodeId: null,
    confidenceThreshold: 0, fitViewRequest: 0, relayoutRequest: 0, focusNodeRequest: null,
    selectedEntityEdgeId: null, selectedTableEdgeId: null,
  });
}

async function ready() {
  await waitFor(() => expect(screen.getByRole("img", { name: /语义关系图/ })).toHaveAttribute("data-layout-ready", "true"));
}

describe("GraphCanvas", () => {
  beforeEach(() => {
    LayoutWorker.instances = [];
    LayoutWorker.autoReply = true;
    vi.stubGlobal("Worker", LayoutWorker);
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(canvasContext());
    vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 960, height: 600, top: 0, left: 0, bottom: 600, right: 960, toJSON: () => ({}) });
    setGraph();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setGraph(null);
  });

  it("uses one canvas and no per-entity DOM for a 7000 entity graph", async () => {
    const entities = Array.from({ length: 7_000 }, (_, index) => ({ id: `entity-${index}`, table_id: "bulk", display_name: `Entity ${index}`, class_name: null, dimensions: {} }));
    setGraph({ table_nodes: [{ id: "bulk", display_name: "Bulk", entity_count: entities.length }], entity_nodes: entities, table_edges: [], entity_edges: [] });
    const { container } = render(<GraphCanvas />);
    await ready();
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(0);
    const canvas = container.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    vi.mocked(context.fillText).mockClear();
    fireEvent.wheel(canvas, {
      clientX: 480,
      clientY: 300,
      deltaY: -5_000,
    });
    await waitFor(() => expect(d3.zoomTransform(canvas).k).toBeGreaterThanOrEqual(1.2));
    expect(vi.mocked(context.fillText).mock.calls.length).toBeLessThanOrEqual(501);
    const transform = d3.zoomTransform(canvas);
    const visibleEntity = computeGroupedLayout(
      useAnalysisStore.getState().graph!,
      { width: 960, height: 600 },
    ).entityNodes.find((entity) => {
      const [x, y] = transform.apply([entity.x, entity.y]);
      return x >= 0 && x <= 960 && y >= 0 && y <= 600;
    })!;
    vi.mocked(context.fillText).mockClear();
    act(() => useAnalysisStore.getState().setSelectedNode(visibleEntity.id));
    expect(vi.mocked(context.fillText).mock.calls.flat()).toContain(
      visibleEntity.id.replace("entity-", "Entity "),
    );
  });

  it("renders empty, complete, partial, and failed analysis states", async () => {
    setGraph(null);
    const { rerender } = render(<GraphCanvas />);
    expect(screen.getByText("等待分析结果生成语义关系图。")).toBeInTheDocument();

    setGraph();
    rerender(<GraphCanvas />);
    await ready();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => useAnalysisStore.setState({ analysisStatus: "partial" }));
    expect(screen.getByRole("status")).toHaveTextContent("部分完成");

    act(() => useAnalysisStore.setState({ analysisStatus: "failed", phase: "error", errorMessage: "分析失败", warnings: ["仅返回可用关系"] }));
    expect(screen.getByRole("img", { name: /语义关系图/ })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("仅返回可用关系");
  });

  it("selects an entity through spatial pointer hit testing", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    const entity = computeGroupedLayout(graph, { width: 960, height: 600 }).entityNodes.find((node) => node.id === "a")!;
    const point = d3.zoomTransform(canvas).apply([entity.x, entity.y]);
    fireEvent.pointerMove(canvas, { clientX: point[0], clientY: point[1] });
    fireEvent.click(canvas, { clientX: point[0], clientY: point[1] });
    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
  });

  it("navigates and selects a visible entity using only the keyboard", async () => {
    const { container } = render(<GraphCanvas />);
    await ready();
    const canvas = container.querySelector("canvas")!;

    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent(
      "Account A",
    );
    fireEvent.keyDown(canvas, { key: "Enter" });

    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
  });

  it("focuses the current table target when Enter is pressed", async () => {
    const { container } = render(<GraphCanvas />);
    await ready();
    const canvas = container.querySelector("canvas") as HTMLCanvasElement & {
      __zoom: d3.ZoomTransform;
    };
    const displaced = d3.zoomIdentity.translate(800, 500).scale(2);
    canvas.__zoom = displaced;

    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "Enter" });

    const focused = d3.zoomTransform(canvas);
    const accounts = computeGroupedLayout(graph, {
      width: 960,
      height: 600,
    }).tableNodes.find((node) => node.id === "accounts")!;
    expect(focused).not.toEqual(displaced);
    expect(focused.apply([accounts.x, accounts.y])[0]).toBeCloseTo(480);
    expect(focused.apply([accounts.x, accounts.y])[1]).toBeCloseTo(300);
  });

  it("selects a table edge as the focus for its supporting entity relations", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    const edge = computeGroupedLayout(graph, { width: 960, height: 600 }).tableEdges[0];
    const transform = d3.zoomTransform(canvas);
    const point = transform.apply([(edge.from.x + edge.to.x) / 2, (edge.from.y + edge.to.y) / 2]);
    fireEvent.click(canvas, { clientX: point[0], clientY: point[1] });
    expect(useAnalysisStore.getState().selectedTableEdgeId).toBe("accounts--billing");
    expect(useAnalysisStore.getState().selectedEntityEdgeId).toBeNull();

    const supporting = computeGroupedLayout(graph, {
      width: 960,
      height: 600,
    }).entityEdges[0];
    const focused = d3.zoomTransform(canvas);
    const midpoint = focused.apply([
      (supporting.from.x + supporting.to.x) / 2,
      (supporting.from.y + supporting.to.y) / 2,
    ]);
    expect(focused).not.toEqual(transform);
    expect(midpoint[0]).toBeCloseTo(480);
    expect(midpoint[1]).toBeCloseTo(300);
  });

  it("selects a table edge with no supporting relations without moving the camera", async () => {
    const graphWithoutSupport = {
      ...graph,
      table_edges: graph.table_edges.map((edge) => ({
        ...edge,
        supporting_entity_edges: [],
      })),
    };
    setGraph(graphWithoutSupport);
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const edge = computeGroupedLayout(graphWithoutSupport, {
      width: 960,
      height: 600,
    }).tableEdges[0];
    const before = d3.zoomTransform(canvas);
    const point = before.apply([
      (edge.from.x + edge.to.x) / 2,
      (edge.from.y + edge.to.y) / 2,
    ]);

    fireEvent.click(canvas, { clientX: point[0], clientY: point[1] });

    expect(useAnalysisStore.getState().selectedTableEdgeId).toBe(edge.id);
    expect(d3.zoomTransform(canvas)).toEqual(before);
  });

  it("consumes fit and relayout commands through the canvas zoom transform", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ }) as HTMLCanvasElement & { __zoom: d3.ZoomTransform };
    const displaced = d3.zoomIdentity.translate(800, 500).scale(2);
    canvas.__zoom = displaced;

    act(() => useAnalysisStore.getState().requestFitView());
    expect(d3.zoomTransform(canvas)).not.toEqual(displaced);

    canvas.__zoom = displaced;
    act(() => useAnalysisStore.getState().requestRelayout());
    expect(d3.zoomTransform(canvas)).toEqual(d3.zoomIdentity);
  });

  it("uses DPR backing dimensions and coalesces rendering into one animation frame", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const request = vi.fn(() => 7);
    vi.stubGlobal("requestAnimationFrame", request);
    const { container } = render(<GraphCanvas />);
    await ready();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1200);
    expect(request.mock.calls.length).toBeGreaterThan(0);
  });

  it("keeps at most one RAF outstanding and schedules again after drawing", async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    const request = vi.fn((callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id: number) => callbacks.delete(id));
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = render(<GraphCanvas />);
    await ready();

    act(() => {
      useAnalysisStore.getState().setHoveredNode("a");
      useAnalysisStore.getState().setSelectedNode("a");
      useAnalysisStore.getState().setConfidenceThreshold(0.2);
    });
    expect(callbacks.size).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);

    const [firstId, firstCallback] = [...callbacks.entries()][0];
    callbacks.delete(firstId);
    act(() => firstCallback(16));
    expect(callbacks.size).toBe(0);

    act(() => useAnalysisStore.getState().setHoveredNode("b"));
    expect(request).toHaveBeenCalledTimes(2);
    expect(callbacks.size).toBe(1);
    const secondId = [...callbacks.keys()][0];
    unmount();
    expect(cancel).toHaveBeenCalledWith(secondId);
  });

  it("cleans up the active frame and worker when unmounted", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("requestAnimationFrame", () => 73);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = render(<GraphCanvas />);
    await ready();
    unmount();
    expect(cancel).toHaveBeenCalledWith(73);
  });

  it("owns an isolated worker so unmounting one canvas leaves its sibling alive", async () => {
    const first = render(<GraphCanvas />);
    const second = render(<GraphCanvas />);
    await waitFor(() => expect(LayoutWorker.instances).toHaveLength(2));

    first.unmount();
    expect(LayoutWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(LayoutWorker.instances[1].terminate).not.toHaveBeenCalled();

    second.unmount();
    expect(LayoutWorker.instances[1].terminate).toHaveBeenCalledOnce();
  });

  it("ignores an asynchronous layout response after unmount", async () => {
    LayoutWorker.autoReply = false;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<GraphCanvas />);
    await waitFor(() => expect(LayoutWorker.instances).toHaveLength(1));
    const worker = LayoutWorker.instances[0];
    const lateHandler = worker.onmessage;
    const message = worker.messages[0];

    unmount();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    lateHandler?.({
      data: {
        requestId: message.requestId,
        layout: computeGroupedLayout(message.graph, message.viewport),
      },
    } as MessageEvent);
    await act(async () => Promise.resolve());

    expect(
      consoleError.mock.calls.some(([message]) =>
        String(message).includes("unmounted component"),
      ),
    ).toBe(false);
  });
});
