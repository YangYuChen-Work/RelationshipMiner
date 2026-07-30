import type { ScreenPoint } from "./scene";

export type SemanticZoomLevel = "overview" | "work" | "detail";

export interface ScreenBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

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
  bounds: ScreenBounds,
): ScreenPoint {
  const unit = unitVector(start, toward);
  if (!unit) return { ...start };
  const candidates: number[] = [];
  if (unit.x > 0) candidates.push((bounds.right - start.x) / unit.x);
  if (unit.x < 0) candidates.push((bounds.left - start.x) / unit.x);
  if (unit.y > 0) candidates.push((bounds.bottom - start.y) / unit.y);
  if (unit.y < 0) candidates.push((bounds.top - start.y) / unit.y);
  const distance = candidates.filter((value) => Number.isFinite(value) && value >= 0)
    .reduce((closest, value) => Math.min(closest, value), Number.POSITIVE_INFINITY);
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
  fromBounds: ScreenBounds;
  toBounds: ScreenBounds;
  parallelOrdinal?: number;
  parallelCount?: number;
}): QuadraticGeometry {
  const from = finitePoint(input.from) ? input.from : { x: 0, y: 0 };
  const to = finitePoint(input.to) ? input.to : { ...from };
  const fromBounds = normalizedBounds(input.fromBounds, from);
  const toBounds = normalizedBounds(input.toBounds, to);
  if (from.x === to.x && from.y === to.y) {
    const rawSpan = Math.max(
      16,
      Math.abs(fromBounds.right / 2 - fromBounds.left / 2) * 2,
      Math.abs(fromBounds.bottom / 2 - fromBounds.top / 2) * 2,
    );
    const baseSpan = Math.min(128, finiteCoordinate(rawSpan, 16));
    const ordinal = Number.isSafeInteger(input.parallelOrdinal) &&
        Number.isSafeInteger(input.parallelCount) &&
        input.parallelCount! > 1
      ? input.parallelOrdinal!
      : 0;
    const span = baseSpan + ordinal * 4;
    return {
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
  }

  const [canonicalFrom, canonicalTo] = comparePoints(from, to) <= 0
    ? [from, to]
    : [to, from];
  const hash = stableHash(`${input.edgeId}|${pointKey(canonicalFrom)}|${pointKey(canonicalTo)}`);
  const offset = curveOffset(hash, input.parallelOrdinal, input.parallelCount);
  const canonicalUnit = unitVector(canonicalFrom, canonicalTo) ?? { x: 1, y: 0 };
  const middle = {
    x: midpoint(canonicalFrom.x, canonicalTo.x),
    y: midpoint(canonicalFrom.y, canonicalTo.y),
  };
  const control = {
    x: finiteCoordinate(middle.x - canonicalUnit.y * offset, middle.x),
    y: finiteCoordinate(middle.y + canonicalUnit.x * offset, middle.y),
  };
  return {
    from: rayPastBounds(from, control, fromBounds),
    control,
    to: rayPastBounds(to, control, toBounds),
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
