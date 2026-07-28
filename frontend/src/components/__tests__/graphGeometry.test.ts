import { describe, expect, it } from "vitest";
import type { EdgeData } from "../../api/analysis";
import {
  getDirectNeighborIds,
  getRectBoundaryPoint,
  getVisibleEdgeCount,
} from "../graphGeometry";

const edges: EdgeData[] = [
  { source: "a", target: "b", labels: [], confidence: 1 },
  { source: "b", target: "c", labels: [], confidence: 0.6 },
  { source: "c", target: "d", labels: [], confidence: 0.2 },
];

describe("graph geometry", () => {
  it("returns only the hovered node and its direct neighbors", () => {
    expect(getDirectNeighborIds("a", edges)).toEqual(new Set(["a", "b"]));
    expect(getDirectNeighborIds("b", edges)).toEqual(
      new Set(["b", "a", "c"]),
    );
  });

  it("counts edges whose confidence meets the threshold", () => {
    expect(getVisibleEdgeCount(edges, 0.6)).toBe(2);
    expect(getVisibleEdgeCount(edges, 1)).toBe(1);
  });

  it("places a horizontal edge endpoint on the rectangle boundary", () => {
    expect(
      getRectBoundaryPoint({ x: 0, y: 0 }, { x: 200, y: 0 }, 84, 32),
    ).toEqual({ x: 84, y: 0 });
  });

  it("scales diagonal edge endpoints to the first rectangle boundary", () => {
    expect(
      getRectBoundaryPoint({ x: 10, y: 20 }, { x: 210, y: 120 }, 84, 32),
    ).toEqual({ x: 74, y: 52 });
  });

  it("keeps coincident edge endpoints at the source", () => {
    expect(
      getRectBoundaryPoint({ x: 12, y: 18 }, { x: 12, y: 18 }, 84, 32),
    ).toEqual({ x: 12, y: 18 });
  });
});
