import type { EntityEdgeData } from "../api/analysis";
import { visibleEntityRelations } from "./semantics";

export interface GraphFocusIndex {
  readonly neighborsByNode: ReadonlyMap<string, ReadonlySet<string>>;
  readonly edgeIdsByNode: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface GraphFocus {
  readonly activeNodeId: string | null;
  readonly nodeIds: ReadonlySet<string>;
  readonly edgeIds: ReadonlySet<string>;
}

function addToIndex(
  index: Map<string, Set<string>>,
  nodeId: string,
  value: string,
): void {
  const values = index.get(nodeId) ?? new Set<string>();
  values.add(value);
  index.set(nodeId, values);
}

function immutableSet(values: Iterable<string>): ReadonlySet<string> {
  const set = new Set(values);
  return new Proxy(set, {
    get(target, property) {
      if (property === "add" || property === "delete" || property === "clear") {
        return undefined;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlySet<string>;
}

function immutableMap<T>(
  entries: Iterable<readonly [string, T]>,
): ReadonlyMap<string, T> {
  const map = new Map(entries);
  return new Proxy(map, {
    get(target, property) {
      if (property === "set" || property === "delete" || property === "clear") {
        return undefined;
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as ReadonlyMap<string, T>;
}

export function buildGraphFocusIndex(
  edges: readonly EntityEdgeData[],
  confidenceThreshold: number,
): GraphFocusIndex {
  const neighborsByNode = new Map<string, Set<string>>();
  const edgeIdsByNode = new Map<string, Set<string>>();

  for (const edge of edges) {
    if (visibleEntityRelations(edge, confidenceThreshold).length === 0) continue;

    addToIndex(neighborsByNode, edge.source, edge.target);
    addToIndex(neighborsByNode, edge.target, edge.source);
    addToIndex(edgeIdsByNode, edge.source, edge.id);
    addToIndex(edgeIdsByNode, edge.target, edge.id);
  }

  return {
    neighborsByNode: immutableMap(
      [...neighborsByNode].map(([nodeId, neighbors]) =>
        [nodeId, immutableSet(neighbors)] as const
      ),
    ),
    edgeIdsByNode: immutableMap(
      [...edgeIdsByNode].map(([nodeId, edgeIds]) =>
        [nodeId, immutableSet(edgeIds)] as const
      ),
    ),
  };
}

export function resolveGraphFocus(
  index: GraphFocusIndex,
  hoveredNodeId: string | null,
  selectedNodeId: string | null,
): GraphFocus {
  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  if (activeNodeId == null) {
    return { activeNodeId: null, nodeIds: immutableSet([]), edgeIds: immutableSet([]) };
  }

  return {
    activeNodeId,
    nodeIds: immutableSet([activeNodeId, ...(index.neighborsByNode.get(activeNodeId) ?? [])]),
    edgeIds: immutableSet(index.edgeIdsByNode.get(activeNodeId) ?? []),
  };
}
