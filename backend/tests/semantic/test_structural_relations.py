import pytest
from sqlalchemy import Column, MetaData, String, Table, create_engine
from sqlalchemy.pool import StaticPool

from engine.schema_analyzer import analyze_schema
from engine.semantic.deadline import DeadlineExceeded
from engine.semantic.models import EntityDocument
from engine.semantic.structural_relations import build_relation_table_edges


def test_relation_table_duplicate_rows_merge_to_one_process_operation_edge():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = MetaData()
    relation_id = Table(
        "relation_id",
        metadata,
        Column("left_id", String),
        Column("right_id", String),
        Column("left_class", String),
        Column("right_class", String),
    )
    metargetrl = Table(
        "metargetrl",
        metadata,
        Column("left_id", String),
        Column("right_id", String),
        Column("left_class", String),
        Column("right_class", String),
    )
    Table("meprocess", metadata, Column("id", String, primary_key=True))
    Table("meoperation", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [
                {
                    "left_id": "process-1",
                    "right_id": "operation-1",
                    "left_class": "MEProcess",
                    "right_class": "MEOperation",
                },
                {
                    "left_id": "process-1",
                    "right_id": "operation-1",
                    "left_class": "MEProcess",
                    "right_class": "MEOperation",
                },
            ],
        )
        connection.execute(
            metargetrl.insert(),
            [
                {
                    "left_id": "process-1",
                    "right_id": "operation-1",
                    "left_class": "MEProcess",
                    "right_class": "MEOperation",
                }
            ],
        )

    records = {
        "meprocess": [{"id": "process-1"}],
        "meoperation": [{"id": "operation-1"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document("meprocess:process-1", "meprocess", "MEProcess"),
        _document("meoperation:operation-1", "meoperation", "MEOperation"),
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    assert len(edges) == 1
    relation = edges[0].relations[0]
    assert (edges[0].source, edges[0].target) == (
        "meprocess:process-1",
        "meoperation:operation-1",
    )
    assert relation.relation_type == "包含工序"
    assert relation.strength == "strong"
    assert len(relation.evidence) == 2
    assert {evidence.method for evidence in relation.evidence} == {
        "relation_table"
    }
    assert {evidence.reason for evidence in relation.evidence} == {
        "metargetrl records MEProcess to MEOperation",
        "relation_id records MEProcess to MEOperation",
    }


def test_relation_table_uses_business_labels_for_known_manufacturing_pairs():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = MetaData()
    relation_id = Table(
        "relation_id",
        metadata,
        Column("left_id", String),
        Column("right_id", String),
        Column("left_class", String),
        Column("right_class", String),
    )
    class_by_table = {
        "meprocess": "MEProcess",
        "meoperation": "MEOperation",
        "mestep": "MEStep",
        "assembly": "Assembly",
        "custom_source": "CustomSource",
        "custom_target": "CustomTarget",
    }
    for table_name in class_by_table:
        Table(table_name, metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    relation_rows = [
        ("MEProcess", "MEOperation"),
        ("MEOperation", "MEStep"),
        ("MEProcess", "Assembly"),
        ("MEOperation", "Assembly"),
        ("MEStep", "Assembly"),
        ("CustomSource", "CustomTarget"),
    ]
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [
                {
                    "left_id": "1",
                    "right_id": "1",
                    "left_class": left_class,
                    "right_class": right_class,
                }
                for left_class, right_class in relation_rows
            ],
        )

    records = {
        table_name: [{"id": "1"}]
        for table_name in class_by_table
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document(f"{table_name}:1", table_name, class_name)
        for table_name, class_name in class_by_table.items()
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    labels_by_pair = {
        frozenset((edge.source.split(":", 1)[0], edge.target.split(":", 1)[0])):
            edge.relations[0].relation_type
        for edge in edges
    }
    assert labels_by_pair == {
        frozenset(("meprocess", "meoperation")): "包含工序",
        frozenset(("meoperation", "mestep")): "包含工步",
        frozenset(("meprocess", "assembly")): "关联物料",
        frozenset(("meoperation", "assembly")): "关联物料",
        frozenset(("mestep", "assembly")): "关联物料",
        frozenset(("custom_source", "custom_target")): "关系表关联",
    }


def test_relation_table_deadline_exposes_edges_resolved_before_failure():
    engine, records, schema_result, documents = _relation_table_fixture()
    deadline_checks = 0

    def expire_after_first_table(stage: str) -> None:
        nonlocal deadline_checks
        deadline_checks += 1
        if deadline_checks == 4:
            raise DeadlineExceeded(stage)

    with pytest.raises(DeadlineExceeded) as raised:
        build_relation_table_edges(
            engine,
            records,
            schema_result,
            documents,
            check_deadline=expire_after_first_table,
        )

    resolved_edges = getattr(raised.value, "resolved_edges", [])
    assert len(resolved_edges) == 1
    assert resolved_edges[0].relations[0].evidence[0].method == "relation_table"


def _relation_table_fixture():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = MetaData()
    relation_id = Table(
        "relation_id",
        metadata,
        Column("left_id", String),
        Column("right_id", String),
        Column("left_class", String),
        Column("right_class", String),
    )
    metargetrl = Table(
        "metargetrl",
        metadata,
        Column("left_id", String),
        Column("right_id", String),
        Column("left_class", String),
        Column("right_class", String),
    )
    Table("meprocess", metadata, Column("id", String, primary_key=True))
    Table("meoperation", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        for relation_table in (relation_id, metargetrl):
            connection.execute(
                relation_table.insert(),
                [{
                    "left_id": "process-1",
                    "right_id": "operation-1",
                    "left_class": "MEProcess",
                    "right_class": "MEOperation",
                }],
            )
    records = {
        "meprocess": [{"id": "process-1"}],
        "meoperation": [{"id": "operation-1"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document("meprocess:process-1", "meprocess", "MEProcess"),
        _document("meoperation:operation-1", "meoperation", "MEOperation"),
    ]
    return engine, records, schema_result, documents


def _document(
    entity_id: str,
    table_name: str,
    class_name: str,
) -> EntityDocument:
    return EntityDocument(
        entity_id=entity_id,
        table_name=table_name,
        display_name=entity_id,
        class_name=class_name,
        dimensions={},
        normalized_dimensions={},
        search_text="",
    )
