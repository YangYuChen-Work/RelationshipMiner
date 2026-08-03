import type {
  EntityEdgeData,
  EntityRelationData,
  SemanticGraphData,
  TableEdgeData,
} from "../api/analysis";

const TABLE_LABELS = [
  "总装测试",
  "反射器组件",
  "物料目录",
  "天线性能",
] as const;

const ENTITY_LABELS = [
  "总装测试",
  "反射器组件",
  "ITEM0000400",
  "高增益抛物面天线",
] as const;

function entityId(index: number): string {
  return `entity-${String(index).padStart(3, "0")}`;
}

function relation(
  source: string,
  target: string,
  relationType: string,
  strength: "strong" | "weak",
): EntityRelationData {
  const displayLabel = source === "entity-001" && target === "entity-002"
    ? "用于检验"
    : relationType === "self_check"
      ? "自检"
      : relationType === "cross_table_bridge"
        ? "跨域关联"
        : "包含";
  return {
    source,
    target,
    relation_type: relationType,
    display_label: displayLabel,
    direction: source === target ? "undirected" : "source_to_target",
    strength,
    confidence: strength === "strong" ? 0.96 : 0.42,
    explanation: `Deterministic ${strength} fixture relation.`,
    evidence: [],
    model_id: null,
    task_id: null,
  };
}

function addEdge(
  edges: EntityEdgeData[],
  sourceIndex: number,
  targetIndex: number,
  relationType: string,
  strength: "strong" | "weak",
): EntityEdgeData {
  const source = entityId(sourceIndex);
  const target = entityId(targetIndex);
  const edge = {
    id: `edge-${String(edges.length).padStart(3, "0")}`,
    source,
    target,
    relations: [relation(source, target, relationType, strength)],
  };
  edges.push(edge);
  return edge;
}

function tableFor(index: number, entityCount: number): number {
  const tableSize = entityCount / 4;
  return Math.min(3, Math.floor(index / tableSize));
}

function aggregateBridge(
  id: string,
  sourceTable: number,
  targetTable: number,
  supportingEdge: EntityEdgeData,
): TableEdgeData {
  const strongCount = supportingEdge.relations[0].strength === "strong" ? 1 : 0;
  return {
    id,
    source_table: `table-${sourceTable}`,
    target_table: `table-${targetTable}`,
    relation_types: ["cross_table_bridge"],
    strong_count: strongCount,
    weak_count: 1 - strongCount,
    entity_edge_count: 1,
    average_confidence: supportingEdge.relations[0].confidence,
    supporting_entity_edges: [supportingEdge.id],
  };
}

export function makeNebulaGraph(options: {
  entityCount: 20 | 200;
}): SemanticGraphData {
  const { entityCount } = options;
  const tableSize = entityCount / 4;
  const entityNodes = Array.from({ length: entityCount }, (_, index) => {
    const tableIndex = tableFor(index, entityCount);
    const zeroBacked = index % 10 === 0;
    const defaultDimensions = zeroBacked
      ? index % 20 === 0
        ? { name: ENTITY_LABELS[tableIndex], fixture_index: index }
        : { item_code: `ITEM${String(400 + index).padStart(7, "0")}`, fixture_index: index }
      : {
        item_code: `ITEM${String(400 + index).padStart(7, "0")}`,
        name: `${ENTITY_LABELS[tableIndex]} ${index}`,
        fixture_index: index,
      };
    const businessIdentity = index === 0 || index === 1
      ? {
        displayName: index === 0 ? "0" : "通信天线装配",
        displayCode: index === 0 ? "GY0000203" : "GY0000204",
        dimensions: { ...defaultDimensions, name: "通信天线装配" },
      }
      : index === 2
        ? {
          displayName: "电性能综合测试",
          displayCode: undefined,
          dimensions: { ...defaultDimensions, name: "电性能综合测试" },
        }
        : index === 3
          ? {
            displayName: "总装测试",
            displayCode: undefined,
            dimensions: { ...defaultDimensions, name: "总装测试" },
          }
          : {
            displayName: zeroBacked ? "0" : `${ENTITY_LABELS[tableIndex]} ${index}`,
            displayCode: undefined,
            dimensions: defaultDimensions,
          };
    return {
      id: entityId(index),
      table_id: `table-${tableIndex}`,
      display_name: businessIdentity.displayName,
      display_code: businessIdentity.displayCode,
      class_name: `com.example.nebula.${[
        "AssemblyTest",
        "ReflectorComponent",
        "InventoryItem",
        "HighGainAntenna",
      ][tableIndex]}`,
      dimensions: businessIdentity.dimensions,
    };
  });

  const entityEdges: EntityEdgeData[] = [];
  for (let tableIndex = 0; tableIndex < 4; tableIndex += 1) {
    const start = tableIndex * tableSize;
    for (let offset = 0; offset < tableSize - 1; offset += 1) {
      addEdge(
        entityEdges,
        start + offset,
        start + offset + 1,
        "",
        offset % 4 === 3 ? "weak" : "strong",
      );
    }
  }

  const firstBridge = addEdge(
    entityEdges,
    tableSize - 1,
    tableSize,
    "cross_table_bridge",
    "strong",
  );
  const secondBridge = addEdge(
    entityEdges,
    tableSize * 3 - 1,
    tableSize * 3,
    "cross_table_bridge",
    "weak",
  );
  addEdge(entityEdges, 0, 0, "self_check", "strong");

  return {
    table_nodes: TABLE_LABELS.map((displayName, index) => ({
      id: `table-${index}`,
      display_name: displayName,
      entity_count: tableSize,
    })),
    entity_nodes: entityNodes,
    table_edges: [
      aggregateBridge("table-edge-0", 0, 1, firstBridge),
      aggregateBridge("table-edge-1", 2, 3, secondBridge),
    ],
    entity_edges: entityEdges,
  };
}
