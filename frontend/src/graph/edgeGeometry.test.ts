import { describe, expect, it } from "vitest";
import {
  buildQuadraticGeometry,
  sampleQuadratic,
  semanticZoomLevel,
} from "./edgeGeometry";

const sourceBounds = { left: 0, top: 0, right: 24, bottom: 24 };
const targetBounds = { left: 120, top: 0, right: 144, bottom: 24 };

function isOutside(
  point: { x: number; y: number },
  bounds: typeof sourceBounds,
) {
  return point.x < bounds.left || point.x > bounds.right ||
    point.y < bounds.top || point.y > bounds.bottom;
}

describe("edge geometry", () => {
  it("keeps a stable control point for the same edge", () => {
    const input = {
      edgeId: "orders-users",
      from: { x: 12, y: 12 },
      to: { x: 132, y: 12 },
      fromBounds: sourceBounds,
      toBounds: targetBounds,
    };

    expect(buildQuadraticGeometry(input).control).toEqual(
      buildQuadraticGeometry(input).control,
    );
  });

  it("preserves the visible curve when endpoints are reversed", () => {
    const forward = buildQuadraticGeometry({
      edgeId: "orders-users",
      from: { x: 12, y: 12 },
      to: { x: 132, y: 12 },
      fromBounds: sourceBounds,
      toBounds: targetBounds,
    });
    const reverse = buildQuadraticGeometry({
      edgeId: "orders-users",
      from: { x: 132, y: 12 },
      to: { x: 12, y: 12 },
      fromBounds: targetBounds,
      toBounds: sourceBounds,
    });

    expect(reverse.control).toEqual(forward.control);
    const forwardSamples = sampleQuadratic(forward, 8);
    sampleQuadratic(reverse, 8).reverse().forEach((point, index) => {
      const expected = forwardSamples[index];
      expect(point.x).toBeCloseTo(expected.x, 10);
      expect(point.y).toBeCloseTo(expected.y, 10);
    });
  });

  it("places finite self-loop geometry above and right of its node", () => {
    const loop = buildQuadraticGeometry({
      edgeId: "self",
      from: { x: 12, y: 12 },
      to: { x: 12, y: 12 },
      fromBounds: sourceBounds,
      toBounds: sourceBounds,
    });

    expect(loop.isLoop).toBe(true);
    expect([loop.from, loop.control, loop.to].every((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y)
    )).toBe(true);
    expect(loop.control.x).toBeGreaterThan(sourceBounds.right);
    expect(loop.control.y).toBeLessThan(sourceBounds.top);
  });

  it("clips curve endpoints beyond the source and target label bounds", () => {
    const geometry = buildQuadraticGeometry({
      edgeId: "orders-users",
      from: { x: 12, y: 12 },
      to: { x: 132, y: 12 },
      fromBounds: sourceBounds,
      toBounds: targetBounds,
    });

    expect(isOutside(geometry.from, sourceBounds)).toBe(true);
    expect(isOutside(geometry.to, targetBounds)).toBe(true);
  });

  it("samples finite intermediate points including both clipped endpoints", () => {
    const geometry = buildQuadraticGeometry({
      edgeId: "orders-users",
      from: { x: 12, y: 12 },
      to: { x: 132, y: 12 },
      fromBounds: sourceBounds,
      toBounds: targetBounds,
    });
    const samples = sampleQuadratic(geometry, 4);

    expect(samples[0]).toEqual(geometry.from);
    expect(samples.at(-1)).toEqual(geometry.to);
    expect(samples.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("maps scale to semantic zoom levels", () => {
    expect(semanticZoomLevel(0.4)).toBe("overview");
    expect(semanticZoomLevel(0.8)).toBe("work");
    expect(semanticZoomLevel(1.2)).toBe("detail");
  });
});
