import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as d3 from "d3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphData } from "../../api/analysis";
import { useAnalysisStore } from "../../store/analysis";
import GraphCanvas from "../GraphCanvas";

const connectedGraph: GraphData = {
  nodes: [
    {
      id: "a",
      source_table: "accounts",
      class_name: "com.example.Account",
      field_values: {},
      degree: 1,
    },
    {
      id: "b",
      source_table: "billing",
      class_name: "com.example.Invoice",
      field_values: {},
      degree: 2,
    },
    {
      id: "c",
      source_table: "catalog",
      class_name: null,
      field_values: {},
      degree: 1,
    },
  ],
  edges: [
    {
      source: "a",
      target: "b",
      labels: ["owns"],
      confidence: 0.9,
    },
    {
      source: "b",
      target: "c",
      labels: ["references"],
      confidence: 0.6,
    },
  ],
};

const disconnectedGraph: GraphData = {
  nodes: [
    {
      id: "z-1",
      source_table: "zeta",
      class_name: "Zeta",
      field_values: {},
      degree: 0,
    },
    {
      id: "a-1",
      source_table: "alpha",
      class_name: "Alpha",
      field_values: {},
      degree: 0,
    },
    {
      id: "a-2",
      source_table: "alpha",
      class_name: null,
      field_values: {},
      degree: 0,
    },
  ],
  edges: [],
};

function setGraph(graph: GraphData) {
  useAnalysisStore.setState({
    graph,
    hoveredNodeId: null,
    selectedNodeId: null,
    confidenceThreshold: 0,
    fitViewRequest: 0,
    relayoutRequest: 0,
    focusNodeRequest: null,
  });
}

describe("GraphCanvas", () => {
  beforeEach(() => {
    setGraph(connectedGraph);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    useAnalysisStore.setState({ graph: null });
  });

  it("renders readable entity cards and backed edge labels", () => {
    const { container } = render(<GraphCanvas />);

    const cards = screen.getAllByRole("button");
    expect(cards).toHaveLength(3);

    const accountCard = container.querySelector<SVGGElement>(
      '[data-node-id="a"]',
    );
    expect(accountCard).not.toBeNull();
    expect(accountCard!.querySelector("rect")).toHaveAttribute("width", "168");
    expect(accountCard!.querySelector("rect")).toHaveAttribute("height", "64");
    expect(accountCard).toHaveTextContent("accounts");
    expect(accountCard).toHaveTextContent("Account");
    expect(accountCard).toHaveTextContent("1");

    expect(container.querySelector(".edge-label rect")).not.toBeNull();
    expect(container.querySelector(".edge-label text")).toHaveTextContent("owns");
  });

  it("scopes SVG definition IDs to each canvas instance", () => {
    // This fails if two canvases share grid or marker IDs and one SVG resolves URLs from the other.
    const { container } = render(
      <>
        <GraphCanvas />
        <GraphCanvas />
      </>,
    );

    const gridIds = [
      ...container.querySelectorAll<SVGPatternElement>("pattern[id]"),
    ].map((pattern) => pattern.id);
    const markerIds = [
      ...container.querySelectorAll<SVGMarkerElement>("marker[id]"),
    ].map((marker) => marker.id);

    expect(new Set(gridIds).size).toBe(2);
    expect(new Set(markerIds).size).toBe(4);
    expect(
      [...container.querySelectorAll<SVGLineElement>("[data-edge-id]")].every(
        (edge) => markerIds.includes(edge.getAttribute("marker-end")?.slice(5, -1) ?? ""),
      ),
    ).toBe(true);
  });

  it("keeps interactive cards exposed and reports their pressed state", () => {
    const { container } = render(<GraphCanvas />);
    const canvas = screen.getByRole("group", {
      name: "3 个实体，2 条可见关系",
    });
    const account = container.querySelector<SVGGElement>(
      '[data-node-id="a"]',
    )!;

    expect(canvas).toContainElement(account);
    expect(account).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(account);

    expect(account).toHaveAttribute("aria-pressed", "true");
  });

  it("exposes complete long identities in accessible names and tooltips", () => {
    const firstId = "entity-with-a-shared-long-prefix-0000000000000001";
    const secondId = "entity-with-a-shared-long-prefix-0000000000000002";
    setGraph({
      nodes: [
        {
          id: firstId,
          source_table: "entities",
          class_name: null,
          field_values: {},
          degree: 0,
        },
        {
          id: secondId,
          source_table: "entities",
          class_name: null,
          field_values: {},
          degree: 0,
        },
      ],
      edges: [],
    });
    const { container } = render(<GraphCanvas />);
    const firstCard = container.querySelector<SVGGElement>(
      `[data-node-id="${firstId}"]`,
    )!;
    const secondCard = container.querySelector<SVGGElement>(
      `[data-node-id="${secondId}"]`,
    )!;

    expect(firstCard.getAttribute("aria-label")).toContain(firstId);
    expect(secondCard.getAttribute("aria-label")).toContain(secondId);
    expect(firstCard.querySelector("title")).toHaveTextContent(firstId);
    expect(secondCard.querySelector("title")).toHaveTextContent(secondId);
  });

  it("selects cards from the keyboard and clears selection on canvas click", () => {
    const { container } = render(<GraphCanvas />);
    const invoice = container.querySelector<SVGGElement>(
      '[data-node-id="b"]',
    )!;

    fireEvent.keyDown(invoice, { key: "Enter" });
    expect(useAnalysisStore.getState().selectedNodeId).toBe("b");

    fireEvent.click(container.querySelector("svg")!);
    expect(useAnalysisStore.getState().selectedNodeId).toBeNull();
  });

  it("dims nodes beyond the hovered card's direct neighbors", () => {
    const { container } = render(<GraphCanvas />);
    const account = container.querySelector<SVGGElement>(
      '[data-node-id="a"]',
    )!;
    const directNeighbor = container.querySelector<SVGGElement>(
      '[data-node-id="b"]',
    )!;
    const secondHop = container.querySelector<SVGGElement>(
      '[data-node-id="c"]',
    )!;

    fireEvent.mouseEnter(account);

    expect(directNeighbor).toHaveAttribute("opacity", "1");
    expect(secondHop).toHaveAttribute("opacity", "0.18");
  });

  it("hides both an edge and its label below the confidence threshold", () => {
    const { container } = render(<GraphCanvas />);

    act(() => {
      useAnalysisStore.getState().setConfidenceThreshold(0.7);
    });

    expect(
      container.querySelector('[data-edge-id="b--c"]'),
    ).toHaveAttribute("display", "none");
    expect(
      container.querySelector('[data-edge-label-id="b--c"]'),
    ).toHaveAttribute("display", "none");
    expect(
      container.querySelector('[data-edge-id="a--b"]'),
    ).not.toHaveAttribute("display");
  });

  it("sorts disconnected nodes by source table into a regular grid", () => {
    setGraph(disconnectedGraph);
    const { container } = render(<GraphCanvas />);

    const cards = [
      ...container.querySelectorAll<SVGGElement>("[data-node-id]"),
    ];
    expect(cards.map((card) => card.dataset.nodeId)).toEqual([
      "a-1",
      "a-2",
      "z-1",
    ]);
    expect(new Set(cards.map((card) => card.getAttribute("transform"))).size).toBe(
      3,
    );
    const warning = container.querySelector("[data-empty-warning]");
    expect(warning).not.toBeNull();
    expect(warning).not.toHaveClass("sr-only");
    expect(warning).toHaveTextContent("未发现任何关系");
  });

  it("consumes fit-view and relayout requests", () => {
    setGraph(disconnectedGraph);
    const { container } = render(<GraphCanvas />);
    const zoomGroup = container.querySelector<SVGGElement>(".zoom-group")!;
    const firstCard = container.querySelector<SVGGElement>("[data-node-id]")!;

    zoomGroup.setAttribute("transform", "translate(999,999)");
    act(() => {
      useAnalysisStore.getState().requestFitView();
    });
    expect(zoomGroup).not.toHaveAttribute("transform", "translate(999,999)");

    firstCard.setAttribute("transform", "translate(999,999)");
    act(() => {
      useAnalysisStore.getState().requestRelayout();
    });
    expect(firstCard).not.toHaveAttribute("transform", "translate(999,999)");
  });

  it("resets D3 zoom state when the graph is replaced", () => {
    const { container } = render(<GraphCanvas />);
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const priorTransform = d3.zoomIdentity.translate(120, 80).scale(1.6);

    (svg as SVGSVGElement & { __zoom: d3.ZoomTransform }).__zoom =
      priorTransform;
    container
      .querySelector<SVGGElement>(".zoom-group")!
      .setAttribute("transform", priorTransform.toString());

    act(() => {
      setGraph(disconnectedGraph);
    });

    expect(d3.zoomTransform(svg)).toEqual(d3.zoomIdentity);
    expect(
      container.querySelector<SVGGElement>(".zoom-group"),
    ).toHaveAttribute("transform", d3.zoomIdentity.toString());
  });

  it("centers a requested node without changing the current zoom scale", () => {
    // This fails if focus only selects a node or recomputes a new zoom level.
    setGraph(disconnectedGraph);
    const { container } = render(<GraphCanvas />);
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const zoomGroup = container.querySelector<SVGGElement>(".zoom-group")!;
    const target = container.querySelector<SVGGElement>(
      '[data-node-id="a-2"]',
    )!;
    const targetDatum = d3.select(target).datum() as { x: number; y: number };
    const priorTransform = d3.zoomIdentity.translate(120, 80).scale(1.75);

    (svg as SVGSVGElement & { __zoom: d3.ZoomTransform }).__zoom =
      priorTransform;
    zoomGroup.setAttribute("transform", priorTransform.toString());

    act(() => {
      useAnalysisStore.setState({
        focusNodeRequest: { nodeId: "a-2", version: 1 },
      });
    });

    const focusedTransform = d3.zoomTransform(svg);
    const focusedPoint = focusedTransform.apply([
      targetDatum.x,
      targetDatum.y,
    ]);
    expect(focusedTransform.k).toBe(1.75);
    expect(focusedPoint[0]).toBeCloseTo(480);
    expect(focusedPoint[1]).toBeCloseTo(300);
  });

  it("renders its initial graph when ResizeObserver is unavailable", () => {
    // This fails if the observer constructor is used without feature detection.
    vi.stubGlobal("ResizeObserver", undefined);

    expect(() => render(<GraphCanvas />)).not.toThrow();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("stabilizes reduced-motion force layouts and removes its media listener", async () => {
    // This fails if CSS-only reduced motion leaves the D3 simulation visibly ticking.
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    vi.stubGlobal("matchMedia", matchMedia);

    const { container, unmount } = render(<GraphCanvas />);
    const positions = () =>
      [...container.querySelectorAll<SVGGElement>("[data-node-id]")].map(
        (node) => node.getAttribute("transform"),
      );
    const settledPositions = positions();

    await new Promise((resolve) => window.setTimeout(resolve, 80));

    expect(matchMedia).toHaveBeenCalledWith(
      "(prefers-reduced-motion: reduce)",
    );
    expect(addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
    expect(positions()).toEqual(settledPositions);

    const listener = addEventListener.mock.calls[0][1];
    unmount();
    expect(removeEventListener).toHaveBeenCalledWith("change", listener);
  });

  it("refits a zero-edge grid after its container width changes", () => {
    // This fails if grid world coordinates move while an incompatible prior camera remains.
    let resizeCallback!: ResizeObserverCallback;
    class ControlledResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
    setGraph(disconnectedGraph);

    const { container } = render(<GraphCanvas />);
    const svg = container.querySelector<SVGSVGElement>("svg")!;
    const canvas = svg.parentElement as HTMLDivElement;
    const zoomGroup = container.querySelector<SVGGElement>(".zoom-group")!;
    const priorTransform = d3.zoomIdentity.translate(-1_000, -800).scale(2);
    Object.defineProperty(canvas, "clientWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(canvas, "clientHeight", {
      configurable: true,
      value: 600,
    });
    (svg as SVGSVGElement & { __zoom: d3.ZoomTransform }).__zoom =
      priorTransform;
    zoomGroup.setAttribute("transform", priorTransform.toString());

    act(() => {
      resizeCallback([], {} as ResizeObserver);
    });

    const resizedTransform = d3.zoomTransform(svg);
    expect(resizedTransform).not.toEqual(priorTransform);
    [
      ...container.querySelectorAll<SVGGElement>("[data-node-id]"),
    ].forEach((nodeElement) => {
      const node = d3.select(nodeElement).datum() as { x: number; y: number };
      const [x, y] = resizedTransform.apply([node.x, node.y]);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(390);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(600);
    });
  });
});
