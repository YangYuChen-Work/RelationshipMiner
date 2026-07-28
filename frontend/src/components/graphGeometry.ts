import type { EdgeData } from "../api/analysis";

type Point = {
  x: number;
  y: number;
};

export function getDirectNeighborIds(
  nodeId: string,
  edges: EdgeData[],
): Set<string> {
  const neighborIds = new Set<string>([nodeId]);

  for (const edge of edges) {
    if (edge.source === nodeId) neighborIds.add(edge.target);
    if (edge.target === nodeId) neighborIds.add(edge.source);
  }

  return neighborIds;
}

export function getVisibleEdgeCount(
  edges: EdgeData[],
  threshold: number,
): number {
  return edges.filter((edge) => edge.confidence >= threshold).length;
}

export function getRectBoundaryPoint(
  source: Point,
  target: Point,
  halfWidth: number,
  halfHeight: number,
): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;

  if (dx === 0 && dy === 0) return { ...source };

  const scale =
    1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight);

  return {
    x: source.x + dx * scale,
    y: source.y + dy * scale,
  };
}
