from __future__ import annotations

import unicodedata
from collections.abc import Callable
from urllib.parse import quote

from sqlalchemy import MetaData, Table, select
from sqlalchemy.engine import Engine

from engine.business_fields import business_code_priority
from engine.schema_analyzer import SchemaAnalysisResult, TableSchema

from .models import (
    AnalysisScope,
    EntityDocument,
    EntitySignatureGroup,
)


def load_scoped_records(
    engine: Engine,
    scope: AnalysisScope,
    schema_result: SchemaAnalysisResult,
    *,
    check_deadline: Callable[[str], None] | None = None,
) -> dict[str, list[dict[str, object]]]:
    records: dict[str, list[dict[str, object]]] = {}

    for table_scope in scope.tables:
        _check_deadline(check_deadline, f"读取表 {table_scope.name} 前")
        schema = schema_result.tables[table_scope.name]
        requested = list(table_scope.dimensions)
        requested.extend(
            column.name
            for column in schema.columns
            if column.is_name or column.is_class_name
        )
        requested.extend(
            column.name
            for column in schema.columns
            if business_code_priority(column.name) is not None
        )
        requested.extend(schema.primary_keys)
        for foreign_key in schema.foreign_keys:
            requested.extend(foreign_key.source_columns)
        for foreign_key in schema_result.all_foreign_keys:
            if foreign_key.target_table == table_scope.name:
                requested.extend(foreign_key.target_columns)

        column_names = list(dict.fromkeys(requested))
        _check_deadline(check_deadline, f"读取表 {table_scope.name} 反射前")
        table = Table(
            table_scope.name,
            MetaData(),
            autoload_with=engine,
        )
        _check_deadline(check_deadline, f"读取表 {table_scope.name} 反射后")
        columns = [table.c[name] for name in column_names]

        _check_deadline(check_deadline, f"读取表 {table_scope.name} 连接前")
        with engine.connect() as connection:
            _check_deadline(check_deadline, f"读取表 {table_scope.name} 连接后")
            _check_deadline(check_deadline, f"读取表 {table_scope.name} 执行查询前")
            result = connection.execute(select(*columns))
            _check_deadline(check_deadline, f"读取表 {table_scope.name} 执行查询后")
            records[table_scope.name] = [
                dict(row._mapping) for row in result
            ]
        _check_deadline(check_deadline, f"读取表 {table_scope.name} 后")

    return records


def _check_deadline(
    check_deadline: Callable[[str], None] | None,
    stage: str,
) -> None:
    if check_deadline is not None:
        check_deadline(stage)


def build_entity_documents(
    records: dict[str, list[dict[str, object]]],
    scope: AnalysisScope,
    schema_result: SchemaAnalysisResult | dict[str, list[str]] | None = None,
    class_name_fields: dict[str, str | None] | None = None,
    *,
    pk_metadata: dict[str, list[str]] | None = None,
) -> list[EntityDocument]:
    documents: list[EntityDocument] = []
    if schema_result is None:
        if pk_metadata is None:
            raise TypeError("schema_result is required")
        schema_result = pk_metadata

    for table_scope in scope.tables:
        table_name = table_scope.name
        schema = (
            schema_result.tables[table_name]
            if isinstance(schema_result, SchemaAnalysisResult)
            else None
        )
        if schema is not None:
            name_field, class_name_field = required_field_names(schema)
            primary_keys = schema.primary_keys
        else:
            name_field = None
            class_name_field = (class_name_fields or {}).get(table_name)
            primary_keys = schema_result[table_name]
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
                primary_keys,
            )
            class_name_value = (
                row.get(class_name_field) if class_name_field else None
            )
            if name_field is not None:
                name_value = row.get(name_field)
                display_name = (
                    str(name_value).strip()
                    if name_value is not None and str(name_value).strip()
                    else "未命名对象"
                )
            else:
                display_name = _display_name(
                    dimensions,
                    normalized_dimensions,
                    entity_id,
                )
            class_name = (
                str(class_name_value).strip()
                if class_name_value is not None
                and str(class_name_value).strip()
                else None
            )
            display_code = select_display_code(row, schema) if schema else None
            auxiliary_text = [
                f"{name}：{value}" for name, value in dimensions.items()
            ]

            documents.append(
                EntityDocument(
                    entity_id=entity_id,
                    table_name=table_name,
                    display_name=display_name,
                    display_code=display_code,
                    class_name=class_name,
                    dimensions=dimensions,
                    normalized_dimensions=normalized_dimensions,
                    search_text="；".join(
                        [display_name, class_name or "", *auxiliary_text]
                    ),
                )
            )

    return documents


def required_field_names(schema: TableSchema) -> tuple[str, str]:
    name_field = next((column.name for column in schema.columns if column.is_name), None)
    class_field = next((column.name for column in schema.columns if column.is_class_name), None)
    if name_field is None:
        raise ValueError(f"Table {schema.name} is missing required name field")
    if class_field is None:
        raise ValueError(f"Table {schema.name} is missing required class_name field")
    return name_field, class_field


def select_display_code(row: dict[str, object], schema: TableSchema) -> str | None:
    candidates = sorted(
        (
            (priority, column.name)
            for column in schema.columns
            if (priority := business_code_priority(column.name)) is not None
        ),
        key=lambda item: (item[0], item[1].lower(), item[1]),
    )
    for _, field_name in candidates:
        value = row.get(field_name)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


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
