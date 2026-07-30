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
  return left.x - right.x || left.y - right.y;
}

function pointKey(point: ScreenPoint): string {
  return `${point.x},${point.y}`;
}

function rayPastBounds(
  start: ScreenPoint,
  toward: ScreenPoint,
  bounds: ScreenBounds,
): ScreenPoint {
  const dx = toward.x - start.x;
  const dy = toward.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length < 0.000_001) return { ...start };
  const unit = { x: dx / length, y: dy / length };
  const candidates: number[] = [];
  if (unit.x > 0) candidates.push((bounds.right - start.x) / unit.x);
  if (unit.x < 0) candidates.push((bounds.left - start.x) / unit.x);
  if (unit.y > 0) candidates.push((bounds.bottom - start.y) / unit.y);
  if (unit.y < 0) candidates.push((bounds.top - start.y) / unit.y);
  const distance = candidates.filter((value) => Number.isFinite(value) && value >= 0)
    .reduce((closest, value) => Math.min(closest, value), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(distance)) return { ...start };
  return {
    x: start.x + unit.x * (distance + CLIP_PADDING),
    y: start.y + unit.y * (distance + CLIP_PADDING),
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
}): QuadraticGeometry {
  const from = finitePoint(input.from) ? input.from : { x: 0, y: 0 };
  const to = finitePoint(input.to) ? input.to : { ...from };
  const fromBounds = normalizedBounds(input.fromBounds, from);
  const toBounds = normalizedBounds(input.toBounds, to);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);

  if (!Number.isFinite(length) || length < 0.000_001) {
    const span = Math.max(
      16,
      fromBounds.right - fromBounds.left,
      fromBounds.bottom - fromBounds.top,
    );
    return {
      from: { x: fromBounds.right + CLIP_PADDING, y: fromBounds.top - span * 0.25 },
      control: { x: fromBounds.right + span, y: fromBounds.top - span },
      to: { x: fromBounds.right + span * 0.25, y: fromBounds.top - CLIP_PADDING },
      isLoop: true,
    };
  }

  const [canonicalFrom, canonicalTo] = comparePoints(from, to) <= 0
    ? [from, to]
    : [to, from];
  const hash = stableHash(`${input.edgeId}|${pointKey(canonicalFrom)}|${pointKey(canonicalTo)}`);
  const offset = 12 + hash % 17;
  const sign = hash & 0x1 ? 1 : -1;
  const canonicalDx = canonicalTo.x - canonicalFrom.x;
  const canonicalDy = canonicalTo.y - canonicalFrom.y;
  const canonicalLength = Math.hypot(canonicalDx, canonicalDy);
  const control = {
    x: (canonicalFrom.x + canonicalTo.x) / 2 - canonicalDy / canonicalLength * offset * sign,
    y: (canonicalFrom.y + canonicalTo.y) / 2 + canonicalDx / canonicalLength * offset * sign,
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
  const inverse = 1 - progress;
  return {
    x: inverse * inverse * geometry.from.x +
      2 * inverse * progress * geometry.control.x +
      progress * progress * geometry.to.x,
    y: inverse * inverse * geometry.from.y +
      2 * inverse * progress * geometry.control.y +
      progress * progress * geometry.to.y,
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
