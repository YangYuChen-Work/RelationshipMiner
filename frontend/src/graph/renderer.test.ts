import { describe, expect, it, vi } from "vitest";
import type { SemanticGraphData } from "../api/analysis";
import { buildGraphFocusIndex, resolveGraphFocus } from "./focus";
import { computeGroupedLayout } from "./layout";
import { drawGraphScene } from "./renderer";
import { buildScene } from "./scene";

const graph: SemanticGraphData = {
  table_nodes: [
    { id: "left", display_name: "Left", entity_count: 2 },
    { id: "right", display_name: "Right", entity_count: 2 },
  ],
  entity_nodes: [
    { id: "a", table_id: "left", display_name: "Alpha", class_name: "Source", dimensions: {} },
    { id: "b", table_id: "right", display_name: "Beta", class_name: "Target", dimensions: {} },
    { id: "c", table_id: "left", display_name: "Gamma", class_name: "Other", dimensions: {} },
    { id: "d", table_id: "right", display_name: "Delta", class_name: "Other", dimensions: {} },
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

function scene() {
  return buildScene({
    graph,
    layout: computeGroupedLayout(graph, { width: 960, height: 600 }),
    transform: { k: 1.4, x: 120, y: 80 },
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
  const context = {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(function (this: CanvasRenderingContext2D) {
      records.push({ kind: "fill", alpha: this.globalAlpha, lineWidth: this.lineWidth });
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
  return { context, records };
}

function options(focusNodeId: string | null = null) {
  const index = buildGraphFocusIndex(graph.entity_edges, 0);
  return {
    width: 960,
    height: 600,
    focus: resolveGraphFocus(index, focusNodeId, null),
    selectedEntityEdgeId: null,
    selectedTableEdgeId: null,
    reduceMotion: true,
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

  it("draws both active-node label lines and paints focused relation label backing first", () => {
    const { context, records } = recordingContext();

    drawGraphScene(context, scene(), options("a"));

    const texts = records
      .filter((record) => record.kind === "fillText")
      .map((record) => record.text);
    expect(texts).toContain("Alpha");
    expect(texts.some((text) => text?.startsWith("Source; "))).toBe(true);
    const relationTextIndex = records.findIndex((record) =>
      record.kind === "fillText" && record.text === "feeds"
    );
    const backingIndex = records.findLastIndex(
      (record, index) => record.kind === "fillRect" && index < relationTextIndex,
    );
    expect(backingIndex).toBeGreaterThanOrEqual(0);
    expect(backingIndex).toBeLessThan(relationTextIndex);
  });
});
