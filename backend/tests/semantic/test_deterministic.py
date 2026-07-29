from sqlalchemy import (
    Column,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    create_engine,
)
from sqlalchemy.pool import StaticPool

from engine.relationship_computer import FKConstraint
from engine.schema_analyzer import (
    IndexMeta,
    SchemaAnalysisResult,
    TableSchema,
    analyze_schema,
)
from engine.semantic.corpus import (
    build_entity_documents,
    load_scoped_records,
)
from engine.semantic.deterministic import (
    build_fk_edges,
    build_unique_identifier_edges,
)
from engine.semantic.models import (
    AnalysisScope,
    RelationshipPlan,
    TableScope,
)


def test_scoped_loader_supplies_physical_fk_target_without_semantic_leak():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    metadata = MetaData()
    users = Table(
        "users",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("code", String, unique=True),
        Column("name", String),
    )
    orders = Table(
        "orders",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("user_code", String, ForeignKey("users.code")),
        Column("amount", Integer),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            users.insert(),
            [{"id": 1, "code": "U-42", "name": "Alice"}],
        )
        connection.execute(
            orders.insert(),
            [{"id": 10, "user_code": "U-42", "amount": 100}],
        )

    scope = AnalysisScope(
        tables=[
            TableScope(name="users", dimensions=["name"]),
            TableScope(name="orders", dimensions=["amount"]),
        ]
    )
    schema_result = analyze_schema(engine, ["users", "orders"])

    records = load_scoped_records(engine, scope, schema_result)

    assert set(records["users"][0]) == {"id", "code", "name"}
    assert set(records["orders"][0]) == {"id", "user_code", "amount"}
    documents = build_entity_documents(
        records,
        scope,
        schema_result.pk_metadata,
        {"users": None, "orders": None},
    )
    assert [document.dimensions for document in documents] == [
        {"name": "Alice"},
        {"amount": 100},
    ]
    assert all("U-42" not in document.search_text for document in documents)

    edges = build_fk_edges(
        records,
        schema_result.pk_metadata,
        schema_result.all_foreign_keys,
    )
    assert [(edge.source, edge.target) for edge in edges] == [
        ("orders:10", "users:1")
    ]


def test_fk_uses_declared_target_columns_not_target_primary_key():
    edges = build_fk_edges(
        records={
            "users": [{"id": 1, "code": "U-42"}],
            "orders": [{"id": 10, "user_code": "U-42"}],
        },
        pk_metadata={"users": ["id"], "orders": ["id"]},
        fk_constraints=[
            FKConstraint("orders", ["user_code"], "users", ["code"])
        ],
    )

    assert [(edge.source, edge.target) for edge in edges] == [
        ("orders:10", "users:1")
    ]
    relation = edges[0].relations[0]
    assert relation.relation_type == "外键关联"
    assert relation.strength == "strong"
    assert relation.confidence == 1.0
    assert relation.evidence[0].source_field == "user_code"
    assert relation.evidence[0].target_field == "code"
    assert relation.evidence[0].method == "foreign_key"


def test_fk_edges_reuse_collision_safe_entity_ids():
    edges = build_fk_edges(
        records={
            "users:archive": [{"id": "a|b", "code": "U-42"}],
            "orders": [{"id": "x:y", "user_code": "U-42"}],
        },
        pk_metadata={
            "users:archive": ["id"],
            "orders": ["id"],
        },
        fk_constraints=[
            FKConstraint(
                "orders",
                ["user_code"],
                "users:archive",
                ["code"],
            )
        ],
    )

    assert [(edge.source, edge.target) for edge in edges] == [
        ("orders:x%3Ay", "users%3Aarchive:a%7Cb")
    ]


def test_planned_unique_identifiers_create_strong_edges():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [{"id": 1, "creator_no": " E-7 "}],
            "operations": [{"id": 2, "operator_no": "e-7"}],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_creator", ["creator_no"], True)
                    ],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_operator", ["operator_no"], True)
                    ],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={
                "requirements": ["id"],
                "operations": ["id"],
            },
        ),
        plans=[
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="人员行为",
                direction="source_to_target",
                source_dimensions=["creator_no"],
                target_dimensions=["operator_no"],
                retrieval_modes=["keyword"],
                candidate_limit_per_source=20,
                reason="唯一员工编号表示同一人员",
            )
        ],
    )

    relation = edges[0].relations[0]
    assert relation.strength == "strong"
    assert relation.confidence == 1.0
    assert relation.evidence[0].source_field == "creator_no"
    assert relation.evidence[0].source_value == " E-7 "
    assert relation.evidence[0].target_field == "operator_no"
    assert relation.evidence[0].target_value == "e-7"
    assert relation.evidence[0].method == "unique_identifier"


def test_both_exact_value_dimensions_must_be_schema_unique():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [{"id": 1, "creator_name": "张三"}],
            "operations": [{"id": 2, "operator_name": "张三"}],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_creator", ["creator_name"], True)
                    ],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={
                "requirements": ["id"],
                "operations": ["id"],
            },
        ),
        plans=[
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="人员行为",
                direction="source_to_target",
                source_dimensions=["creator_name"],
                target_dimensions=["operator_name"],
                retrieval_modes=["keyword"],
                reason="同名需要模型判断是否为同一人员",
            )
        ],
    )

    assert edges == []


def test_primary_keys_are_identity_only_not_semantic_unique_identifiers():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [{"id": 7}],
            "operations": [{"id": 7}],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={
                "requirements": ["id"],
                "operations": ["id"],
            },
        ),
        plans=[
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="same identifier",
                direction="source_to_target",
                source_dimensions=["id"],
                target_dimensions=["id"],
                retrieval_modes=["keyword"],
                reason="primary keys are system identity only",
            )
        ],
    )

    assert edges == []


def test_primary_key_reported_as_unique_index_remains_identity_only():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [{"id": 7}],
            "operations": [{"id": 7}],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_requirements_id", ["id"], True)
                    ],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_operations_id", ["id"], True)
                    ],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={
                "requirements": ["id"],
                "operations": ["id"],
            },
        ),
        plans=[
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="same identifier",
                direction="source_to_target",
                source_dimensions=["id"],
                target_dimensions=["id"],
                retrieval_modes=["keyword"],
                reason="primary keys are system identity only",
            )
        ],
    )

    assert edges == []


def test_null_unique_identifiers_do_not_match_empty_strings():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [
                {"id": 1, "creator_no": None},
                {"id": 2, "creator_no": ""},
            ],
            "operations": [
                {"id": 3, "operator_no": ""},
                {"id": 4, "operator_no": None},
            ],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_creator", ["creator_no"], True)
                    ],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_operator", ["operator_no"], True)
                    ],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={
                "requirements": ["id"],
                "operations": ["id"],
            },
        ),
        plans=[
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="人员行为",
                direction="source_to_target",
                source_dimensions=["creator_no"],
                target_dimensions=["operator_no"],
                retrieval_modes=["keyword"],
                reason="唯一员工编号表示同一人员",
            )
        ],
    )

    assert [(edge.source, edge.target) for edge in edges] == [
        ("requirements:2", "operations:3")
    ]


def test_multi_dimension_plan_is_not_a_unique_identifier_match():
    edges = build_unique_identifier_edges(
        records={
            "requirements": [
                {"id": 1, "creator_no": "E-7", "site": "A"}
            ],
            "operations": [
                {"id": 2, "operator_no": "E-7", "site": "A"}
            ],
        },
        schema_result=SchemaAnalysisResult(
            tables={
                "requirements": TableSchema(
                    name="requirements",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_creator", ["creator_no"], True)
                    ],
                ),
                "operations": TableSchema(
                    name="operations",
                    primary_keys=["id"],
                    indexes=[
                        IndexMeta("uq_operator", ["operator_no"], True)
                    ],
                ),
            },
            all_foreign_keys=[],
            pk_metadata={
                "requirements": ["id"],
                "operations": ["id"],
            },
        ),
        plans=[
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="人员行为",
                direction="source_to_target",
                source_dimensions=["creator_no", "site"],
                target_dimensions=["operator_no", "site"],
                retrieval_modes=["keyword"],
                reason="多维普通匹配必须留给模型判断",
            )
        ],
    )

    assert edges == []


def test_target_normalization_collision_is_ambiguous_in_any_row_order():
    schema_result = SchemaAnalysisResult(
        tables={
            "requirements": TableSchema(
                name="requirements",
                primary_keys=["id"],
                indexes=[
                    IndexMeta("uq_creator", ["creator_no"], True)
                ],
            ),
            "operations": TableSchema(
                name="operations",
                primary_keys=["id"],
                indexes=[
                    IndexMeta("uq_operator", ["operator_no"], True)
                ],
            ),
        },
        all_foreign_keys=[],
        pk_metadata={
            "requirements": ["id"],
            "operations": ["id"],
        },
    )
    plans = [
        RelationshipPlan(
            source_table="requirements",
            target_table="operations",
            relation_type="人员行为",
            direction="source_to_target",
            source_dimensions=["creator_no"],
            target_dimensions=["operator_no"],
            retrieval_modes=["keyword"],
            reason="规范化后不唯一时必须交给模型判断",
        )
    ]
    target_rows = [
        {"id": 2, "operator_no": "E-7"},
        {"id": 3, "operator_no": " e-7 "},
    ]

    outputs = [
        build_unique_identifier_edges(
            records={
                "requirements": [{"id": 1, "creator_no": "E-7"}],
                "operations": rows,
            },
            schema_result=schema_result,
            plans=plans,
        )
        for rows in (target_rows, list(reversed(target_rows)))
    ]

    assert outputs == [[], []]


def test_source_normalization_collision_is_ambiguous_in_any_row_order():
    schema_result = SchemaAnalysisResult(
        tables={
            "requirements": TableSchema(
                name="requirements",
                primary_keys=["id"],
                indexes=[
                    IndexMeta("uq_creator", ["creator_no"], True)
                ],
            ),
            "operations": TableSchema(
                name="operations",
                primary_keys=["id"],
                indexes=[
                    IndexMeta("uq_operator", ["operator_no"], True)
                ],
            ),
        },
        all_foreign_keys=[],
        pk_metadata={
            "requirements": ["id"],
            "operations": ["id"],
        },
    )
    plans = [
        RelationshipPlan(
            source_table="requirements",
            target_table="operations",
            relation_type="人员行为",
            direction="source_to_target",
            source_dimensions=["creator_no"],
            target_dimensions=["operator_no"],
            retrieval_modes=["keyword"],
            reason="规范化后不唯一时必须交给模型判断",
        )
    ]
    source_rows = [
        {"id": 1, "creator_no": "E-7"},
        {"id": 2, "creator_no": " e-7 "},
    ]

    outputs = [
        build_unique_identifier_edges(
            records={
                "requirements": rows,
                "operations": [{"id": 3, "operator_no": "E-7"}],
            },
            schema_result=schema_result,
            plans=plans,
        )
        for rows in (source_rows, list(reversed(source_rows)))
    ]

    assert outputs == [[], []]
