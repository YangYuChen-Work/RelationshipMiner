import { describe, expect, it, vi } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import { buildGraphFocusIndex, resolveGraphFocus } from "./focus";
import { computeGroupedLayout } from "./layout";
import {
  createGraphDragPreview,
  drawGraphDragPreview,
  drawGraphScene,
} from "./renderer";
import { buildScene } from "./scene";

const graph: SemanticGraphData = {
  table_nodes: [
    { id: "left", display_name: "Left", entity_count: 3 },
    { id: "right", display_name: "Right", entity_count: 2 },
  ],
  entity_nodes: [
    { id: "a", table_id: "left", display_name: "Alpha", class_name: "Source", dimensions: {} },
    { id: "b", table_id: "right", display_name: "Beta", class_name: "Target", dimensions: {} },
    { id: "c", table_id: "left", display_name: "Gamma", class_name: "Other", dimensions: {} },
    { id: "d", table_id: "right", display_name: "Delta", class_name: "Other", dimensions: {} },
    { id: "isolated", table_id: "left", display_name: "Solo", class_name: "Isolated", dimensions: {} },
  ],
  table_edges: [{
    id: "left--right",
    source_table: "left",
    target_table: "right",
    relation_types: ["contains"],
    strong_count: 2,
    weak_count: 0,
    entity_edge_count: 2,
    average_confidence: 0.9,
    supporting_entity_edges: ["a--b", "c--d"],
  }],
  entity_edges: [
    {
      id: "a--b",
      source: "a",
      target: "b",
      relations: [{
        source: "a",
        target: "b",
        relation_type: "feeds",
        display_label: "供给",
        direction: "source_to_target",
        strength: "strong",
        confidence: 0.95,
        explanation: "fixture",
        evidence: [],
        model_id: null,
        task_id: null,
      }],
    },
    {
      id: "c--d",
      source: "c",
      target: "d",
      relations: [{
        source: "c",
        target: "d",
        relation_type: "mirrors",
        display_label: "映射",
        direction: "undirected",
        strength: "strong",
        confidence: 0.9,
        explanation: "fixture",
        evidence: [],
        model_id: null,
        task_id: null,
      }],
    },
  ],
};

function scene(scale = 1.4) {
  return buildScene({
    graph,
    layout: computeGroupedLayout(graph, { width: 960, height: 600 }),
    transform: { k: scale, x: 120, y: 80 },
    confidenceThreshold: 0,
  });
}

interface DrawRecord {
  kind: "fill" | "stroke" | "fillRect" | "fillText";
  alpha: number;
  lineWidth: number;
  text?: string;
}

function recordingContext() {
  const records: DrawRecord[] = [];
  const nodeFills: { x: number; y: number; alpha: number }[] = [];
  let lastArc: { x: number; y: number } | null = null;
  const context = {
    arc: vi.fn((x: number, y: number) => {
      lastArc = { x, y };
    }),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(function (this: CanvasRenderingContext2D) {
      records.push({ kind: "fill", alpha: this.globalAlpha, lineWidth: this.lineWidth });
      if (lastArc) {
        nodeFills.push({ ...lastArc, alpha: this.globalAlpha });
        lastArc = null;
      }
    }),
    fillRect: vi.fn(function (this: CanvasRenderingContext2D) {
      records.push({ kind: "fillRect", alpha: this.globalAlpha, lineWidth: this.lineWidth });
    }),
    fillText: vi.fn(function (
      this: CanvasRenderingContext2D,
      text: string,
    ) {
      records.push({
        kind: "fillText",
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        text,
      });
    }),
    lineTo: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    moveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(function (this: CanvasRenderingContext2D) {
      records.push({ kind: "stroke", alpha: this.globalAlpha, lineWidth: this.lineWidth });
    }),
    fillStyle: "",
    font: "",
    globalAlpha: 1,
    lineCap: "butt" as CanvasLineCap,
    lineJoin: "miter" as CanvasLineJoin,
    lineWidth: 1,
    strokeStyle: "",
    textAlign: "start" as CanvasTextAlign,
    textBaseline: "alphabetic" as CanvasTextBaseline,
  } as unknown as CanvasRenderingContext2D;
  return { context, records, nodeFills };
}

function options(focusNodeId: string | null = null) {
  const index = buildGraphFocusIndex(graph.entity_edges, 0);
  return {
    width: 960,
    height: 600,
    focus: resolveGraphFocus(index, focusNodeId, null),
    selectedEntityEdgeId: null,
    selectedTableEdgeId: null,
  };
}

describe("drawGraphScene", () => {
  it("uses semantic layer opacity when there is no focus", () => {
    const currentScene = scene();
    const { context, records } = recordingContext();

    drawGraphScene(context, currentScene, options());

    const strokes = records.filter((record) => record.kind === "stroke");
    expect(strokes.some((record) =>
      record.alpha === currentScene.layerOpacity.tableEdges
    )).toBe(true);
    expect(strokes.some((record) =>
      record.alpha === currentScene.layerOpacity.entityEdges
    )).toBe(true);
  });

  it("dims unrelated nodes and curves, then draws related curves wider and later", () => {
    const { context, records } = recordingContext();

    drawGraphScene(context, scene(), options("a"));

    expect(records.some((record) =>
      record.kind === "fill" && record.alpha === 0.16
    )).toBe(true);
    const unrelatedEdgeIndex = records.findIndex((record) =>
      record.kind === "stroke" && record.alpha === 0.06
    );
    const relatedEdgeIndex = records.findIndex((record) =>
      record.kind === "stroke" && record.lineWidth === 2.2
    );
    expect(unrelatedEdgeIndex).toBeGreaterThanOrEqual(0);
    expect(relatedEdgeIndex).toBeGreaterThan(unrelatedEdgeIndex);
    expect(records[relatedEdgeIndex].alpha).toBeGreaterThan(0.06);
  });

  it("draws normal relationships as quadratic curves and directional detail as arrowheads", () => {
    const { context } = recordingContext();

    drawGraphScene(context, scene(), options("a"));

    expect(context.quadraticCurveTo).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
    expect(context.closePath).toHaveBeenCalled();
  });

  it("draws every arrowhead after active nodes and focused labels", () => {
    const { context } = recordingContext();

    drawGraphScene(context, scene(), options("a"));

    const finalArrowOrder = Math.max(
      ...vi.mocked(context.closePath).mock.invocationCallOrder,
    );
    const finalLabelOrder = Math.max(
      ...vi.mocked(context.fillText).mock.invocationCallOrder,
    );
    const finalNodeOrder = Math.max(
      ...vi.mocked(context.arc).mock.invocationCallOrder,
    );
    expect(finalArrowOrder).toBeGreaterThan(finalLabelOrder);
    expect(finalArrowOrder).toBeGreaterThan(finalNodeOrder);
  });

  it("draws the active-node business label without technical secondary text and paints focused relation label backing first", () => {
    const { context, records } = recordingContext();

    drawGraphScene(context, scene(), options("a"));

    const texts = records
      .filter((record) => record.kind === "fillText")
      .map((record) => record.text);
    expect(texts).toContain("Alpha");
    expect(texts.some((text) => text?.includes("Source"))).toBe(false);
    const relationTextIndex = records.findIndex((record) =>
      record.kind === "fillText" && record.text === "供给"
    );
    const backingIndex = records.findLastIndex(
      (record, index) => record.kind === "fillRect" && index < relationTextIndex,
    );
    expect(backingIndex).toBeGreaterThanOrEqual(0);
    expect(backingIndex).toBeLessThan(relationTextIndex);
  });

  it.each([
    ["connected", "a", "Alpha", "Source"],
    ["isolated", "isolated", "Solo", "Isolated"],
  ])("draws only the business presentation line for a unique active %s overview node", (
    _kind,
    nodeId,
    primary,
    technicalText,
  ) => {
    const { context, records } = recordingContext();

    drawGraphScene(context, scene(0.2), options(nodeId));

    const texts = records
      .filter((record) => record.kind === "fillText")
      .map((record) => record.text);
    expect(texts).toContain(primary);
    expect(texts.some((text) => text?.includes(technicalText))).toBe(false);
  });

  it("draws the business-code line for an active duplicate name", () => {
    const duplicateGraph: SemanticGraphData = {
      ...graph,
      entity_nodes: graph.entity_nodes.map((entity) => {
        if (entity.id === "a") {
          return { ...entity, display_code: "ALPHA-A" };
        }
        if (entity.id === "b") {
          return {
            ...entity,
            display_name: "Alpha",
            display_code: "ALPHA-B",
          };
        }
        return entity;
      }),
    };
    const duplicateScene = buildScene({
      graph: duplicateGraph,
      layout: computeGroupedLayout(duplicateGraph, { width: 960, height: 600 }),
      transform: { k: 0.2, x: 120, y: 80 },
      confidenceThreshold: 0,
    });
    const { context, records } = recordingContext();

    drawGraphScene(context, duplicateScene, options("a"));

    const texts = records
      .filter((record) => record.kind === "fillText")
      .map((record) => record.text);
    expect(texts).toContain("Alpha");
    expect(texts).toContain("ALPHA-A");
  });

  it("keeps both selected table-relationship endpoints fully focused", () => {
    const currentScene = scene();
    const { context, nodeFills } = recordingContext();
    const drawOptions = {
      ...options(),
      selectedTableEdgeId: "left--right",
    };

    drawGraphScene(context, currentScene, drawOptions);

    for (const table of currentScene.tableNodes) {
      expect(nodeFills).toContainEqual({
        x: table.screen.x,
        y: table.screen.y,
        alpha: 1,
      });
    }
  });

  it("composites a drag frame without the original node or incident curve", () => {
    const currentScene = scene();
    const dragged = currentScene.entityDots.find((node) => node.id === "a")!;
    const incident = currentScene.entityEdges.find(
      (edge) => edge.sourceId === dragged.id,
    )!;
    const unrelated = currentScene.entityEdges.find(
      (edge) => edge.sourceId !== dragged.id && edge.targetId !== dragged.id,
    )!;
    const preview = createGraphDragPreview(currentScene, dragged.id)!;
    const screen = {
      x: dragged.screen.x + 100,
      y: dragged.screen.y + 60,
    };
    const { context } = recordingContext();
    const compositeOptions = {
      ...options("a"),
      dragPreview: { preview, screen },
    };

    drawGraphScene(context, currentScene, compositeOptions);

    const arcs = vi.mocked(context.arc).mock.calls;
    expect(arcs.filter(([x, y]) =>
      x === dragged.screen.x && y === dragged.screen.y
    )).toHaveLength(0);
    expect(arcs.filter(([x, y]) => x === screen.x && y === screen.y))
      .toHaveLength(1);

    const curves = vi.mocked(context.quadraticCurveTo).mock.calls;
    expect(curves).not.toContainEqual([
      incident.geometry.control.x,
      incident.geometry.control.y,
      incident.geometry.to.x,
      incident.geometry.to.y,
    ]);
    expect(curves).toContainEqual([
      incident.geometry.control.x + 50,
      incident.geometry.control.y + 30,
      incident.geometry.to.x,
      incident.geometry.to.y,
    ]);
    expect(curves).toContainEqual([
      unrelated.geometry.control.x,
      unrelated.geometry.control.y,
      unrelated.geometry.to.x,
      unrelated.geometry.to.y,
    ]);
  });

  it("moves the focused incident label and backing without duplicating unrelated labels", () => {
    const currentScene = scene();
    const dragged = currentScene.entityDots.find((node) => node.id === "a")!;
    const incidentLabel = currentScene.edgeLabels.find(
      (label) => label.edgeId === "a--b",
    )!;
    const unrelatedLabel = currentScene.edgeLabels.find(
      (label) => label.edgeId === "c--d",
    )!;
    const preview = createGraphDragPreview(currentScene, dragged.id)!;
    const screen = {
      x: dragged.screen.x + 100,
      y: dragged.screen.y + 60,
    };
    const { context } = recordingContext();

    const focusedOptions = options("a");
    drawGraphScene(context, currentScene, {
      ...focusedOptions,
      focus: {
        ...focusedOptions.focus,
        edgeIds: new Set(["a--b", "c--d"]),
      },
      dragPreview: { preview, screen },
    });

    const textCalls = vi.mocked(context.fillText).mock.calls;
    expect(textCalls).not.toContainEqual([
      incidentLabel.text,
      incidentLabel.screen.x - incidentLabel.maxWidth / 2,
      incidentLabel.screen.y - 5,
      incidentLabel.maxWidth,
    ]);
    expect(textCalls.filter(([text]) => text === incidentLabel.text)).toEqual([[
      incidentLabel.text,
      incidentLabel.screen.x + 50 - incidentLabel.maxWidth / 2,
      incidentLabel.screen.y + 30 - 5,
      incidentLabel.maxWidth,
    ]]);
    expect(textCalls.filter(([text]) => text === unrelatedLabel.text)).toEqual([[
      unrelatedLabel.text,
      unrelatedLabel.screen.x - unrelatedLabel.maxWidth / 2,
      unrelatedLabel.screen.y - 5,
      unrelatedLabel.maxWidth,
    ]]);
    expect(vi.mocked(context.fillRect).mock.calls).toContainEqual([
      incidentLabel.screen.x + 50 - incidentLabel.maxWidth / 2 - 5,
      incidentLabel.screen.y + 30 - 10,
      incidentLabel.maxWidth + 10,
      20,
    ]);
  });

  it("keeps an unrelated dragged relationship label hidden while another node is selected", () => {
    const currentScene = scene();
    const dragged = currentScene.entityDots.find((node) => node.id === "c")!;
    const preview = createGraphDragPreview(currentScene, dragged.id)!;
    const focusIndex = buildGraphFocusIndex(graph.entity_edges, 0);
    const selectedFocus = resolveGraphFocus(focusIndex, null, "a");
    const { context } = recordingContext();

    drawGraphScene(context, currentScene, {
      ...options(),
      focus: selectedFocus,
      dragPreview: {
        preview,
        screen: {
          x: dragged.screen.x + 100,
          y: dragged.screen.y + 60,
        },
      },
    });

    const texts = vi.mocked(context.fillText).mock.calls.map(([text]) => text);
    expect(texts.filter((text) => text === "映射")).toHaveLength(0);
    expect(texts.filter((text) => text === "供给")).toHaveLength(1);
  });
});

describe("drawGraphDragPreview", () => {
  it("draws only the moved node and its incident quadratic relationships", () => {
    const currentScene = scene();
    const { context } = recordingContext();
    const incidentCount = currentScene.entityEdges.filter(
      (edge) => edge.sourceId === "a" || edge.targetId === "a",
    ).length;

    const preview = createGraphDragPreview(currentScene, "a");
    expect(preview).not.toBeNull();
    drawGraphDragPreview(context, preview!, { x: 400, y: 300 });

    expect(context.arc).toHaveBeenCalledWith(
      400,
      300,
      expect.any(Number),
      0,
      Math.PI * 2,
    );
    expect(context.quadraticCurveTo).toHaveBeenCalledTimes(incidentCount);
  });
});
