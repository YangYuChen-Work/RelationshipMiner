import pytest

from engine.natural_selection.catalog import build_catalog_snapshot
from engine.natural_selection.models import (
    CatalogColumn,
    CatalogSnapshot,
    CatalogTable,
    ModelSelection,
    ModelTableSelection,
)
from engine.natural_selection.validator import (
    ClarificationRequired,
    InvalidModelOutput,
    validate_model_selection,
)


@pytest.fixture
def snapshot(engine):
    return build_catalog_snapshot(engine)


def selection(
    table_name: str,
    field_selection: str,
    auxiliary_fields: list[str],
) -> ModelSelection:
    return ModelSelection(
        status="selected",
        tables=[
            ModelTableSelection(
                table_name=table_name,
                field_selection=field_selection,
                auxiliary_fields=auxiliary_fields,
                reason="Relevant business data.",
            )
        ],
    )


def test_all_field_selection_expands_only_legal_auxiliary_fields(snapshot) -> None:
    result = validate_model_selection(
        selection("orders", "all", []),
        snapshot,
    )

    assert result.tables[0].auxiliary_fields == ["amount"]


def test_all_field_selection_has_no_auxiliary_field_count_limit() -> None:
    snapshot = CatalogSnapshot(
        metadata_revision="sha256:test",
        tables=[
            CatalogTable(
                name="wide_table",
                columns=[
                    CatalogColumn(
                        name="name",
                        type="VARCHAR",
                        is_name=True,
                        is_class_name=False,
                        is_primary_key=False,
                        is_foreign_key=False,
                    ),
                    CatalogColumn(
                        name="class_name",
                        type="VARCHAR",
                        is_name=False,
                        is_class_name=True,
                        is_primary_key=False,
                        is_foreign_key=False,
                    ),
                    *[
                        CatalogColumn(
                            name=f"metric_{index}",
                            type="INTEGER",
                            is_name=False,
                            is_class_name=False,
                            is_primary_key=False,
                            is_foreign_key=False,
                        )
                        for index in range(25)
                    ],
                ],
            )
        ],
    )

    result = validate_model_selection(selection("wide_table", "all", []), snapshot)

    assert result.tables[0].auxiliary_fields == [
        f"metric_{index}" for index in range(25)
    ]


@pytest.mark.parametrize(
    "field_name",
    ["name", "className", "id", "user_id", "invented_field"],
    ids=["name", "class-name", "primary-key", "foreign-key", "unknown"],
)
def test_specified_selection_rejects_non_auxiliary_fields(snapshot, field_name) -> None:
    with pytest.raises(InvalidModelOutput, match="INVALID_MODEL_OUTPUT"):
        validate_model_selection(
            selection("orders", "specified", [field_name]),
            snapshot,
        )


def test_specified_selection_preserves_an_exact_legal_subset(snapshot) -> None:
    result = validate_model_selection(
        selection("products", "specified", ["title"]),
        snapshot,
    )

    assert result.tables[0].auxiliary_fields == ["title"]


def test_specified_selection_rejects_duplicate_fields(snapshot) -> None:
    with pytest.raises(InvalidModelOutput, match="INVALID_MODEL_OUTPUT"):
        validate_model_selection(
            selection("orders", "specified", ["amount", "amount"]),
            snapshot,
        )


def test_table_without_legal_auxiliary_fields_is_valid() -> None:
    snapshot = CatalogSnapshot(
        metadata_revision="sha256:test",
        tables=[
            CatalogTable(
                name="identity_only",
                columns=[
                    CatalogColumn(
                        name="id",
                        type="INTEGER",
                        is_name=False,
                        is_class_name=False,
                        is_primary_key=True,
                        is_foreign_key=False,
                    ),
                    CatalogColumn(
                        name="name",
                        type="VARCHAR",
                        is_name=True,
                        is_class_name=False,
                        is_primary_key=False,
                        is_foreign_key=False,
                    ),
                    CatalogColumn(
                        name="class_name",
                        type="VARCHAR",
                        is_name=False,
                        is_class_name=True,
                        is_primary_key=False,
                        is_foreign_key=False,
                    ),
                ],
            )
        ],
    )

    result = validate_model_selection(selection("identity_only", "all", []), snapshot)

    assert result.tables[0].auxiliary_fields == []


def test_unknown_table_is_rejected(snapshot) -> None:
    with pytest.raises(InvalidModelOutput, match="INVALID_MODEL_OUTPUT"):
        validate_model_selection(selection("missing", "all", []), snapshot)


def test_duplicate_table_is_rejected(snapshot) -> None:
    output = ModelSelection(
        status="selected",
        tables=[
            ModelTableSelection(
                table_name="orders",
                field_selection="all",
                reason="First occurrence.",
            ),
            ModelTableSelection(
                table_name="orders",
                field_selection="all",
                reason="Duplicate occurrence.",
            ),
        ],
    )

    with pytest.raises(InvalidModelOutput, match="INVALID_MODEL_OUTPUT"):
        validate_model_selection(output, snapshot)


def test_more_than_ten_tables_requires_clarification(snapshot) -> None:
    output = ModelSelection(
        status="selected",
        tables=[
            ModelTableSelection(
                table_name="orders",
                field_selection="all",
                reason="Too broad.",
            )
            for _ in range(11)
        ],
    )

    with pytest.raises(ClarificationRequired, match="SCOPE_TOO_BROAD"):
        validate_model_selection(output, snapshot)


def test_empty_selected_result_requires_clarification(snapshot) -> None:
    with pytest.raises(ClarificationRequired, match="NO_RELIABLE_MATCH"):
        validate_model_selection(ModelSelection(status="selected"), snapshot)
