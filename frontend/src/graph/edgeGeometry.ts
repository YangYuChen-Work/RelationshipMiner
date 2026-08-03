import type { ScreenPoint } from "./scene";

export type SemanticZoomLevel = "overview" | "work" | "detail";

export interface ScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export type ScreenBoundsRegion = ScreenBounds | readonly ScreenBounds[];

export interface QuadraticGeometry {
  readonly from: ScreenPoint;
  readonly control: ScreenPoint;
  readonly to: ScreenPoint;
  readonly isLoop: boolean;
}

const OVERVIEW_MAX_SCALE = 0.65;
const WORK_MAX_SCALE = 1.2;
const CLIP_PADDING = 2;
const MIN_CURVE_OFFSET = 12;
const MAX_CURVE_OFFSET = 28;

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function finitePoint(point: ScreenPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function normalizedBounds(bounds: ScreenBounds, fallback: ScreenPoint): ScreenBounds {
  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) {
    return { left: fallback.x, top: fallback.y, right: fallback.x, bottom: fallback.y };
  }
  return {
    left: Math.min(bounds.left, bounds.right),
    top: Math.min(bounds.top, bounds.bottom),
    right: Math.max(bounds.left, bounds.right),
    bottom: Math.max(bounds.top, bounds.bottom),
  };
}

function normalizedRegions(
  region: ScreenBoundsRegion,
  fallback: ScreenPoint,
): ScreenBounds[] {
  const bounds = Array.isArray(region) ? region : [region as ScreenBounds];
  if (bounds.length === 0) {
    return [{ left: fallback.x, top: fallback.y, right: fallback.x, bottom: fallback.y }];
  }
  return bounds.map((candidate) => normalizedBounds(candidate, fallback));
}

function boundsEnvelope(bounds: readonly ScreenBounds[]): ScreenBounds {
  return bounds.reduce((envelope, candidate) => ({
    left: Math.min(envelope.left, candidate.left),
    top: Math.min(envelope.top, candidate.top),
    right: Math.max(envelope.right, candidate.right),
    bottom: Math.max(envelope.bottom, candidate.bottom),
  }));
}

function comparePoints(left: ScreenPoint, right: ScreenPoint): number {
  if (left.x !== right.x) return left.x < right.x ? -1 : 1;
  if (left.y !== right.y) return left.y < right.y ? -1 : 1;
  return 0;
}

function pointKey(point: ScreenPoint): string {
  return `${point.x},${point.y}`;
}

function finiteCoordinate(value: number, fallback: number): number {
  if (Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return fallback;
  return value < 0 ? -Number.MAX_VALUE : Number.MAX_VALUE;
}

function representableMove(
  value: number,
  direction: -1 | 1,
  steps: number,
): number {
  const step = Math.max(Number.MIN_VALUE, Math.abs(value) * Number.EPSILON);
  const candidate = value + direction * step * steps;
  return Number.isFinite(candidate) && candidate !== value ? candidate : value;
}

function midpoint(left: number, right: number): number {
  const difference = right - left;
  const value = Number.isFinite(difference)
    ? left + difference / 2
    : left / 2 + right / 2;
  return finiteCoordinate(value, left);
}

function unitVector(from: ScreenPoint, to: ScreenPoint): ScreenPoint | null {
  const scale = Math.max(
    1,
    Math.abs(from.x),
    Math.abs(from.y),
    Math.abs(to.x),
    Math.abs(to.y),
  );
  const dx = to.x / scale - from.x / scale;
  const dy = to.y / scale - from.y / scale;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length === 0) return null;
  return { x: dx / length, y: dy / length };
}

function curveOffset(
  hash: number,
  parallelOrdinal: number | undefined,
  parallelCount: number | undefined,
): number {
  if (
    Number.isSafeInteger(parallelOrdinal) &&
    Number.isSafeInteger(parallelCount) &&
    parallelCount! > 1 &&
    parallelOrdinal! >= 0 &&
    parallelOrdinal! < parallelCount!
  ) {
    const negative = parallelOrdinal! % 2 === 0;
    const rank = Math.floor(parallelOrdinal! / 2);
    const sideCount = negative
      ? Math.ceil(parallelCount! / 2)
      : Math.floor(parallelCount! / 2);
    const magnitude = MIN_CURVE_OFFSET +
      (MAX_CURVE_OFFSET - MIN_CURVE_OFFSET) * (rank + 1) / (sideCount + 1);
    return negative ? -magnitude : magnitude;
  }
  const magnitude = MIN_CURVE_OFFSET +
    hash % (MAX_CURVE_OFFSET - MIN_CURVE_OFFSET + 1);
  return hash & 0x1 ? magnitude : -magnitude;
}

function rayPastBounds(
  start: ScreenPoint,
  toward: ScreenPoint,
  regions: readonly ScreenBounds[],
): ScreenPoint {
  const unit = unitVector(start, toward);
  if (!unit) return { ...start };
  const exitDistance = (bounds: ScreenBounds): number | null => {
    let enter = Number.NEGATIVE_INFINITY;
    let exit = Number.POSITIVE_INFINITY;
    for (const [coordinate, direction, minimum, maximum] of [
      [start.x, unit.x, bounds.left, bounds.right],
      [start.y, unit.y, bounds.top, bounds.bottom],
    ] as const) {
      if (direction === 0) {
        if (coordinate < minimum || coordinate > maximum) return null;
        continue;
      }
      const first = (minimum - coordinate) / direction;
      const second = (maximum - coordinate) / direction;
      enter = Math.max(enter, Math.min(first, second));
      exit = Math.min(exit, Math.max(first, second));
    }
    return exit >= Math.max(0, enter) && Number.isFinite(exit) ? exit : null;
  };
  const distance = regions
    .map(exitDistance)
    .filter((value): value is number => value != null && value >= 0)
    .reduce((farthest, value) => Math.max(farthest, value), Number.NEGATIVE_INFINITY);
  if (!Number.isFinite(distance)) return { ...start };
  return {
    x: finiteCoordinate(
      start.x + unit.x * (distance + CLIP_PADDING),
      start.x,
    ),
    y: finiteCoordinate(
      start.y + unit.y * (distance + CLIP_PADDING),
      start.y,
    ),
  };
}

export function semanticZoomLevel(scale: number): SemanticZoomLevel {
  if (!Number.isFinite(scale) || scale < OVERVIEW_MAX_SCALE) return "overview";
  return scale < WORK_MAX_SCALE ? "work" : "detail";
}

export function buildQuadraticGeometry(input: {
  edgeId: string;
  from: ScreenPoint;
  to: ScreenPoint;
  fromBounds: ScreenBoundsRegion;
  toBounds: ScreenBoundsRegion;
  parallelOrdinal?: number;
  parallelCount?: number;
}): QuadraticGeometry {
  const from = finitePoint(input.from) ? input.from : { x: 0, y: 0 };
  const to = finitePoint(input.to) ? input.to : { ...from };
  const fromRegions = normalizedRegions(input.fromBounds, from);
  const toRegions = normalizedRegions(input.toBounds, to);
  const fromBounds = boundsEnvelope(fromRegions);
  if (from.x === to.x && from.y === to.y) {
    const rawSpan = Math.max(
      16,
      Math.abs(fromBounds.right / 2 - fromBounds.left / 2) * 2,
      Math.abs(fromBounds.bottom / 2 - fromBounds.top / 2) * 2,
    );
    const baseSpan = Math.min(128, finiteCoordinate(rawSpan, 16));
    const ordinal = Number.isSafeInteger(input.parallelOrdinal) &&
        Number.isSafeInteger(input.parallelCount) &&
        input.parallelCount! > 1 &&
        input.parallelOrdinal! >= 0 &&
        input.parallelOrdinal! < input.parallelCount!
      ? input.parallelOrdinal!
      : 0;
    const span = baseSpan + ordinal * 4;
    const loop: QuadraticGeometry = {
      from: {
        x: finiteCoordinate(fromBounds.right + CLIP_PADDING, from.x),
        y: finiteCoordinate(fromBounds.top - span * 0.25, from.y),
      },
      control: {
        x: finiteCoordinate(fromBounds.right + span, from.x),
        y: finiteCoordinate(fromBounds.top - span, from.y),
      },
      to: {
        x: finiteCoordinate(fromBounds.right + span * 0.25, from.x),
        y: finiteCoordinate(fromBounds.top - CLIP_PADDING, from.y),
      },
      isLoop: true,
    };
    if (
      loop.from.x !== loop.control.x ||
      loop.from.y !== loop.control.y ||
      loop.from.x !== loop.to.x ||
      loop.from.y !== loop.to.y
    ) {
      return loop;
    }

    const anchorX = fromBounds.right;
    const anchorY = fromBounds.top;
    const right = representableMove(anchorX, 1, 1);
    const xDirection: -1 | 1 = right > anchorX ? 1 : -1;
    const above = representableMove(anchorY, -1, 1);
    const yDirection: -1 | 1 = above < anchorY ? -1 : 1;
    const laneStepBase = ordinal * 4;
    return {
      from: {
        x: representableMove(anchorX, xDirection, laneStepBase + 1),
        y: representableMove(anchorY, yDirection, laneStepBase + 1),
      },
      control: {
        x: xDirection > 0
          ? representableMove(anchorX, xDirection, laneStepBase + 4)
          : anchorX,
        y: representableMove(anchorY, yDirection, laneStepBase + 4),
      },
      to: {
        x: representableMove(anchorX, xDirection, laneStepBase + 2),
        y: representableMove(anchorY, yDirection, laneStepBase + 2),
      },
      isLoop: true,
    };
  }

  const [canonicalFrom, canonicalTo] = comparePoints(from, to) <= 0
    ? [from, to]
    : [to, from];
  const hash = stableHash(`${input.edgeId}|${pointKey(canonicalFrom)}|${pointKey(canonicalTo)}`);
  const canonicalUnit = unitVector(canonicalFrom, canonicalTo) ?? { x: 1, y: 0 };
  const rawOffset = curveOffset(hash, input.parallelOrdinal, input.parallelCount);
  const horizontal = Math.abs(canonicalUnit.x) >= Math.abs(canonicalUnit.y);
  const offset = horizontal
    ? -(Number.isSafeInteger(input.parallelOrdinal) &&
        Number.isSafeInteger(input.parallelCount) &&
        input.parallelCount! > 1
      ? MIN_CURVE_OFFSET +
        (MAX_CURVE_OFFSET - MIN_CURVE_OFFSET) *
          (input.parallelOrdinal! + 1) / (input.parallelCount! + 1)
      : Math.abs(rawOffset))
    : rawOffset;
  const middle = {
    x: midpoint(canonicalFrom.x, canonicalTo.x),
    y: midpoint(canonicalFrom.y, canonicalTo.y),
  };
  const control = {
    x: finiteCoordinate(middle.x - canonicalUnit.y * offset, middle.x),
    y: finiteCoordinate(middle.y + canonicalUnit.x * offset, middle.y),
  };
  return {
    from: rayPastBounds(from, control, fromRegions),
    control,
    to: rayPastBounds(to, control, toRegions),
    isLoop: false,
  };
}

export function quadraticPoint(
  geometry: QuadraticGeometry,
  t: number,
): ScreenPoint {
  const progress = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const interpolate = (left: number, right: number) =>
    finiteCoordinate(
      left * (1 - progress) + right * progress,
      progress < 0.5 ? left : right,
    );
  const fromControl = {
    x: interpolate(geometry.from.x, geometry.control.x),
    y: interpolate(geometry.from.y, geometry.control.y),
  };
  const controlTo = {
    x: interpolate(geometry.control.x, geometry.to.x),
    y: interpolate(geometry.control.y, geometry.to.y),
  };
  return {
    x: interpolate(fromControl.x, controlTo.x),
    y: interpolate(fromControl.y, controlTo.y),
  };
}

export function sampleQuadratic(
  geometry: QuadraticGeometry,
  segments = 16,
): ScreenPoint[] {
  const count = Number.isFinite(segments) ? Math.max(1, Math.floor(segments)) : 16;
  return Array.from({ length: count + 1 }, (_, index) =>
    quadraticPoint(geometry, index / count)
  );
}
