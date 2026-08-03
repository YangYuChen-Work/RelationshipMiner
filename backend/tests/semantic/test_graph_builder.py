import pytest

from engine.semantic.graph_builder import build_graph
from engine.semantic.deadline import DeadlineExceeded
from engine.semantic.models import (
    EntityDocument,
    EntityEdge,
    EntityRelation,
    RelationDecision,
    RelationEvidence,
)


def _document(entity_id: str, table_name: str) -> EntityDocument:
    return EntityDocument(
        entity_id=entity_id,
        table_name=table_name,
        display_name=entity_id,
        dimensions={"name": entity_id},
        normalized_dimensions={"name": entity_id},
        search_text=entity_id,
    )


def _relation(
    source: str,
    target: str,
    *,
    relation_type: str = "uses",
    direction: str = "source_to_target",
    strength: str = "weak",
    confidence: float = 0.8,
) -> RelationDecision:
    return RelationDecision(
        source=source,
        target=target,
        relation_type=relation_type,
        direction=direction,
        strength=strength,
        confidence=confidence,
        explanation="The source uses the target.",
        evidence=[
            RelationEvidence(
                source_field="name",
                source_value=source,
                target_field="name",
                target_value=target,
                method="llm_semantic_reasoning",
                reason="matching business meaning",
            )
        ],
    )


def _weak_relation(source: str, target: str) -> RelationDecision:
    return _relation(source, target)


def test_three_same_type_weak_relations_create_a_table_edge():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
        _document("products:2", "products"),
        _document("products:3", "products"),
    ]

    table_nodes, entity_nodes, table_edges, entity_edges = build_graph(
        documents,
        [],
        [
            _weak_relation("orders:1", "products:1"),
            _weak_relation("orders:1", "products:2"),
            _weak_relation("orders:1", "products:3"),
        ],
    )

    assert [(node.id, node.entity_count) for node in table_nodes] == [
        ("orders", 1),
        ("products", 3),
    ]
    assert [node.id for node in entity_nodes] == [
        "orders:1",
        "products:1",
        "products:2",
        "products:3",
    ]
    assert len(entity_edges) == 3
    assert len(table_edges) == 1
    edge = table_edges[0]
    assert edge.source_table == "orders"
    assert edge.target_table == "products"
    assert edge.relation_types == ["uses"]
    assert edge.strong_count == 0
    assert edge.weak_count == 3
    assert edge.entity_edge_count == 3
    assert edge.average_confidence == 0.8
    assert edge.supporting_entity_edges == [item.id for item in entity_edges]


def test_two_same_type_weak_relations_do_not_create_a_table_edge():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
        _document("products:2", "products"),
    ]

    _, _, table_edges, entity_edges = build_graph(
        documents,
        [],
        [
            _weak_relation("orders:1", "products:1"),
            _weak_relation("orders:1", "products:2"),
        ],
    )

    assert len(entity_edges) == 2
    assert table_edges == []


def test_one_strong_relation_creates_a_table_edge():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
    ]

    _, _, table_edges, entity_edges = build_graph(
        documents,
        [],
        [
            _relation(
                "orders:1",
                "products:1",
                relation_type="foreign_key",
                strength="strong",
                confidence=1.0,
            )
        ],
    )

    assert len(table_edges) == 1
    edge = table_edges[0]
    assert edge.relation_types == ["foreign_key"]
    assert edge.strong_count == 1
    assert edge.weak_count == 0
    assert edge.entity_edge_count == 1
    assert edge.average_confidence == 1.0
    assert edge.supporting_entity_edges == [entity_edges[0].id]


def test_generic_semantic_placeholder_is_normalized_without_losing_specific_types():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
        _document("products:2", "products"),
        _document("products:3", "products"),
    ]
    decisions = [
        _relation(
            "orders:1",
            f"products:{index}",
            relation_type="business_relationship",
        )
        for index in range(1, 4)
    ]
    decisions.append(
        _relation(
            "orders:1",
            "products:1",
            relation_type="specific_usage",
        )
    )

    _, _, table_edges, entity_edges = build_graph(
        documents,
        [],
        decisions,
    )

    relation_types = [
        relation.relation_type
        for edge in entity_edges
        for relation in edge.relations
    ]
    assert relation_types.count("语义关联") == 3
    assert "specific_usage" in relation_types
    assert "business_relationship" not in relation_types
    assert table_edges[0].relation_types == ["specific_usage", "语义关联"]


def test_weak_relations_of_different_types_do_not_combine_for_threshold():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
        _document("products:2", "products"),
        _document("products:3", "products"),
        _document("products:4", "products"),
    ]

    _, _, table_edges, _ = build_graph(
        documents,
        [],
        [
            _relation("orders:1", "products:1", relation_type="uses"),
            _relation("orders:1", "products:2", relation_type="uses"),
            _relation("orders:1", "products:3", relation_type="contains"),
            _relation("orders:1", "products:4", relation_type="contains"),
        ],
    )

    assert table_edges == []


def test_relations_for_one_entity_pair_merge_without_losing_direction_or_evidence():
    documents = [
        EntityDocument(
            entity_id="orders:1",
            table_name="orders",
            display_name="Order 1",
            class_name="example.Order",
            dimensions={"number": "O-1"},
            normalized_dimensions={"number": "o-1"},
            search_text="Order 1",
        ),
        _document("products:1", "products"),
    ]
    deterministic_relation = _relation(
        "orders:1",
        "products:1",
        relation_type="foreign_key",
        strength="strong",
        confidence=1.0,
    )
    llm_relation = _relation(
        "products:1",
        "orders:1",
        relation_type="used_by",
        direction="target_to_source",
        confidence=0.6,
    )

    _, entity_nodes, table_edges, entity_edges = build_graph(
        documents,
        [
            EntityEdge(
                id="source-edge-id-is-not-used-for-deduplication",
                source=deterministic_relation.source,
                target=deterministic_relation.target,
                relations=[
                    EntityRelation(**deterministic_relation.model_dump())
                ],
            )
        ],
        [llm_relation],
    )

    assert entity_nodes[0].class_name == "example.Order"
    assert len(entity_edges) == 1
    entity_edge = entity_edges[0]
    assert entity_edge.id.startswith("entity:")
    relations_by_type = {
        relation.relation_type: relation for relation in entity_edge.relations
    }
    assert (
        relations_by_type["foreign_key"].source,
        relations_by_type["foreign_key"].target,
        relations_by_type["foreign_key"].direction,
        relations_by_type["foreign_key"].evidence[0].source_value,
    ) == ("orders:1", "products:1", "source_to_target", "orders:1")
    assert (
        relations_by_type["used_by"].source,
        relations_by_type["used_by"].target,
        relations_by_type["used_by"].direction,
        relations_by_type["used_by"].evidence[0].source_value,
    ) == ("products:1", "orders:1", "target_to_source", "products:1")
    assert len(table_edges) == 1
    assert table_edges[0].strong_count == 1
    assert table_edges[0].weak_count == 1
    assert table_edges[0].relation_types == ["foreign_key", "used_by"]


def test_graph_output_is_stable_when_relation_input_order_changes():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
    ]
    uses = _relation("orders:1", "products:1", relation_type="uses")
    contains = _relation(
        "products:1",
        "orders:1",
        relation_type="contains",
        direction="target_to_source",
        confidence=0.7,
    )

    graph_from_first_order = build_graph(
        documents, [], [uses, contains]
    )
    graph_from_reversed_order = build_graph(
        list(reversed(documents)), [], [contains, uses]
    )

    assert [
        [item.model_dump() for item in graph_part]
        for graph_part in graph_from_first_order
    ] == [
        [item.model_dump() for item in graph_part]
        for graph_part in graph_from_reversed_order
    ]


def test_public_edge_ids_are_injective_for_delimiters_percent_and_unicode():
    unicode_segment = chr(0x4E2D)
    first_source = f"a%{unicode_segment}"
    first_target = "b->c"
    second_source = f"{first_source}->b"
    second_target = "c"
    documents = [
        _document(first_source, first_source),
        _document(first_target, first_target),
        _document(second_source, second_source),
        _document(second_target, second_target),
    ]

    _, _, table_edges, entity_edges = build_graph(
        documents,
        [],
        [
            _relation(first_source, first_target, strength="strong"),
            _relation(second_source, second_target, strength="strong"),
        ],
    )

    assert len(entity_edges) == 2
    assert len({edge.id for edge in entity_edges}) == 2
    assert len(table_edges) == 2
    assert len({edge.id for edge in table_edges}) == 2
    entity_edge_ids = {
        (edge.source, edge.target): edge.id for edge in entity_edges
    }
    assert {
        (edge.source_table, edge.target_table): edge.supporting_entity_edges
        for edge in table_edges
    } == {
        (first_source, first_target): [
            entity_edge_ids[(first_source, first_target)]
        ],
        (second_source, second_target): [
            entity_edge_ids[(second_source, second_target)]
        ],
    }


def test_empty_input_builds_an_explicit_empty_graph():
    assert build_graph([], [], []) == ([], [], [], [])


def test_graph_exposes_document_display_code():
    document = _document("parts:203", "parts").model_copy(
        update={"display_code": "GY0000203"}
    )

    _, entity_nodes, _, _ = build_graph([document], [], [])

    assert entity_nodes[0].display_code == "GY0000203"


def test_identical_relation_decisions_remain_independent_entries():
    documents = [
        _document("orders:1", "orders"),
        _document("products:1", "products"),
    ]
    decision = _weak_relation("orders:1", "products:1")

    _, _, table_edges, entity_edges = build_graph(
        documents,
        [],
        [decision, decision.model_copy(deep=True)],
    )

    assert len(entity_edges) == 1
    assert len(entity_edges[0].relations) == 2
    expected_relation = EntityRelation(**decision.model_dump()).model_dump()
    assert [relation.model_dump() for relation in entity_edges[0].relations] == [
        expected_relation,
        expected_relation,
    ]
    assert table_edges == []


def test_conflicting_duplicate_entity_documents_are_rejected():
    document = _document("orders:1", "orders")
    conflicting_document = document.model_copy(
        update={"display_name": "different order"}
    )

    with pytest.raises(ValueError, match="Conflicting entity documents"):
        build_graph([document, conflicting_document], [], [])


def test_identical_duplicate_entity_documents_are_deduplicated():
    document = _document("orders:1", "orders")

    table_nodes, entity_nodes, table_edges, entity_edges = build_graph(
        [document, document.model_copy(deep=True)], [], []
    )

    assert [(node.id, node.entity_count) for node in table_nodes] == [
        ("orders", 1)
    ]
    assert [node.id for node in entity_nodes] == ["orders:1"]
    assert table_edges == []
    assert entity_edges == []


def test_same_table_entity_relation_is_retained_without_a_table_self_loop():
    documents = [
        _document("orders:1", "orders"),
        _document("orders:2", "orders"),
    ]

    _, _, table_edges, entity_edges = build_graph(
        documents,
        [],
        [_relation("orders:1", "orders:2", strength="strong")],
    )

    assert len(entity_edges) == 1
    assert len(entity_edges[0].relations) == 1
    assert table_edges == []


def test_graph_builder_checks_deadline_inside_entity_node_loop():
    stages: list[str] = []

    def stop_on_second_node(stage: str) -> None:
        stages.append(stage)
        if stages.count("构建实体节点时") == 2:
            raise DeadlineExceeded(stage)

    with pytest.raises(DeadlineExceeded, match="构建实体节点时"):
        build_graph(
            [_document("orders:1", "orders"), _document("orders:2", "orders")],
            [],
            [],
            check_deadline=stop_on_second_node,
        )

    assert stages.count("构建实体节点时") == 2
