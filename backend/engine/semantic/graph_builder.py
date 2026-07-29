from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
import json

from .models import (
    EntityDocument,
    EntityEdge,
    EntityNode,
    EntityRelation,
    RelationDecision,
    TableEdge,
    TableNode,
)
from .public_json import public_json_value


def build_graph(
    entity_documents: list[EntityDocument],
    deterministic_edges: list[EntityEdge],
    relation_decisions: list[RelationDecision],
    *,
    check_deadline: Callable[[str], None] | None = None,
) -> tuple[
    list[TableNode],
    list[EntityNode],
    list[TableEdge],
    list[EntityEdge],
]:
    """Build display nodes and evidence-preserving relationship edges."""
    _check_deadline(check_deadline, "组装图谱前")
    documents_by_id = _index_documents(entity_documents, check_deadline)
    entity_nodes: list[EntityNode] = []
    for document in sorted(
        documents_by_id.values(), key=lambda document: document.entity_id
    ):
        _check_deadline(check_deadline, "构建实体节点时")
        entity_nodes.append(
            EntityNode(
                id=document.entity_id,
                table_id=document.table_name,
                display_name=document.display_name,
                class_name=document.class_name,
                dimensions=document.dimensions,
            )
        )
    table_nodes = _build_table_nodes(entity_nodes, check_deadline)
    entity_edges = _merge_entity_edges(
        deterministic_edges,
        relation_decisions,
        documents_by_id,
        check_deadline,
    )
    table_edges = _build_table_edges(
        entity_edges, documents_by_id, check_deadline
    )
    return table_nodes, entity_nodes, table_edges, entity_edges


def _build_table_nodes(
    entity_nodes: list[EntityNode],
    check_deadline: Callable[[str], None] | None = None,
) -> list[TableNode]:
    entity_counts: dict[str, int] = defaultdict(int)
    for node in entity_nodes:
        _check_deadline(check_deadline, "聚合表节点时")
        entity_counts[node.table_id] += 1
    return [
        TableNode(
            id=table_id,
            display_name=table_id,
            entity_count=entity_counts[table_id],
        )
        for table_id in sorted(entity_counts)
    ]


def _index_documents(
    entity_documents: list[EntityDocument],
    check_deadline: Callable[[str], None] | None = None,
) -> dict[str, EntityDocument]:
    documents_by_id: dict[str, EntityDocument] = {}
    for document in entity_documents:
        _check_deadline(check_deadline, "索引实体文档时")
        existing_document = documents_by_id.get(document.entity_id)
        if existing_document is None:
            documents_by_id[document.entity_id] = document
        elif existing_document != document:
            raise ValueError(
                "Conflicting entity documents for ID: "
                f"{document.entity_id}"
            )
    return documents_by_id


def _merge_entity_edges(
    deterministic_edges: list[EntityEdge],
    relation_decisions: list[RelationDecision],
    documents_by_id: dict[str, EntityDocument],
    check_deadline: Callable[[str], None] | None = None,
) -> list[EntityEdge]:
    relations_by_pair: dict[tuple[str, str], list[EntityRelation]] = (
        defaultdict(list)
    )

    for edge in deterministic_edges:
        _check_deadline(check_deadline, "合并确定性关系时")
        _validate_relation_entities(edge.source, edge.target, documents_by_id)
        pair = _canonical_pair(edge.source, edge.target)
        relations_by_pair[pair].extend(edge.relations)

    for decision in relation_decisions:
        _check_deadline(check_deadline, "合并语义关系时")
        _validate_relation_entities(
            decision.source, decision.target, documents_by_id
        )
        pair = _canonical_pair(decision.source, decision.target)
        relations_by_pair[pair].append(EntityRelation(**decision.model_dump()))

    entity_edges: list[EntityEdge] = []
    for source, target in sorted(relations_by_pair):
        _check_deadline(check_deadline, "生成实体关系边时")
        entity_edges.append(EntityEdge(
            id=_edge_id("entity", source, target),
            source=source,
            target=target,
            relations=sorted(
                relations_by_pair[(source, target)],
                key=_relation_sort_key,
            ),
        ))
    return entity_edges


def _build_table_edges(
    entity_edges: list[EntityEdge],
    documents_by_id: dict[str, EntityDocument],
    check_deadline: Callable[[str], None] | None = None,
) -> list[TableEdge]:
    relations_by_tables: dict[
        tuple[str, str], list[tuple[str, EntityRelation]]
    ] = defaultdict(list)
    for entity_edge in entity_edges:
        _check_deadline(check_deadline, "聚合表关系时")
        source_table = documents_by_id[entity_edge.source].table_name
        target_table = documents_by_id[entity_edge.target].table_name
        if source_table == target_table:
            continue
        table_pair = _canonical_pair(source_table, target_table)
        relations_by_tables[table_pair].extend(
            (entity_edge.id, relation) for relation in entity_edge.relations
        )

    table_edges: list[TableEdge] = []
    for (source_table, target_table), supporting_relations in sorted(
        relations_by_tables.items()
    ):
        _check_deadline(check_deadline, "生成表关系边时")
        if not _should_show_table_edge(supporting_relations):
            continue
        relation_types = sorted(
            {relation.relation_type for _, relation in supporting_relations}
        )
        supporting_entity_edges = sorted(
            {entity_edge_id for entity_edge_id, _ in supporting_relations}
        )
        relations = [relation for _, relation in supporting_relations]
        table_edges.append(
            TableEdge(
                id=_edge_id("table", source_table, target_table),
                source_table=source_table,
                target_table=target_table,
                relation_types=relation_types,
                strong_count=sum(
                    relation.strength == "strong" for relation in relations
                ),
                weak_count=sum(
                    relation.strength == "weak" for relation in relations
                ),
                entity_edge_count=len(supporting_entity_edges),
                average_confidence=round(
                    sum(relation.confidence for relation in relations)
                    / len(relations),
                    12,
                ),
                supporting_entity_edges=supporting_entity_edges,
            )
        )
    return table_edges


def _should_show_table_edge(
    supporting_relations: list[tuple[str, EntityRelation]],
) -> bool:
    if any(
        relation.strength == "strong" for _, relation in supporting_relations
    ):
        return True
    weak_counts_by_type: dict[str, int] = defaultdict(int)
    for _, relation in supporting_relations:
        if relation.strength == "weak":
            weak_counts_by_type[relation.relation_type] += 1
    return any(count >= 3 for count in weak_counts_by_type.values())


def _canonical_pair(source: str, target: str) -> tuple[str, str]:
    first, second = sorted((source, target))
    return first, second


def _edge_id(kind: str, source: str, target: str) -> str:
    return f"{kind}:{len(source)}:{source}{len(target)}:{target}"


def _relation_sort_key(relation: EntityRelation) -> str:
    return json.dumps(
        public_json_value(relation.model_dump(mode="python")),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _validate_relation_entities(
    source: str,
    target: str,
    documents_by_id: dict[str, EntityDocument],
) -> None:
    missing_entities = [
        entity_id
        for entity_id in (source, target)
        if entity_id not in documents_by_id
    ]
    if missing_entities:
        raise ValueError(
            "Relationships must reference supplied entity documents: "
            + ", ".join(missing_entities)
        )


def _check_deadline(
    check_deadline: Callable[[str], None] | None,
    stage: str,
) -> None:
    if check_deadline is not None:
        check_deadline(stage)
