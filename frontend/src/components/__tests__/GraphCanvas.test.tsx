import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    detailPanelNodeId: null,
    confidenceThreshold: 0,
    fitViewRequest: 0,
    relayoutRequest: 0,
  });
}

describe("GraphCanvas", () => {
  beforeEach(() => {
    setGraph(connectedGraph);
  });

  afterEach(() => {
    cleanup();
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
    expect(container.querySelector("[data-empty-warning]")).toBeNull();
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
});
