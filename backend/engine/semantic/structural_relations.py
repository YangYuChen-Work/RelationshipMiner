from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from itertools import permutations

from sqlalchemy import MetaData, Table, bindparam, inspect, select
from sqlalchemy.engine import Engine

from engine.schema_analyzer import SchemaAnalysisResult

from .corpus import _entity_id
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
    ("MEProcess", "MEOperation"): "包含工序",
}
_DEFAULT_RELATION_TYPE = "关系表关联"


def build_relation_table_edges(
    engine: Engine,
    records: dict[str, list[dict[str, object]]],
    schema_result: SchemaAnalysisResult,
    documents: list[EntityDocument],
    check_deadline: Callable[[str], None] | None = None,
) -> list[EntityEdge]:
    """Resolve selected entities through supported generic relation tables."""
    _check_deadline(check_deadline, "发现关系表前")
    relation_tables = _discover_relation_tables(engine)
    _check_deadline(check_deadline, "发现关系表后")
    endpoint_indexes = _build_endpoint_indexes(
        records,
        schema_result,
        documents,
    )
    edges: dict[tuple[str, str], EntityEdge] = {}

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
                    if key in edges:
                        continue
                    relation_type = _RELATION_TYPES.get(
                        (left_class, right_class),
                        _DEFAULT_RELATION_TYPE,
                    )
                    relation = EntityRelation(
                        source=source.entity_id,
                        target=target.entity_id,
                        relation_type=relation_type,
                        direction="source_to_target",
                        strength="strong",
                        confidence=1.0,
                        explanation=(
                            f"{table_name} records {left_class} to "
                            f"{right_class}"
                        ),
                        evidence=[
                            RelationEvidence(
                                source_field="left_id",
                                source_value=row["left_id"],
                                target_field="right_id",
                                target_value=row["right_id"],
                                method="relation_table",
                                reason=(
                                    f"{table_name} records {left_class} to "
                                    f"{right_class}"
                                ),
                            )
                        ],
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
