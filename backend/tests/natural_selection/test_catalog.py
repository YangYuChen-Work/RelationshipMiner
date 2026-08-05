from sqlalchemy import text

from engine.natural_selection.catalog import build_catalog_snapshot


def test_catalog_excludes_table_without_name_and_class_name(engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, name, email, class_name) VALUES "
                "(99, 'private-row-value', 'private@example.test', 'Private')"
            )
        )

    snapshot = build_catalog_snapshot(engine)

    assert [table.name for table in snapshot.tables] == [
        "orders",
        "products",
        "users",
    ]
    assert all(
        "private-row-value" not in table.model_dump_json()
        for table in snapshot.tables
    )


def test_catalog_revision_is_stable_for_unchanged_metadata(engine) -> None:
    first = build_catalog_snapshot(engine)
    second = build_catalog_snapshot(engine)

    assert first.metadata_revision == second.metadata_revision
    assert first.metadata_revision.startswith("sha256:")


def test_catalog_revision_changes_when_a_column_is_added(engine) -> None:
    before = build_catalog_snapshot(engine)

    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE orders ADD COLUMN priority INTEGER"))

    after = build_catalog_snapshot(engine)

    assert after.metadata_revision != before.metadata_revision
    assert [column.name for column in after.tables[0].columns][-1] == "priority"
