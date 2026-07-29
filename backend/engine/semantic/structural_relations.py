from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from itertools import permutations

from sqlalchemy import MetaData, Table, bindparam, inspect, select
from sqlalchemy.engine import Engine

from engine.schema_analyzer import SchemaAnalysisResult

from .corpus import _entity_id
from .deadline import DeadlineExceeded
from .models import EntityDocument, EntityEdge, EntityRelation, RelationEvidence


_RELATION_SOURCE_NAMES = {
    "bom_temp_view_data",
    "metargetrl",
    "relation_id",
}
_REQUIRED_COLUMNS = {
    "left_id",
    "right_id",
    "left_class",
    "right_class",
}
_RELATION_TYPES = {
    frozenset(("MEProcess", "MEOperation")): "包含工序",
    frozenset(("MEOperation", "MEStep")): "包含工步",
}
_MATERIAL_RELATION_TYPE = "关联物料"
_DEFAULT_RELATION_TYPE = "关系表关联"


class StructuralRelationResolutionError(RuntimeError):
    """Expose relation-table edges resolved before an internal failure."""

    def __init__(
        self,
        resolved_edges: list[EntityEdge],
    ) -> None:
        self.resolved_edges = resolved_edges
        super().__init__("Structural relation discovery failed.")


class StructuralRelationDeadlineExceeded(DeadlineExceeded):
    """Expose relation-table edges resolved before a deadline."""

    def __init__(
        self,
        stage: str,
        resolved_edges: list[EntityEdge],
    ) -> None:
        self.resolved_edges = resolved_edges
        super().__init__(stage)


def build_relation_table_edges(
    engine: Engine,
    records: dict[str, list[dict[str, object]]],
    schema_result: SchemaAnalysisResult,
    documents: list[EntityDocument],
    check_deadline: Callable[[str], None] | None = None,
) -> list[EntityEdge]:
    """Resolve relation-table edges and expose any resolved before failure."""
    edges: dict[tuple[str, str], EntityEdge] = {}
    try:
        return _resolve_relation_table_edges(
            engine,
            records,
            schema_result,
            documents,
            edges,
            check_deadline,
        )
    except DeadlineExceeded as error:
        raise StructuralRelationDeadlineExceeded(
            error.stage,
            list(edges.values()),
        ) from error
    except Exception as error:
        raise StructuralRelationResolutionError(
            list(edges.values()),
        ) from error


def _resolve_relation_table_edges(
    engine: Engine,
    records: dict[str, list[dict[str, object]]],
    schema_result: SchemaAnalysisResult,
    documents: list[EntityDocument],
    edges: dict[tuple[str, str], EntityEdge],
    check_deadline: Callable[[str], None] | None,
) -> list[EntityEdge]:
    _check_deadline(check_deadline, "发现关系表前")
    relation_tables = _discover_relation_tables(engine)
    _check_deadline(check_deadline, "发现关系表后")
    endpoint_indexes = _build_endpoint_indexes(
        records,
        schema_result,
        documents,
    )

    for table_name in relation_tables:
        _check_deadline(check_deadline, f"读取关系表 {table_name} 前")
        relation_table = Table(
            table_name,
            MetaData(),
            autoload_with=engine,
        )
        for left_class, right_class in permutations(endpoint_indexes, 2):
            statement = (
                select(
                    relation_table.c.left_id,
                    relation_table.c.right_id,
                    relation_table.c.left_class,
                    relation_table.c.right_class,
                )
                .where(
                    relation_table.c.left_class
                    == bindparam("left_class"),
                    relation_table.c.right_class
                    == bindparam("right_class"),
                )
            )
            with engine.connect() as connection:
                rows = connection.execute(
                    statement,
                    {
                        "left_class": left_class,
                        "right_class": right_class,
                    },
                )
                for row in rows.mappings():
                    source = _resolve_endpoint(
                        endpoint_indexes,
                        row["left_class"],
                        row["left_id"],
                    )
                    target = _resolve_endpoint(
                        endpoint_indexes,
                        row["right_class"],
                        row["right_id"],
                    )
                    if source is None or target is None:
                        continue

                    key = tuple(sorted((source.entity_id, target.entity_id)))
                    reason = (
                        f"{table_name} records {left_class} to {right_class}"
                    )
                    evidence = RelationEvidence(
                        source_field="left_id",
                        source_value=row["left_id"],
                        target_field="right_id",
                        target_value=row["right_id"],
                        method="relation_table",
                        reason=reason,
                    )
                    existing_edge = edges.get(key)
                    if existing_edge is not None:
                        existing_evidence = existing_edge.relations[0].evidence
                        if evidence not in existing_evidence:
                            existing_evidence.append(evidence)
                        continue
                    class_pair = frozenset((left_class, right_class))
                    relation_type = (
                        _MATERIAL_RELATION_TYPE
                        if "Assembly" in class_pair
                        else _RELATION_TYPES.get(
                            class_pair,
                            _DEFAULT_RELATION_TYPE,
                        )
                    )
                    relation = EntityRelation(
                        source=source.entity_id,
                        target=target.entity_id,
                        relation_type=relation_type,
                        direction="source_to_target",
                        strength="strong",
                        confidence=1.0,
                        explanation=reason,
                        evidence=[evidence],
                    )
                    edges[key] = EntityEdge(
                        id=f"{source.entity_id}->{target.entity_id}",
                        source=source.entity_id,
                        target=target.entity_id,
                        relations=[relation],
                    )
        _check_deadline(check_deadline, f"读取关系表 {table_name} 后")

    return list(edges.values())


def _discover_relation_tables(engine: Engine) -> list[str]:
    inspector = inspect(engine)
    return [
        table_name
        for table_name in inspector.get_table_names()
        if table_name.lower() in _RELATION_SOURCE_NAMES
        and _REQUIRED_COLUMNS.issubset(
            {column["name"] for column in inspector.get_columns(table_name)}
        )
    ]


def _build_endpoint_indexes(
    records: dict[str, list[dict[str, object]]],
    schema_result: SchemaAnalysisResult,
    documents: list[EntityDocument],
) -> dict[str, dict[str, list[EntityDocument]]]:
    documents_by_id = {document.entity_id: document for document in documents}
    endpoint_indexes: dict[str, dict[str, list[EntityDocument]]] = defaultdict(
        lambda: defaultdict(list)
    )

    for table_name, rows in records.items():
        primary_keys = schema_result.pk_metadata.get(table_name, [])
        if len(primary_keys) != 1:
            continue
        primary_key = primary_keys[0]
        for row in rows:
            if row.get(primary_key) is None:
                continue
            entity_id = _entity_id(table_name, row, primary_keys)
            document = documents_by_id.get(entity_id)
            if document is None or document.class_name is None:
                continue
            endpoint_indexes[document.class_name][str(row[primary_key])].append(
                document
            )

    return endpoint_indexes


def _resolve_endpoint(
    endpoint_indexes: dict[str, dict[str, list[EntityDocument]]],
    class_name: object,
    identifier: object,
) -> EntityDocument | None:
    if class_name is None or identifier is None:
        return None
    matches = endpoint_indexes.get(str(class_name), {}).get(str(identifier), [])
    return matches[0] if len(matches) == 1 else None


def _check_deadline(
    check_deadline: Callable[[str], None] | None,
    stage: str,
) -> None:
    if check_deadline is not None:
        check_deadline(stage)
