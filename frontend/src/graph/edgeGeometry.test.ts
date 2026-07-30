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
  it("separates parallel edges deterministically across input order and direction", () => {
    const compactSourceBounds = { left: 0, top: 0, right: 0, bottom: 0 };
    const compactTargetBounds = { left: 8, top: 0, right: 8, bottom: 0 };
    const parallel = [
      {
        edgeId: "edge-3",
        from: { x: 8, y: 0 },
        to: { x: 0, y: 0 },
        fromBounds: compactTargetBounds,
        toBounds: compactSourceBounds,
      },
      {
        edgeId: "edge-1",
        from: { x: 0, y: 0 },
        to: { x: 8, y: 0 },
        fromBounds: compactSourceBounds,
        toBounds: compactTargetBounds,
      },
    ];
    const build = (inputs: typeof parallel) => {
      const sortedIds = inputs.map(({ edgeId }) => edgeId).sort();
      return Object.fromEntries(inputs.map((input) => [
        input.edgeId,
        buildQuadraticGeometry({
          ...input,
          parallelOrdinal: sortedIds.indexOf(input.edgeId),
          parallelCount: sortedIds.length,
        }),
      ]));
    };

    const first = build(parallel);
    const reordered = build([...parallel].reverse());

    expect(first["edge-1"].control).not.toEqual(first["edge-3"].control);
    expect(reordered).toEqual(first);
  });

  it("keeps geometry and samples finite near the numeric coordinate limit", () => {
    const maximum = Number.MAX_VALUE;
    const nearMaximum = maximum * (1 - Number.EPSILON * 2);
    const geometry = buildQuadraticGeometry({
      edgeId: "finite-extreme",
      from: { x: nearMaximum, y: nearMaximum },
      to: { x: maximum, y: maximum },
      fromBounds: { left: nearMaximum, top: nearMaximum, right: nearMaximum, bottom: nearMaximum },
      toBounds: { left: maximum, top: maximum, right: maximum, bottom: maximum },
    });

    expect(geometry.isLoop).toBe(false);
    expect([geometry.from, geometry.control, geometry.to, ...sampleQuadratic(geometry, 8)]
      .every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
      .toBe(true);
  });

  it("keeps an extreme finite self-loop non-zero at the numeric limit", () => {
    const maximum = Number.MAX_VALUE;
    const geometry = buildQuadraticGeometry({
      edgeId: "extreme-self",
      from: { x: maximum, y: maximum },
      to: { x: maximum, y: maximum },
      fromBounds: { left: maximum, top: maximum, right: maximum, bottom: maximum },
      toBounds: { left: maximum, top: maximum, right: maximum, bottom: maximum },
    });
    const samples = sampleQuadratic(geometry, 8);
    const points = [geometry.from, geometry.control, geometry.to, ...samples];

    expect(geometry.isLoop).toBe(true);
    expect(points.every((point) =>
      Number.isFinite(point.x) && Number.isFinite(point.y)
    )).toBe(true);
    expect(new Set(points.map((point) => `${point.x}:${point.y}`)).size)
      .toBeGreaterThan(1);
    expect(Math.hypot(
      geometry.control.x - geometry.from.x,
      geometry.control.y - geometry.from.y,
    )).toBeGreaterThan(0);
  });

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
