import pytest
from sqlalchemy import Column, MetaData, String, Table, create_engine, event
from sqlalchemy.pool import StaticPool

from engine.schema_analyzer import analyze_schema
from engine.semantic.deadline import DeadlineExceeded
from engine.semantic.models import EntityDocument
from engine.semantic.structural_relations import (
    _relation_id_chunk_size,
    build_relation_table_edges,
)


def test_mysql_relation_id_chunks_use_driver_safe_bulk_size():
    assert _relation_id_chunk_size("sqlite") == 400
    assert _relation_id_chunk_size("mysql") == 10_000


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

    labels_by_relation_endpoints = {
        (relation.source, relation.target): relation.relation_type
        for edge in edges
        for relation in edge.relations
    }
    assert labels_by_relation_endpoints == {
        ("meprocess:1", "meoperation:1"): "包含工序",
        ("meoperation:1", "mestep:1"): "包含工步",
        ("meprocess:1", "assembly:1"): "关联物料",
        ("meoperation:1", "assembly:1"): "关联物料",
        ("mestep:1", "assembly:1"): "关联物料",
        ("custom_source:1", "custom_target:1"): "结构关联",
    }


def test_known_reverse_rows_normalize_relation_and_evidence_direction():
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
    }
    for table_name in class_by_table:
        Table(table_name, metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [
                {
                    "left_id": "operation-1",
                    "right_id": "process-1",
                    "left_class": "MEOperation",
                    "right_class": "MEProcess",
                },
                {
                    "left_id": "step-1",
                    "right_id": "operation-1",
                    "left_class": "MEStep",
                    "right_class": "MEOperation",
                },
                {
                    "left_id": "assembly-1",
                    "right_id": "process-1",
                    "left_class": "Assembly",
                    "right_class": "MEProcess",
                },
                {
                    "left_id": "assembly-1",
                    "right_id": "operation-1",
                    "left_class": "Assembly",
                    "right_class": "MEOperation",
                },
                {
                    "left_id": "assembly-1",
                    "right_id": "step-1",
                    "left_class": "Assembly",
                    "right_class": "MEStep",
                },
            ],
        )

    records = {
        "meprocess": [{"id": "process-1"}],
        "meoperation": [{"id": "operation-1"}],
        "mestep": [{"id": "step-1"}],
        "assembly": [{"id": "assembly-1"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document(
            f"{table_name}:{rows[0]['id']}",
            table_name,
            class_by_table[table_name],
        )
        for table_name, rows in records.items()
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    actual = {}
    for edge in edges:
        relation = edge.relations[0]
        evidence = relation.evidence[0]
        actual[(relation.source, relation.target)] = (
            relation.relation_type,
            relation.direction,
            evidence.source_field,
            evidence.source_value,
            evidence.target_field,
            evidence.target_value,
        )
    assert actual == {
        ("meprocess:process-1", "meoperation:operation-1"): (
            "包含工序",
            "source_to_target",
            "right_id",
            "process-1",
            "left_id",
            "operation-1",
        ),
        ("meoperation:operation-1", "mestep:step-1"): (
            "包含工步",
            "source_to_target",
            "right_id",
            "operation-1",
            "left_id",
            "step-1",
        ),
        ("meprocess:process-1", "assembly:assembly-1"): (
            "关联物料",
            "source_to_target",
            "right_id",
            "process-1",
            "left_id",
            "assembly-1",
        ),
        ("meoperation:operation-1", "assembly:assembly-1"): (
            "关联物料",
            "source_to_target",
            "right_id",
            "operation-1",
            "left_id",
            "assembly-1",
        ),
        ("mestep:step-1", "assembly:assembly-1"): (
            "关联物料",
            "source_to_target",
            "right_id",
            "step-1",
            "left_id",
            "assembly-1",
        ),
    }


@pytest.mark.parametrize(
    (
        "left_id",
        "left_class",
        "right_id",
        "right_class",
        "expected_source_field",
        "expected_target_field",
    ),
    [
        pytest.param(
            "custom-1",
            "CustomType",
            "assembly-1",
            "Assembly",
            "left_id",
            "right_id",
            id="custom-to-assembly",
        ),
        pytest.param(
            "assembly-1",
            "Assembly",
            "custom-1",
            "CustomType",
            "right_id",
            "left_id",
            id="assembly-to-custom",
        ),
    ],
)
def test_custom_assembly_relation_always_points_toward_assembly(
    left_id,
    left_class,
    right_id,
    right_class,
    expected_source_field,
    expected_target_field,
):
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
    Table("custom", metadata, Column("id", String, primary_key=True))
    Table("assembly", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [{
                "left_id": left_id,
                "right_id": right_id,
                "left_class": left_class,
                "right_class": right_class,
            }],
        )

    records = {
        "custom": [{"id": "custom-1"}],
        "assembly": [{"id": "assembly-1"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document("custom:custom-1", "custom", "CustomType"),
        _document("assembly:assembly-1", "assembly", "Assembly"),
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    assert len(edges) == 1
    relation = edges[0].relations[0]
    evidence = relation.evidence[0]
    assert (
        relation.source,
        relation.target,
        relation.direction,
        relation.relation_type,
        evidence.source_field,
        evidence.source_value,
        evidence.target_field,
        evidence.target_value,
    ) == (
        "custom:custom-1",
        "assembly:assembly-1",
        "source_to_target",
        "关联物料",
        expected_source_field,
        "custom-1",
        expected_target_field,
        "assembly-1",
    )


def test_unknown_pair_without_assembly_keeps_database_row_direction():
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
    Table("custom_source", metadata, Column("id", String, primary_key=True))
    Table("custom_target", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [{
                "left_id": "source-1",
                "right_id": "target-1",
                "left_class": "CustomSource",
                "right_class": "CustomTarget",
            }],
        )

    records = {
        "custom_source": [{"id": "source-1"}],
        "custom_target": [{"id": "target-1"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document(
            "custom_source:source-1",
            "custom_source",
            "CustomSource",
        ),
        _document(
            "custom_target:target-1",
            "custom_target",
            "CustomTarget",
        ),
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    assert len(edges) == 1
    relation = edges[0].relations[0]
    evidence = relation.evidence[0]
    assert (
        relation.source,
        relation.target,
        relation.direction,
        relation.relation_type,
        evidence.source_field,
        evidence.source_value,
        evidence.target_field,
        evidence.target_value,
    ) == (
        "custom_source:source-1",
        "custom_target:target-1",
        "source_to_target",
        "结构关联",
        "left_id",
        "source-1",
        "right_id",
        "target-1",
    )


def test_same_business_table_is_excluded_without_excluding_cross_table_same_class():
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
    Table("polymorphic", metadata, Column("id", String, primary_key=True))
    Table("peer", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [
                {
                    "left_id": "poly-shared",
                    "right_id": "poly-internal",
                    "left_class": "SharedType",
                    "right_class": "InternalType",
                },
                {
                    "left_id": "poly-shared",
                    "right_id": "peer-shared",
                    "left_class": "SharedType",
                    "right_class": "SharedType",
                },
            ],
        )

    records = {
        "polymorphic": [
            {"id": "poly-shared"},
            {"id": "poly-internal"},
        ],
        "peer": [{"id": "peer-shared"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document("polymorphic:poly-shared", "polymorphic", "SharedType"),
        _document("polymorphic:poly-internal", "polymorphic", "InternalType"),
        _document("peer:peer-shared", "peer", "SharedType"),
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    assert [
        (relation.source, relation.target)
        for edge in edges
        for relation in edge.relations
    ] == [
        ("polymorphic:poly-shared", "peer:peer-shared"),
    ]


def test_opposite_unknown_rows_keep_separate_ordered_relations_and_evidence():
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
    Table("custom_a", metadata, Column("id", String, primary_key=True))
    Table("custom_b", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [{
                "left_id": "a-1",
                "right_id": "b-1",
                "left_class": "CustomA",
                "right_class": "CustomB",
            }],
        )
        connection.execute(
            metargetrl.insert(),
            [{
                "left_id": "b-1",
                "right_id": "a-1",
                "left_class": "CustomB",
                "right_class": "CustomA",
            }],
        )

    records = {
        "custom_a": [{"id": "a-1"}],
        "custom_b": [{"id": "b-1"}],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        _document("custom_a:a-1", "custom_a", "CustomA"),
        _document("custom_b:b-1", "custom_b", "CustomB"),
    ]

    edges = build_relation_table_edges(
        engine,
        records,
        schema_result,
        documents,
    )

    assert len(edges) == 1
    assert len(edges[0].relations) == 2
    relation_evidence = {
        (relation.source, relation.target): (
            evidence.source_field,
            evidence.source_value,
            evidence.target_field,
            evidence.target_value,
        )
        for relation in edges[0].relations
        for evidence in relation.evidence
    }
    assert relation_evidence == {
        ("custom_a:a-1", "custom_b:b-1"): (
            "left_id",
            "a-1",
            "right_id",
            "b-1",
        ),
        ("custom_b:b-1", "custom_a:a-1"): (
            "left_id",
            "b-1",
            "right_id",
            "a-1",
        ),
    }


def test_relation_queries_filter_selected_ids_in_safe_chunks_and_stream_partial():
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
    Table("sources", metadata, Column("id", String, primary_key=True))
    Table("targets", metadata, Column("id", String, primary_key=True))
    metadata.create_all(engine)
    selected_count = 600
    with engine.begin() as connection:
        connection.execute(
            relation_id.insert(),
            [
                {
                    "left_id": f"source-{index}",
                    "right_id": f"target-{index}",
                    "left_class": "SourceType",
                    "right_class": "TargetType",
                }
                for index in range(selected_count)
            ]
            + [
                {
                    "left_id": f"unselected-source-{index}",
                    "right_id": f"unselected-target-{index}",
                    "left_class": "SourceType",
                    "right_class": "TargetType",
                }
                for index in range(2_000)
            ],
        )

    records = {
        "sources": [{"id": f"source-{index}"} for index in range(selected_count)],
        "targets": [{"id": f"target-{index}"} for index in range(selected_count)],
    }
    schema_result = analyze_schema(engine, list(records))
    documents = [
        *[
            _document(
                f"sources:source-{index}",
                "sources",
                "SourceType",
            )
            for index in range(selected_count)
        ],
        *[
            _document(
                f"targets:target-{index}",
                "targets",
                "TargetType",
            )
            for index in range(selected_count)
        ],
    ]
    relation_queries: list[tuple[str, int]] = []

    def capture_query(
        _connection,
        _cursor,
        statement,
        parameters,
        _context,
        _executemany,
    ) -> None:
        if "FROM relation_id" not in statement:
            return
        parameter_count = (
            len(parameters)
            if isinstance(parameters, (tuple, list))
            else len(parameters.keys())
        )
        relation_queries.append((statement, parameter_count))

    event.listen(engine, "before_cursor_execute", capture_query)
    deadline_checks = 0

    def expire_during_stream(_stage: str) -> None:
        nonlocal deadline_checks
        deadline_checks += 1
        if deadline_checks == 10:
            raise DeadlineExceeded("stream batch")

    with pytest.raises(DeadlineExceeded) as raised:
        build_relation_table_edges(
            engine,
            records,
            schema_result,
            documents,
            check_deadline=expire_during_stream,
        )

    resolved_edges = getattr(raised.value, "resolved_edges", [])
    assert 0 < len(resolved_edges) < selected_count
    assert relation_queries
    assert all(
        "left_id IN" in statement and "right_id IN" in statement
        for statement, _ in relation_queries
    )
    assert max(parameter_count for _, parameter_count in relation_queries) <= 900


def test_relation_table_deadline_exposes_edges_resolved_before_failure():
    engine, records, schema_result, documents = _relation_table_fixture()
    deadline_checks = 0

    def expire_after_first_table(stage: str) -> None:
        nonlocal deadline_checks
        deadline_checks += 1
        if deadline_checks == 7:
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
