import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as d3 from "d3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SemanticGraphData } from "../../api/analysis";
import { quadraticPoint } from "../../graph/edgeGeometry";
import { computeGroupedLayout } from "../../graph/layout";
import { buildScene } from "../../graph/scene";
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
    arc: vi.fn(), beginPath: vi.fn(), clearRect: vi.fn(), closePath: vi.fn(), fill: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), lineTo: vi.fn(), measureText: vi.fn((text: string) => ({ width: text.length * 7 })), moveTo: vi.fn(), quadraticCurveTo: vi.fn(), restore: vi.fn(), save: vi.fn(), setLineDash: vi.fn(), setTransform: vi.fn(), stroke: vi.fn(), strokeRect: vi.fn(),
    fillStyle: "", font: "", globalAlpha: 1, lineWidth: 1, strokeStyle: "", textAlign: "start" as CanvasTextAlign, textBaseline: "alphabetic" as CanvasTextBaseline,
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
    seedOffset?: number;
  }[] = [];
  constructor() {
    LayoutWorker.instances.push(this);
  }
  postMessage(message: { requestId: number; graph: SemanticGraphData; viewport: { width: number; height: number }; seedOffset?: number }) {
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
    confidenceThreshold: 0, showIsolatedNodes: false, fitViewRequest: 0, relayoutRequest: 0, focusNodeRequest: null,
    selectedEntityEdgeId: null, selectedTableEdgeId: null,
  });
}

async function ready() {
  await waitFor(() => expect(screen.getByRole("img", { name: /语义关系图/ })).toHaveAttribute("data-scene-ready", "true"));
}

function edgeMidpoint(
  canvas: Element,
  graph: SemanticGraphData,
  layout: ReturnType<typeof computeGroupedLayout>,
  edgeId: string,
  kind: "entity" | "table",
) {
  const transform = d3.zoomTransform(canvas);
  const scene = buildScene({
    graph,
    layout,
    transform,
    confidenceThreshold: useAnalysisStore.getState().confidenceThreshold,
  });
  const edge = (kind === "entity" ? scene.entityEdges : scene.tableEdges)
    .find((candidate) => candidate.id === edgeId);
  if (!edge) throw new Error(`expected ${kind} edge ${edgeId}`);
  return quadraticPoint(edge.geometry, 0.5);
}

function controlledFrames() {
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

  return {
    callbacks,
    request,
    cancel,
    async flushLatest() {
      await waitFor(() => expect(callbacks.size).toBe(1));
      const [id, callback] = [...callbacks.entries()][0];
      callbacks.delete(id);
      await act(async () => {
        callback(16);
        await Promise.resolve();
      });
    },
  };
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
    act(() => setGraph());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    act(() => setGraph(null));
  });

  it("shows a stable Canvas 2D fallback without marking the scene ready or retrying RAF forever", async () => {
    const frames = controlledFrames();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);

    render(<GraphCanvas />);
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    await waitFor(() =>
      expect(canvas).not.toHaveAttribute("data-scene-generation", "0"),
    );
    await frames.flushLatest();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "无法创建 Canvas 2D",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("浏览器不支持");
    expect(canvas).toHaveAttribute("data-scene-ready", "false");
    expect(canvas).toHaveAttribute("data-ready-generation", "");

    const requestsAfterFailure = frames.request.mock.calls.length;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(frames.request).toHaveBeenCalledTimes(requestsAfterFailure);
    expect(frames.callbacks.size).toBe(0);
  });

  it("retries the current scene after a Canvas 2D context becomes available", async () => {
    const frames = controlledFrames();
    const context = canvasContext();
    let availableContext: CanvasRenderingContext2D | null = null;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      () => availableContext,
    );

    render(<GraphCanvas />);
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    await waitFor(() =>
      expect(canvas).not.toHaveAttribute("data-scene-generation", "0"),
    );
    await frames.flushLatest();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "无法创建 Canvas 2D",
    );

    const failedGeneration = canvas.getAttribute("data-scene-generation");
    availableContext = context;
    fireEvent.click(screen.getByRole("button", { name: "重试画布" }));
    await waitFor(() =>
      expect(canvas).not.toHaveAttribute(
        "data-scene-generation",
        failedGeneration,
      ),
    );
    await frames.flushLatest();

    await waitFor(() =>
      expect(canvas).toHaveAttribute("data-scene-ready", "true"),
    );
    expect(screen.queryByText(/无法创建 Canvas 2D/)).not.toBeInTheDocument();
    expect(context.setTransform).toHaveBeenCalled();
  });

  it("recovers a missing Canvas 2D context through the existing relayout path", async () => {
    const frames = controlledFrames();
    const context = canvasContext();
    let availableContext: CanvasRenderingContext2D | null = null;
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(
      () => availableContext,
    );

    render(<GraphCanvas />);
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    await waitFor(() =>
      expect(canvas).not.toHaveAttribute("data-scene-generation", "0"),
    );
    await frames.flushLatest();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "无法创建 Canvas 2D",
    );

    const failedGeneration = canvas.getAttribute("data-scene-generation");
    availableContext = context;
    act(() => useAnalysisStore.getState().requestRelayout());
    await waitFor(() =>
      expect(canvas).not.toHaveAttribute(
        "data-scene-generation",
        failedGeneration,
      ),
    );
    await frames.flushLatest();

    await waitFor(() =>
      expect(canvas).toHaveAttribute("data-scene-ready", "true"),
    );
    expect(screen.queryByText(/无法创建 Canvas 2D/)).not.toBeInTheDocument();
  });

  it("does not expose interaction until the committed scene has drawn, then accepts the first click", async () => {
    LayoutWorker.autoReply = false;
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
    render(<GraphCanvas />);
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    await waitFor(() => expect(LayoutWorker.instances[0]?.messages).toHaveLength(1));

    await act(async () => {
      LayoutWorker.instances[0].reply();
      await Promise.resolve();
    });
    expect(canvas).toHaveAttribute("data-scene-ready", "false");

    const entity = computeGroupedLayout(graph, { width: 960, height: 600 })
      .entityNodes.find((node) => node.id === "a")!;
    const readyPoint = d3.zoomTransform(canvas).apply([entity.x, entity.y]);
    fireEvent.click(canvas, { clientX: readyPoint[0], clientY: readyPoint[1] });
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();

    act(() => {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id);
        callback(16);
      }
    });
    expect(canvas).toHaveAttribute("data-scene-ready", "true");
    const firstInteractivePoint = d3.zoomTransform(canvas).apply([entity.x, entity.y]);
    fireEvent.click(canvas, { clientX: firstInteractivePoint[0], clientY: firstInteractivePoint[1] });
    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
  });

  it("builds the first drawable scene with the final auto-fit transform", async () => {
    LayoutWorker.autoReply = false;
    const context = canvasContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    const observedDrawTransforms: d3.ZoomTransform[] = [];
    let canvas: HTMLCanvasElement;
    vi.mocked(context.arc).mockImplementation(() => {
      observedDrawTransforms.push(d3.zoomTransform(canvas));
    });
    render(<GraphCanvas />);
    canvas = screen.getByRole("img", { name: /语义关系图/ });
    await waitFor(() => expect(LayoutWorker.instances[0]?.messages).toHaveLength(1));

    await act(async () => {
      LayoutWorker.instances[0].reply();
      await Promise.resolve();
    });
    await ready();

    const fitted = d3.zoomTransform(canvas);
    expect(fitted).not.toEqual(d3.zoomIdentity);
    expect(observedDrawTransforms[0]).toEqual(fitted);
    await act(async () => Promise.resolve());
    expect(d3.zoomTransform(canvas)).toEqual(fitted);
  });

  it("lets only the latest fit or zoom generation become ready", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();
    const callbacks = new Map<number, FrameRequestCallback>();
    const cancelled = new Set<number>();
    let nextFrame = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextFrame;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => cancelled.add(id));

    act(() => useAnalysisStore.getState().requestFitView());
    const firstGeneration = canvas.getAttribute("data-scene-generation");
    const firstFrame = callbacks.get(1)!;
    fireEvent.wheel(canvas, {
      clientX: 480,
      clientY: 300,
      deltaY: -500,
    });
    const latestGeneration = canvas.getAttribute("data-scene-generation");

    expect(Number(latestGeneration)).toBeGreaterThan(Number(firstGeneration));
    expect(cancelled).toContain(1);
    expect(callbacks.size).toBe(2);
    expect(canvas).toHaveAttribute("data-scene-ready", "false");

    act(() => firstFrame(16));
    expect(canvas).toHaveAttribute("data-scene-ready", "false");
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();
    act(() => callbacks.get(2)!(32));
    expect(canvas).toHaveAttribute("data-scene-ready", "true");
    expect(canvas).toHaveAttribute("data-ready-generation", latestGeneration);
    fireEvent.keyDown(canvas, { key: "Enter" });
    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
  });

  it("keeps worker layout stable while projection changes counts and search", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const firstWorker = LayoutWorker.instances[0];

    expect(firstWorker.messages[0].graph.entity_nodes.map((node) => node.id)).toEqual([
      "a",
      "b",
      "invoice",
    ]);
    expect(firstWorker.messages[0].graph.entity_nodes).toEqual([
      { id: "a", table_id: "accounts", class_name: "Account" },
      { id: "b", table_id: "accounts", class_name: "Account" },
      { id: "invoice", table_id: "billing", class_name: "Invoice" },
    ]);
    expect(firstWorker.messages[0].graph.table_edges).toEqual([
      {
        id: "accounts--billing",
        source_table: "accounts",
        target_table: "billing",
      },
    ]);
    expect(firstWorker.messages[0].graph.entity_edges).toEqual([
      { id: "a--invoice", source: "a", target: "invoice", weight: 1 },
    ]);
    expect(canvas.getAttribute("aria-label")).toContain("2 个实体");
    const search = screen.getByRole("searchbox", { name: /查找实体/ });
    fireEvent.change(search, { target: { value: "b" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();

    act(() => useAnalysisStore.getState().setShowIsolatedNodes(true));
    await ready();

    expect(firstWorker.messages).toHaveLength(1);
    expect(canvas.getAttribute("aria-label")).toContain("3 个实体");
    fireEvent.keyDown(search, { key: "Enter" });
    expect(useAnalysisStore.getState().selectedNodeId).toBe("b");
  });

  it("coalesces resize bursts behind one in-flight compact worker request", async () => {
    LayoutWorker.autoReply = false;
    let size = { width: 960, height: 600 };
    let notifyResize: ResizeObserverCallback = () => undefined;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        top: 0,
        left: 0,
        bottom: size.height,
        right: size.width,
        toJSON: () => ({}),
      }),
    );
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = callback;
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    });

    render(<GraphCanvas />);
    const worker = LayoutWorker.instances[0];
    await waitFor(() => expect(worker.messages).toHaveLength(1));

    for (const next of [
      { width: 1_000, height: 620 },
      { width: 1_100, height: 650 },
      { width: 1_200, height: 700 },
    ]) {
      size = next;
      await act(async () => {
        notifyResize([], {} as ResizeObserver);
        await Promise.resolve();
      });
    }

    expect(worker.messages).toHaveLength(1);
    act(() => worker.reply(worker.messages[0]));
    await waitFor(() => expect(worker.messages).toHaveLength(2));
    expect(worker.messages[1].viewport).toEqual({
      width: 1_200,
      height: 700,
    });
    act(() => worker.reply(worker.messages[1]));
    await ready();
  });

  it("draws long edge labels with the same maximum width used for collision bounds", async () => {
    const longType = `relation-${"semantic-".repeat(100)}`;
    const longGraph: SemanticGraphData = {
      ...graph,
      table_edges: [{
        ...graph.table_edges[0],
        relation_types: [longType],
      }],
      entity_edges: [{
        ...graph.entity_edges[0],
        relations: [{
          ...graph.entity_edges[0].relations[0],
          relation_type: longType,
        }],
      }],
    };
    act(() => setGraph(longGraph));

    render(<GraphCanvas />);
    await ready();
    const context = document.querySelector("canvas")!.getContext("2d")!;
    const labelCall = vi.mocked(context.fillText).mock.calls.find(
      ([text]) => text === longType,
    );

    expect(labelCall).toEqual([
      longType,
      expect.any(Number),
      expect.any(Number),
      344,
    ]);
  });

  it("draws aggregate table relation labels at fitted overview zoom", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    vi.mocked(context.fillText).mockClear();

    fireEvent.wheel(canvas, {
      clientX: 480,
      clientY: 300,
      deltaY: 5_000,
    });

    expect(d3.zoomTransform(canvas).k).toBe(0.02);
    expect(vi.mocked(context.fillText).mock.calls.flat()).toContain("owns");
    expect(vi.mocked(context.fillText).mock.calls.flat()).toContain("Account A");
  });

  it("fits every opted-in entity in a 7000-node radial layout inside the viewport", async () => {
    const entities = Array.from({ length: 7_000 }, (_, index) => ({
      id: `entity-${index}`,
      table_id: "bulk",
      display_name: `Entity ${index}`,
      class_name: null,
      dimensions: {},
    }));
    const largeGraph: SemanticGraphData = {
      table_nodes: [{
        id: "bulk",
        display_name: "Bulk",
        entity_count: entities.length,
      }],
      entity_nodes: entities,
      table_edges: [],
      entity_edges: [],
    };
    act(() => {
      setGraph(largeGraph);
      useAnalysisStore.getState().setShowIsolatedNodes(true);
    });

    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const transform = d3.zoomTransform(canvas);
    const layout = computeGroupedLayout(largeGraph, { width: 960, height: 600 });
    const screenPoints = [...layout.tableNodes, ...layout.entityNodes]
      .map((point) => transform.apply([point.x, point.y]));

    expect(transform.k).toBeLessThan(0.25);
    expect(Math.min(...screenPoints.map(([x]) => x))).toBeGreaterThanOrEqual(48);
    expect(Math.max(...screenPoints.map(([x]) => x))).toBeLessThanOrEqual(912);
    expect(Math.min(...screenPoints.map(([, y]) => y))).toBeGreaterThanOrEqual(48);
    expect(Math.max(...screenPoints.map(([, y]) => y))).toBeLessThanOrEqual(552);
  });

  it("uses one canvas and no per-entity DOM for a 7000 entity graph", async () => {
    const entities = Array.from({ length: 7_000 }, (_, index) => ({ id: `entity-${index}`, table_id: "bulk", display_name: `Entity ${index}`, class_name: null, dimensions: {} }));
    act(() => {
      setGraph({ table_nodes: [{ id: "bulk", display_name: "Bulk", entity_count: entities.length }], entity_nodes: entities, table_edges: [], entity_edges: [] });
      useAnalysisStore.getState().setShowIsolatedNodes(true);
    });
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

    const search = screen.getByRole("searchbox", { name: "查找实体" });
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "entity-6999" } });
    fireEvent.keyDown(search, { key: "Enter" });

    expect(useAnalysisStore.getState().selectedNodeId).toBe("entity-6999");
    const remote = computeGroupedLayout(
      useAnalysisStore.getState().graph!,
      { width: 960, height: 600 },
    ).entityNodes.find((entity) => entity.id === "entity-6999")!;
    const searchTransform = d3.zoomTransform(canvas);
    expect(searchTransform.k).toBeGreaterThanOrEqual(1.2);
    expect(searchTransform.apply([remote.x, remote.y])[0]).toBeCloseTo(480);
    expect(searchTransform.apply([remote.x, remote.y])[1]).toBeCloseTo(300);
    expect(container.querySelectorAll("[data-node-id]")).toHaveLength(0);
    expect(container.querySelectorAll("[aria-live='polite']")).toHaveLength(1);
    fireEvent.change(search, { target: { value: "missing-entity" } });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent(
      "未找到实体",
    );
  });

  it("renders empty, complete, partial, and failed analysis states", async () => {
    act(() => setGraph(null));
    const { rerender } = render(<GraphCanvas />);
    expect(screen.getByText("等待分析结果生成语义关系图。")).toBeInTheDocument();

    act(() => setGraph());
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
    act(() => useAnalysisStore.setState({
      selectedEntityEdgeId: "a--invoice",
      selectedTableEdgeId: null,
    }));
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    const entity = computeGroupedLayout(graph, { width: 960, height: 600 }).entityNodes.find((node) => node.id === "a")!;
    const point = d3.zoomTransform(canvas).apply([entity.x, entity.y]);
    fireEvent.pointerMove(canvas, { clientX: point[0], clientY: point[1] });
    fireEvent.click(canvas, { clientX: point[0], clientY: point[1] });
    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
    expect(useAnalysisStore.getState().selectedEntityEdgeId).toBeNull();
    expect(useAnalysisStore.getState().selectedTableEdgeId).toBeNull();
  });

  it("selects an entity edge through the real canvas and clears node selection", async () => {
    act(() => useAnalysisStore.setState({ selectedNodeId: "b" }));
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    const layout = computeGroupedLayout(graph, {
      width: 960,
      height: 600,
    });
    const point = edgeMidpoint(canvas, graph, layout, "a--invoice", "entity");

    fireEvent.click(canvas, { clientX: point.x, clientY: point.y });

    expect(useAnalysisStore.getState().selectedEntityEdgeId).toBe("a--invoice");
    expect(useAnalysisStore.getState().selectedTableEdgeId).toBeNull();
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();
  });

  it("navigates and selects a visible entity using only the keyboard", async () => {
    const { container } = render(<GraphCanvas />);
    await ready();
    const canvas = container.querySelector("canvas")!;

    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent(
      "Account A",
    );
    fireEvent.keyDown(canvas, { key: "Enter" });

    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
  });

  it("navigates from table-only zoom to an entity and reveals it before selection", async () => {
    const { container } = render(<GraphCanvas />);
    await ready();
    const canvas = container.querySelector("canvas")!;
    fireEvent.wheel(canvas, {
      clientX: 480,
      clientY: 300,
      deltaY: 5_000,
    });
    expect(d3.zoomTransform(canvas).k).toBe(0.02);

    fireEvent.focus(canvas);
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    expect(container.querySelector("[aria-live='polite']")).toHaveTextContent(
      "Account A",
    );
    expect(d3.zoomTransform(canvas).k).toBeGreaterThanOrEqual(1.2);
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
    const billing = computeGroupedLayout(graph, {
      width: 960,
      height: 600,
    }).tableNodes.find((node) => node.id === "billing")!;
    expect(focused).not.toEqual(displaced);
    expect(focused.apply([billing.x, billing.y])[0]).toBeCloseTo(480);
    expect(focused.apply([billing.x, billing.y])[1]).toBeCloseTo(300);
  });

  it("selects a table edge as the focus for its supporting entity relations", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = screen.getByRole("img", { name: /语义关系图/ });
    const layout = computeGroupedLayout(graph, { width: 960, height: 600 });
    const edge = layout.tableEdges[0];
    const transform = d3.zoomTransform(canvas);
    const point = edgeMidpoint(canvas, graph, layout, edge.id, "table");
    fireEvent.click(canvas, { clientX: point.x, clientY: point.y });
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

  it("focuses a mixed table edge using only supporting relations visible at the threshold", async () => {
    const weakEdge = {
      id: "b--invoice",
      source: "b",
      target: "invoice",
      relations: [{
        source: "b",
        target: "invoice",
        relation_type: "suggests",
        direction: "source_to_target" as const,
        strength: "weak" as const,
        confidence: 0.2,
        explanation: "below threshold",
        evidence: [],
        model_id: null,
        task_id: null,
      }],
    };
    const mixedGraph: SemanticGraphData = {
      ...graph,
      table_edges: [{
        ...graph.table_edges[0],
        relation_types: ["owns", "suggests"],
        weak_count: 1,
        entity_edge_count: 2,
        supporting_entity_edges: ["a--invoice", weakEdge.id],
      }],
      entity_edges: [...graph.entity_edges, weakEdge],
    };
    act(() => {
      setGraph(mixedGraph);
      useAnalysisStore.getState().setConfidenceThreshold(0.8);
    });
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const layout = computeGroupedLayout(mixedGraph, { width: 960, height: 600 });
    const tableEdge = layout.tableEdges[0];
    const tablePoint = edgeMidpoint(canvas, mixedGraph, layout, tableEdge.id, "table");

    fireEvent.click(canvas, { clientX: tablePoint.x, clientY: tablePoint.y });

    expect(useAnalysisStore.getState().selectedTableEdgeId).toBe(tableEdge.id);
    const strongEdge = layout.entityEdges.find((edge) => edge.id === "a--invoice")!;
    const focusedMidpoint = d3.zoomTransform(canvas).apply([
      (strongEdge.from.x + strongEdge.to.x) / 2,
      (strongEdge.from.y + strongEdge.to.y) / 2,
    ]);
    expect(focusedMidpoint[0]).toBeCloseTo(480);
    expect(focusedMidpoint[1]).toBeCloseTo(300);
  });

  it("selects a table edge with no supporting relations without moving the camera", async () => {
    const graphWithoutSupport = {
      ...graph,
      table_edges: graph.table_edges.map((edge) => ({
        ...edge,
        supporting_entity_edges: [],
      })),
    };
    act(() => setGraph(graphWithoutSupport));
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const layout = computeGroupedLayout(graphWithoutSupport, {
      width: 960,
      height: 600,
    });
    const edge = layout.tableEdges[0];
    const before = d3.zoomTransform(canvas);
    const point = edgeMidpoint(canvas, graphWithoutSupport, layout, edge.id, "table");

    fireEvent.click(canvas, { clientX: point.x, clientY: point.y });

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
    const request = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 7;
    });
    vi.stubGlobal("requestAnimationFrame", request);
    const { container } = render(<GraphCanvas />);
    await ready();
    const canvas = container.querySelector("canvas")!;
    expect(canvas.width).toBe(1920);
    expect(canvas.height).toBe(1200);
    expect(request.mock.calls.length).toBeGreaterThan(0);
  });

  it("keeps at most one RAF outstanding and schedules again after drawing", async () => {
    const { unmount } = render(<GraphCanvas />);
    await ready();
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

    act(() => {
      useAnalysisStore.getState().setHoveredNode("a");
      useAnalysisStore.getState().setSelectedNode("a");
      useAnalysisStore.getState().setConfidenceThreshold(0.2);
    });
    expect(callbacks.size).toBe(1);
    expect(request).toHaveBeenCalledTimes(2);

    const [firstId, firstCallback] = [...callbacks.entries()][0];
    callbacks.delete(firstId);
    act(() => firstCallback(16));
    expect(callbacks.size).toBe(0);

    act(() => useAnalysisStore.getState().setHoveredNode("b"));
    expect(request).toHaveBeenCalledTimes(3);
    expect(callbacks.size).toBe(1);
    const secondId = [...callbacks.keys()][0];
    unmount();
    expect(cancel).toHaveBeenCalledWith(secondId);
  });

  it("cleans up the active frame and worker when unmounted", async () => {
    const cancel = vi.fn();
    const request = vi.fn(() => 73);
    vi.stubGlobal("requestAnimationFrame", request);
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const { unmount } = render(<GraphCanvas />);
    await waitFor(() => expect(request).toHaveBeenCalled());
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

  it("draws meaningful presentation labels when backend display names are zero", async () => {
    const context = canvasContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    act(() => setGraph({
      ...graph,
      table_nodes: graph.table_nodes.map((table) => ({
        ...table,
        display_name: "0",
      })),
      entity_nodes: graph.entity_nodes.map((entity) => ({
        ...entity,
        display_name: "0",
      })),
    }));

    render(<GraphCanvas />);
    await ready();

    const text = vi.mocked(context.fillText).mock.calls.map(([value]) => value);
    expect(text).toContain("a");
    expect(text.some((value) => value !== "0" && value.trim().length > 0)).toBe(true);
  });

  it("redraws one-hop focus on hover and restores default opacity on pointer leave", async () => {
    const context = canvasContext();
    const drawnAlphas: number[] = [];
    vi.mocked(context.fill).mockImplementation(() => {
      drawnAlphas.push(context.globalAlpha);
    });
    vi.mocked(context.stroke).mockImplementation(() => {
      drawnAlphas.push(context.globalAlpha);
    });
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const entity = computeGroupedLayout(graph, { width: 960, height: 600 })
      .entityNodes.find((node) => node.id === "a")!;
    const point = d3.zoomTransform(canvas).apply([entity.x, entity.y]);

    drawnAlphas.length = 0;
    fireEvent.pointerMove(canvas, { clientX: point[0], clientY: point[1] });
    expect(drawnAlphas).toContain(0.16);
    expect(drawnAlphas).toContain(0.06);

    drawnAlphas.length = 0;
    fireEvent.pointerLeave(canvas);
    expect(drawnAlphas).not.toContain(0.16);
    expect(drawnAlphas).toContain(1);
    expect(useAnalysisStore.getState().hoveredNodeId).toBeNull();
  });

  it("rebuilds threshold styling without asking the Worker for a new layout", async () => {
    render(<GraphCanvas />);
    await ready();
    const worker = LayoutWorker.instances[0];

    act(() => useAnalysisStore.getState().setConfidenceThreshold(0.5));
    await ready();

    expect(worker.messages).toHaveLength(1);
  });

  it("forwards the incremented relayout seed to the Worker", async () => {
    render(<GraphCanvas />);
    await ready();
    const worker = LayoutWorker.instances[0];

    act(() => useAnalysisStore.getState().requestRelayout());
    await ready();

    expect(worker.messages).toHaveLength(2);
    expect(worker.messages[0].seedOffset).toBe(0);
    expect(worker.messages[1].seedOffset).toBe(1);
  });

  it("pins a dragged node in scene coordinates without requesting layout and suppresses its click", async () => {
    const context = canvasContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(canvas, {
      setPointerCapture: { value: setPointerCapture },
      releasePointerCapture: { value: releasePointerCapture },
      hasPointerCapture: { value: () => true },
    });
    const worker = LayoutWorker.instances[0];
    const node = computeGroupedLayout(graph, { width: 960, height: 600 })
      .entityNodes.find((entity) => entity.id === "a")!;
    const start = d3.zoomTransform(canvas).apply([node.x, node.y]);
    const target = [start[0] + 80, start[1] + 45];
    vi.mocked(context.arc).mockClear();

    fireEvent.pointerDown(canvas, {
      pointerId: 7,
      clientX: start[0],
      clientY: start[1],
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 7,
      clientX: target[0],
      clientY: target[1],
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 7,
      clientX: target[0],
      clientY: target[1],
    });
    fireEvent.click(canvas, { clientX: target[0], clientY: target[1] });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    expect(worker.messages).toHaveLength(1);
    expect(vi.mocked(context.arc).mock.calls.some(
      ([x, y]) => Math.abs(x - target[0]) < 1 && Math.abs(y - target[1]) < 1,
    )).toBe(true);
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();
  });

  it("cancels a node drag without suppressing the next click", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });
    const node = computeGroupedLayout(graph, { width: 960, height: 600 })
      .entityNodes.find((entity) => entity.id === "a")!;
    const start = d3.zoomTransform(canvas).apply([node.x, node.y]);

    fireEvent.pointerDown(canvas, {
      pointerId: 21,
      clientX: start[0],
      clientY: start[1],
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: start[0] + 80,
      clientY: start[1] + 45,
      buttons: 1,
    });
    fireEvent.pointerCancel(canvas, {
      pointerId: 21,
      clientX: start[0] + 80,
      clientY: start[1] + 45,
    });
    fireEvent.click(canvas, { clientX: start[0], clientY: start[1] });

    expect(useAnalysisStore.getState().selectedNodeId).toBe("a");
  });

  it("restores hover and click interaction when pointer capture is lost", async () => {
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => false },
    });
    const layout = computeGroupedLayout(graph, { width: 960, height: 600 });
    const source = layout.entityNodes.find((entity) => entity.id === "a")!;
    const target = layout.entityNodes.find((entity) => entity.id === "invoice")!;
    const sourcePoint = d3.zoomTransform(canvas).apply([source.x, source.y]);
    const targetPoint = d3.zoomTransform(canvas).apply([target.x, target.y]);

    fireEvent.pointerDown(canvas, {
      pointerId: 22,
      clientX: sourcePoint[0],
      clientY: sourcePoint[1],
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 22,
      clientX: sourcePoint[0] + 30,
      clientY: sourcePoint[1] + 20,
      buttons: 1,
    });
    fireEvent.lostPointerCapture(canvas, { pointerId: 22 });
    fireEvent.pointerMove(canvas, {
      pointerId: 22,
      clientX: targetPoint[0],
      clientY: targetPoint[1],
    });
    fireEvent.click(canvas, {
      clientX: targetPoint[0],
      clientY: targetPoint[1],
    });

    expect(useAnalysisStore.getState().hoveredNodeId).toBe("invoice");
    expect(useAnalysisStore.getState().selectedNodeId).toBe("invoice");
  });

  it("keeps 7000-node pointer moves bounded and commits the scene once on release", async () => {
    const entities = Array.from({ length: 7_000 }, (_, index) => ({
      id: `entity-${index}`,
      table_id: "bulk",
      display_name: `Entity ${index}`,
      class_name: null,
      dimensions: {},
    }));
    const largeGraph: SemanticGraphData = {
      table_nodes: [{
        id: "bulk",
        display_name: "Bulk",
        entity_count: entities.length,
      }],
      entity_nodes: entities,
      table_edges: [],
      entity_edges: [],
    };
    act(() => {
      setGraph(largeGraph);
      useAnalysisStore.getState().setShowIsolatedNodes(true);
    });
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });
    const node = computeGroupedLayout(largeGraph, { width: 960, height: 600 })
      .entityNodes[0];
    const start = d3.zoomTransform(canvas).apply([node.x, node.y]);
    const frames = controlledFrames();
    const generation = Number(canvas.getAttribute("data-scene-generation"));

    fireEvent.pointerDown(canvas, {
      pointerId: 23,
      clientX: start[0],
      clientY: start[1],
      button: 0,
    });
    const startedAt = performance.now();
    for (let index = 1; index <= 8; index += 1) {
      fireEvent.pointerMove(canvas, {
        pointerId: 23,
        clientX: start[0] + index * 5,
        clientY: start[1] + index * 3,
        buttons: 1,
      });
    }
    const elapsed = performance.now() - startedAt;

    expect(elapsed).toBeLessThan(80);
    expect(Number(canvas.getAttribute("data-scene-generation"))).toBe(generation);
    expect(frames.callbacks.size).toBe(1);

    fireEvent.pointerUp(canvas, {
      pointerId: 23,
      clientX: start[0] + 40,
      clientY: start[1] + 24,
    });
    expect(Number(canvas.getAttribute("data-scene-generation"))).toBe(
      generation + 1,
    );
  });

  it("clears pinned node overrides when relayout starts", async () => {
    const context = canvasContext();
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(context);
    render(<GraphCanvas />);
    await ready();
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      setPointerCapture: { value: vi.fn() },
      releasePointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: () => true },
    });
    const node = computeGroupedLayout(graph, { width: 960, height: 600 })
      .entityNodes.find((entity) => entity.id === "a")!;
    const start = d3.zoomTransform(canvas).apply([node.x, node.y]);
    fireEvent.pointerDown(canvas, {
      pointerId: 9,
      clientX: start[0],
      clientY: start[1],
      button: 0,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 9,
      clientX: start[0] + 80,
      clientY: start[1] + 45,
      buttons: 1,
    });
    fireEvent.pointerUp(canvas, {
      pointerId: 9,
      clientX: start[0] + 80,
      clientY: start[1] + 45,
    });

    act(() => useAnalysisStore.getState().requestRelayout());
    await ready();
    vi.mocked(context.arc).mockClear();
    act(() => useAnalysisStore.getState().setHoveredNode("a"));

    const restored = d3.zoomTransform(canvas).apply([node.x, node.y]);
    expect(vi.mocked(context.arc).mock.calls.some(
      ([x, y]) => Math.abs(x - restored[0]) < 1 && Math.abs(y - restored[1]) < 1,
    )).toBe(true);
  });
});
