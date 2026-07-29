from engine.relationship_computer import FKConstraint
from engine.schema_analyzer import IndexMeta, SchemaAnalysisResult, TableSchema
from engine.semantic.deterministic import (
    build_fk_edges,
    build_unique_identifier_edges,
)
from engine.semantic.models import RelationshipPlan


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
