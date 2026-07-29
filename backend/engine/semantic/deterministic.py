from __future__ import annotations

from engine.relationship_computer import FKConstraint
from engine.schema_analyzer import SchemaAnalysisResult, TableSchema

from .corpus import _entity_id, _normalize_value
from .models import (
    EntityEdge,
    EntityRelation,
    RelationshipPlan,
    RelationEvidence,
)


def build_fk_edges(
    records: dict[str, list[dict[str, object]]],
    pk_metadata: dict[str, list[str]],
    fk_constraints: list[FKConstraint],
) -> list[EntityEdge]:
    edges: list[EntityEdge] = []

    for foreign_key in fk_constraints:
        target_rows = records.get(foreign_key.target_table, [])
        target_index = {
            tuple(row[column] for column in foreign_key.target_columns): row
            for row in target_rows
            if all(
                row.get(column) is not None
                for column in foreign_key.target_columns
            )
        }

        for source_row in records.get(foreign_key.source_table, []):
            source_values = tuple(
                source_row[column]
                for column in foreign_key.source_columns
            )
            if any(value is None for value in source_values):
                continue

            target_row = target_index.get(source_values)
            if target_row is None:
                continue

            source_id = _entity_id(
                foreign_key.source_table,
                source_row,
                pk_metadata[foreign_key.source_table],
            )
            target_id = _entity_id(
                foreign_key.target_table,
                target_row,
                pk_metadata[foreign_key.target_table],
            )
            evidence = [
                RelationEvidence(
                    source_field=source_column,
                    source_value=source_row[source_column],
                    target_field=target_column,
                    target_value=target_row[target_column],
                    method="foreign_key",
                    reason=(
                        f"{foreign_key.source_table}.{source_column} "
                        f"references "
                        f"{foreign_key.target_table}.{target_column}"
                    ),
                )
                for source_column, target_column in zip(
                    foreign_key.source_columns,
                    foreign_key.target_columns,
                    strict=True,
                )
            ]
            relation = EntityRelation(
                source=source_id,
                target=target_id,
                relation_type="外键关联",
                direction="source_to_target",
                strength="strong",
                confidence=1.0,
                explanation=(
                    f"{foreign_key.source_table} declares a foreign key "
                    f"to {foreign_key.target_table}"
                ),
                evidence=evidence,
            )
            edges.append(
                EntityEdge(
                    id=f"{source_id}->{target_id}",
                    source=source_id,
                    target=target_id,
                    relations=[relation],
                )
            )

    return edges


def build_unique_identifier_edges(
    records: dict[str, list[dict[str, object]]],
    schema_result: SchemaAnalysisResult,
    plans: list[RelationshipPlan] | None,
) -> list[EntityEdge]:
    edges: list[EntityEdge] = []

    for plan in plans or []:
        if (
            len(plan.source_dimensions) != 1
            or len(plan.target_dimensions) != 1
        ):
            continue

        source_field = plan.source_dimensions[0]
        target_field = plan.target_dimensions[0]
        source_schema = schema_result.tables.get(plan.source_table)
        target_schema = schema_result.tables.get(plan.target_table)
        if (
            source_schema is None
            or target_schema is None
            or not _is_single_column_identifier(
                source_schema,
                source_field,
            )
            or not _is_single_column_identifier(
                target_schema,
                target_field,
            )
        ):
            continue

        target_index = {
            _normalize_value(row[target_field]): row
            for row in records.get(plan.target_table, [])
            if row.get(target_field) is not None
        }
        for source_row in records.get(plan.source_table, []):
            source_value = source_row.get(source_field)
            if source_value is None:
                continue

            target_row = target_index.get(_normalize_value(source_value))
            if target_row is None:
                continue

            source_id = _entity_id(
                plan.source_table,
                source_row,
                schema_result.pk_metadata[plan.source_table],
            )
            target_id = _entity_id(
                plan.target_table,
                target_row,
                schema_result.pk_metadata[plan.target_table],
            )
            relation = EntityRelation(
                source=source_id,
                target=target_id,
                relation_type=plan.relation_type,
                direction=plan.direction,
                strength="strong",
                confidence=1.0,
                explanation=plan.reason,
                evidence=[
                    RelationEvidence(
                        source_field=source_field,
                        source_value=source_value,
                        target_field=target_field,
                        target_value=target_row[target_field],
                        method="unique_identifier",
                        reason=plan.reason,
                    )
                ],
            )
            edges.append(
                EntityEdge(
                    id=f"{source_id}->{target_id}",
                    source=source_id,
                    target=target_id,
                    relations=[relation],
                )
            )

    return edges


def _is_single_column_identifier(
    table_schema: TableSchema,
    field_name: str,
) -> bool:
    if table_schema.primary_keys == [field_name]:
        return True

    return any(
        index.unique and index.columns == [field_name]
        for index in table_schema.indexes
    )
