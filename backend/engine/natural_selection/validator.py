"""Deterministically validate and expand structured model selections."""

from __future__ import annotations

from .models import (
    CatalogSnapshot,
    CatalogTable,
    ModelSelection,
    ValidatedSelection,
    ValidatedTableSelection,
)


class ClarificationRequired(ValueError):
    """The request is ambiguous enough that the user must clarify it."""

    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


class InvalidModelOutput(ValueError):
    """The model returned malformed, duplicated, or invented metadata."""

    def __init__(self, reason_code: str = "INVALID_MODEL_OUTPUT") -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


def allowed_auxiliary_fields(table: CatalogTable) -> list[str]:
    """Return every field which is safe to expose as an auxiliary field."""

    return [
        column.name
        for column in table.columns
        if not column.is_name
        and not column.is_class_name
        and not column.is_primary_key
        and not column.is_foreign_key
    ]


def validate_model_selection(
    output: ModelSelection,
    snapshot: CatalogSnapshot,
) -> ValidatedSelection:
    """Validate one model selection against exactly one catalog snapshot."""

    if len(output.tables) > 10:
        raise ClarificationRequired("SCOPE_TOO_BROAD")

    tables_by_name = {table.name: table for table in snapshot.tables}
    selected: list[ValidatedTableSelection] = []
    seen_tables: set[str] = set()
    for item in output.tables:
        if item.table_name in seen_tables or item.table_name not in tables_by_name:
            raise InvalidModelOutput()
        seen_tables.add(item.table_name)

        allowed = allowed_auxiliary_fields(tables_by_name[item.table_name])
        if item.field_selection == "all":
            fields = allowed
        elif (
            item.field_selection == "specified"
            and len(item.auxiliary_fields) == len(set(item.auxiliary_fields))
            and set(item.auxiliary_fields).issubset(allowed)
        ):
            fields = item.auxiliary_fields
        else:
            raise InvalidModelOutput()

        selected.append(
            ValidatedTableSelection(
                name=item.table_name,
                auxiliary_fields=fields,
                reason=item.reason,
            )
        )

    if not selected:
        raise ClarificationRequired("NO_RELIABLE_MATCH")
    return ValidatedSelection(tables=selected)
