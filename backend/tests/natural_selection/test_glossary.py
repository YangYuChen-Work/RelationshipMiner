from pathlib import Path

import pytest

from engine.natural_selection.glossary import (
    Glossary,
    GlossaryError,
    GlossaryHit,
    load_glossary,
)


def test_one_alias_group_can_map_to_multiple_tables(tmp_path: Path) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 1\nglossary_version: \"1\"\nmappings:\n"
        "  - aliases: [\u8ba2\u5355, \u8ba2\u5355\u8868]\n"
        "    tables: [sales_order, purchase_order]\n",
        encoding="utf-8",
    )

    glossary = load_glossary(path, {"sales_order", "purchase_order"})

    assert glossary.match("\u5206\u6790\u8ba2\u5355\u6570\u636e") == [
        GlossaryHit(alias="\u8ba2\u5355", table_name="sales_order"),
        GlossaryHit(alias="\u8ba2\u5355", table_name="purchase_order"),
    ]


def test_duplicate_normalized_alias_in_separate_mappings_is_invalid(
    tmp_path: Path,
) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 1\nglossary_version: \"1\"\nmappings:\n"
        "  - aliases: [\u8ba2\u5355]\n    tables: [sales_order]\n"
        "  - aliases: [\" \u8ba2\u5355 \"]\n    tables: [purchase_order]\n",
        encoding="utf-8",
    )

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, {"sales_order", "purchase_order"})


@pytest.mark.parametrize(
    ("mapping", "catalog_table_names"),
    [
        ("aliases: [\u8ba2\u5355]\n    tables: [unknown_table]", {"sales_order"}),
        ("aliases: []\n    tables: [sales_order]", {"sales_order"}),
        ("aliases: [\u8ba2\u5355]\n    tables: []", {"sales_order"}),
    ],
    ids=["unknown-table", "empty-aliases", "empty-tables"],
)
def test_invalid_mapping_is_rejected(
    tmp_path: Path,
    mapping: str,
    catalog_table_names: set[str],
) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 1\nglossary_version: \"1\"\nmappings:\n  - "
        f"{mapping}\n",
        encoding="utf-8",
    )

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, catalog_table_names)


def test_unsupported_schema_version_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 2\nglossary_version: \"1\"\nmappings:\n"
        "  - aliases: [\u8ba2\u5355]\n    tables: [sales_order]\n",
        encoding="utf-8",
    )

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, {"sales_order"})


def test_unrecognized_mapping_key_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 1\nglossary_version: \"1\"\nmappings:\n"
        "  - aliases: [\u8ba2\u5355]\n    tables: [sales_order]\n    weight: 1\n",
        encoding="utf-8",
    )

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, {"sales_order"})


def test_malformed_yaml_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text("schema_version: [\n", encoding="utf-8")

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, {"sales_order"})


def test_non_utf8_yaml_is_rejected(tmp_path: Path) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_bytes(b"\xff")

    with pytest.raises(GlossaryError, match="GLOSSARY_INVALID"):
        load_glossary(path, {"sales_order"})


def test_match_normalizes_nfkc_case_and_whitespace(tmp_path: Path) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 1\nglossary_version: \"1\"\nmappings:\n"
        "  - aliases: [\uff21\uff22\u3000\uff23]\n    tables: [sales_order]\n",
        encoding="utf-8",
    )

    glossary = load_glossary(path, {"sales_order"})

    assert glossary.match("an a b c description") == [
        GlossaryHit(alias="abc", table_name="sales_order")
    ]


def test_multiple_matching_aliases_return_hits_for_the_same_table(
    tmp_path: Path,
) -> None:
    path = tmp_path / "glossary.yaml"
    path.write_text(
        "schema_version: 1\nglossary_version: \"1\"\nmappings:\n"
        "  - aliases: [\u8ba2\u5355, \u91c7\u8d2d\u5355]\n    tables: [sales_order]\n",
        encoding="utf-8",
    )

    glossary = load_glossary(path, {"sales_order"})

    assert glossary.match("\u8ba2\u5355\u4e0e\u91c7\u8d2d\u5355") == [
        GlossaryHit(alias="\u8ba2\u5355", table_name="sales_order"),
        GlossaryHit(alias="\u91c7\u8d2d\u5355", table_name="sales_order"),
    ]


def test_checked_in_project_fixture_loads() -> None:
    project_root = Path(__file__).resolve().parents[3]
    fixture_path = (
        project_root
        / "docs/superpowers/specs/examples/natural-language-glossary-project-fixture.yaml"
    )
    production_path = project_root / "backend/config/natural_language_glossary.yaml"
    catalog_table_names = {
        "requirement",
        "demand_parameter",
        "requirement_folder",
        "meprocess",
        "mestep",
        "meoperation",
        "assembly",
        "pm_proj",
        "pm_folder",
        "job_task",
    }

    glossary = load_glossary(
        production_path,
        catalog_table_names,
    )

    assert production_path.read_text(encoding="utf-8") == fixture_path.read_text(
        encoding="utf-8"
    )
    assert isinstance(glossary, Glossary)
    assert glossary.version == "2026-08-05.1"
    assert len(glossary.mappings) == 4
