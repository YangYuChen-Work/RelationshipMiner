from __future__ import annotations

import unicodedata
from urllib.parse import quote

from sqlalchemy import MetaData, Table, select
from sqlalchemy.engine import Engine

from engine.schema_analyzer import SchemaAnalysisResult

from .models import (
    AnalysisScope,
    EntityDocument,
    EntitySignatureGroup,
)


def load_scoped_records(
    engine: Engine,
    scope: AnalysisScope,
    schema_result: SchemaAnalysisResult,
) -> dict[str, list[dict[str, object]]]:
    records: dict[str, list[dict[str, object]]] = {}

    for table_scope in scope.tables:
        schema = schema_result.tables[table_scope.name]
        requested = list(table_scope.dimensions)
        requested.extend(schema.primary_keys)
        for foreign_key in schema.foreign_keys:
            requested.extend(foreign_key.source_columns)
        for foreign_key in schema_result.all_foreign_keys:
            if foreign_key.target_table == table_scope.name:
                requested.extend(foreign_key.target_columns)

        class_name_field = next(
            (
                column.name
                for column in schema.columns
                if column.is_class_name
            ),
            None,
        )
        if class_name_field:
            requested.append(class_name_field)

        column_names = list(dict.fromkeys(requested))
        table = Table(
            table_scope.name,
            MetaData(),
            autoload_with=engine,
        )
        columns = [table.c[name] for name in column_names]

        with engine.connect() as connection:
            result = connection.execute(select(*columns))
            records[table_scope.name] = [
                dict(row._mapping) for row in result
            ]

    return records


def build_entity_documents(
    records: dict[str, list[dict[str, object]]],
    scope: AnalysisScope,
    pk_metadata: dict[str, list[str]],
    class_name_fields: dict[str, str | None],
) -> list[EntityDocument]:
    documents: list[EntityDocument] = []

    for table_scope in scope.tables:
        table_name = table_scope.name
        for row in records.get(table_name, []):
            dimensions = {
                name: row[name] for name in table_scope.dimensions
            }
            normalized_dimensions = {
                name: _normalize_value(value)
                for name, value in dimensions.items()
            }
            entity_id = _entity_id(
                table_name,
                row,
                pk_metadata[table_name],
            )
            class_name_field = class_name_fields.get(table_name)
            class_name_value = (
                row.get(class_name_field) if class_name_field else None
            )

            documents.append(
                EntityDocument(
                    entity_id=entity_id,
                    table_name=table_name,
                    display_name=_display_name(
                        dimensions,
                        normalized_dimensions,
                        entity_id,
                    ),
                    class_name=(
                        str(class_name_value)
                        if class_name_value is not None
                        else None
                    ),
                    dimensions=dimensions,
                    normalized_dimensions=normalized_dimensions,
                    search_text="；".join(
                        f"{name}：{value}"
                        for name, value in dimensions.items()
                    ),
                )
            )

    return documents


def group_documents_by_signature(
    documents: list[EntityDocument],
) -> list[EntitySignatureGroup]:
    groups: dict[
        tuple[str, tuple[tuple[str, str], ...]],
        EntitySignatureGroup,
    ] = {}

    for document in documents:
        signature = (
            document.table_name,
            tuple(sorted(document.normalized_dimensions.items())),
        )
        group = groups.get(signature)
        if group is None:
            groups[signature] = EntitySignatureGroup(
                representative=document,
                entity_ids=[document.entity_id],
            )
        else:
            group.entity_ids.append(document.entity_id)

    return list(groups.values())


def _normalize_value(value: object) -> str:
    normalized = unicodedata.normalize(
        "NFKC",
        "" if value is None else str(value),
    )
    normalized = "".join(
        character.lower()
        if "LATIN" in unicodedata.name(character, "")
        else character
        for character in normalized
    )
    return "".join(normalized.strip().split())


def _entity_id(
    table_name: str,
    row: dict[str, object],
    primary_keys: list[str],
) -> str:
    encoded_table = quote(table_name, safe="")
    identity = "|".join(
        quote(str(row[column]), safe="") for column in primary_keys
    )
    return f"{encoded_table}:{identity}"


def _display_name(
    dimensions: dict[str, object],
    normalized_dimensions: dict[str, str],
    entity_id: str,
) -> str:
    for name, value in dimensions.items():
        if normalized_dimensions[name]:
            return str(value)
    return entity_id
