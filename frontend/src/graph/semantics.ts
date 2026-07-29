import type {
  EntityEdgeData,
  EntityNodeData,
  EntityRelationData,
} from "../api/analysis";

export function relationIsVisible(
  relation: EntityRelationData,
  confidenceThreshold: number,
): boolean {
  return relation.strength === "strong" ||
    (Number.isFinite(relation.confidence) &&
      relation.confidence >= confidenceThreshold);
}

export function visibleEntityRelations(
  edge: EntityEdgeData,
  confidenceThreshold: number,
): EntityRelationData[] {
  return edge.relations.filter((relation) =>
    relationIsVisible(relation, confidenceThreshold)
  );
}

export function computeEntityDegrees(
  entities: readonly EntityNodeData[],
  edges: readonly EntityEdgeData[],
): Map<string, number> {
  const entityIds = new Set(entities.map((entity) => entity.id));
  const degrees = new Map(entities.map((entity) => [entity.id, 0]));
  for (const edge of edges) {
    if (!entityIds.has(edge.source) || !entityIds.has(edge.target)) continue;
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    if (edge.target !== edge.source) {
      degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
    }
  }
  return degrees;
}
