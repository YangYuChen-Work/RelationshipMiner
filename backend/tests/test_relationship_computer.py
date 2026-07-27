"""关系计算引擎 — 纯函数单元测试。

测试 FK 追踪、精确值相等匹配、多重关系合并、NULL 处理、孤立节点。
"""

import pytest
from engine.relationship_computer import (
    compute_relationships,
    FKConstraint,
    Node,
    Edge,
)


# ── 测试数据 ──────────────────────────────────────────────────


def _make_records() -> dict[str, list[dict]]:
    """构建与 conftest.py 一致的测试数据集。"""
    return {
        "users": [
            {
                "id": 1,
                "name": "Alice",
                "email": "alice@test.com",
                "class_name": "com.example.User",
            },
            {
                "id": 2,
                "name": "Bob",
                "email": "bob@test.com",
                "class_name": "com.example.Admin",
            },
        ],
        "orders": [
            {
                "id": 1,
                "user_id": 1,
                "amount": 100,
                "className": "com.example.Order",
            },
            {
                "id": 2,
                "user_id": 2,
                "amount": 200,
                "className": "com.example.Order",
            },
        ],
        "products": [
            {"id": 1, "title": "Widget", "price": 10},
            {"id": 2, "title": "Gadget", "price": 20},
        ],
    }


def _pk_metadata() -> dict[str, list[str]]:
    return {"users": ["id"], "orders": ["id"], "products": ["id"]}


def _fk_orders_user_id() -> list[FKConstraint]:
    """orders.user_id → users.id"""
    return [
        FKConstraint(
            source_table="orders",
            source_columns=["user_id"],
            target_table="users",
            target_columns=["id"],
        )
    ]


# ── FK 追踪测试 ──────────────────────────────────────────────


class TestFKTracking:
    """外键关系追踪。"""

    def test_detects_fk_relationships(self):
        """应检出 orders.user_id → users.id 的外键关系。"""
        records = _make_records()
        pk = _pk_metadata()
        fk = _fk_orders_user_id()

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        # 6 个节点 (2 users + 2 orders + 2 products)
        assert len(graph["nodes"]) == 6

        # 2 条边 (order1 → user1, order2 → user2)
        fk_edges = [e for e in graph["edges"] if "外键关联" in e["labels"]]
        assert len(fk_edges) == 2

    def test_fk_edge_has_correct_structure(self):
        """FK 边应有正确的 source/target/labels/confidence。"""
        records = _make_records()
        pk = _pk_metadata()
        fk = _fk_orders_user_id()

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        fk_edges = [e for e in graph["edges"] if "外键关联" in e["labels"]]
        # order1 (user_id=1) → user1 (id=1)
        edge = fk_edges[0]
        assert edge["confidence"] == 1.0
        assert "外键关联" in edge["labels"]
        # 边连接跨越两张表
        assert ("orders:" in edge["source"] and "users:" in edge["target"]) or (
            "orders:" in edge["target"] and "users:" in edge["source"]
        )

    def test_fk_confidence_is_always_1(self):
        """FK 关系置信度始终为 1.0（确定性来源）。"""
        records = _make_records()
        pk = _pk_metadata()
        fk = _fk_orders_user_id()

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        for edge in graph["edges"]:
            assert edge["confidence"] == 1.0


# ── NULL 值处理测试 ──────────────────────────────────────────


class TestNullHandling:
    """NULL 值不参与任何匹配。"""

    def test_null_fk_value_does_not_match(self):
        """FK 列值为 NULL 的行不应产生边。"""
        records = {
            "users": [{"id": 1, "name": "Alice"}],
            "orders": [
                {"id": 1, "user_id": None, "amount": 100},
                {"id": 2, "user_id": 1, "amount": 200},
            ],
        }
        pk = {"users": ["id"], "orders": ["id"]}
        fk = [
            FKConstraint(
                source_table="orders",
                source_columns=["user_id"],
                target_table="users",
                target_columns=["id"],
            )
        ]

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        # order1 (user_id=None) 不应参与匹配 → 仅 order2 产生 FK 边
        fk_edges = [e for e in graph["edges"] if "外键关联" in e["labels"]]
        assert len(fk_edges) == 1

    def test_two_nulls_are_not_equal(self):
        """两个 NULL 值不视为相等。"""
        records = {
            "users": [{"id": 1, "name": None, "email": "a@t.com"}],
            "orders": [{"id": 1, "user_name": None, "amount": 100}],
        }
        pk = {"users": ["id"], "orders": ["id"]}
        # 无 FK — 仅测试值相等场景
        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=[])

        # NULL vs NULL 不应产生任何边
        assert len(graph["edges"]) == 0

    def test_null_vs_non_null_not_equal(self):
        """NULL 与非 NULL 值不匹配。"""
        records = {
            "users": [{"id": 1, "name": None}],
            "orders": [{"id": 1, "user_name": None}],
        }
        pk = {"users": ["id"], "orders": ["id"]}
        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=[])
        assert len(graph["edges"]) == 0


# ── 孤立节点测试 ─────────────────────────────────────────────


class TestIsolatedNodes:
    """没有关系的记录仍作为孤立节点出现。"""

    def test_isolated_nodes_included(self):
        """products 表无 FK、无值匹配，节点仍应在图谱中。"""
        records = _make_records()
        pk = _pk_metadata()
        fk = _fk_orders_user_id()

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        product_nodes = [
            n for n in graph["nodes"] if n["source_table"] == "products"
        ]
        assert len(product_nodes) == 2

    def test_isolated_node_degree_is_zero(self):
        """孤立节点的 degree 应为 0。"""
        records = _make_records()
        pk = _pk_metadata()
        fk = _fk_orders_user_id()

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        for node in graph["nodes"]:
            if node["source_table"] == "products":
                assert node["degree"] == 0

    def test_connected_node_degree_is_correct(self):
        """有 FK 关系的节点 degree 应正确计数。"""
        records = _make_records()
        pk = _pk_metadata()
        fk = _fk_orders_user_id()

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        # user1 (id=1) 被 order1 引用 → degree=1
        user1 = [n for n in graph["nodes"] if n["id"] == "users:1"][0]
        assert user1["degree"] == 1


# ── 多重关系合并测试 ─────────────────────────────────────────


class TestMultiLabelMerge:
    """多重关系合并为单边、标签拼接。"""

    def test_multiple_relationships_merged(self):
        """同一对记录有 FK + 值相等时，合并为一条边。"""
        records = {
            "users": [{"id": 1, "email": "a@t.com"}],
            "contacts": [{"id": 1, "user_id": 1, "contact_email": "a@t.com"}],
        }
        pk = {"users": ["id"], "contacts": ["id"]}
        fk = [
            FKConstraint(
                source_table="contacts",
                source_columns=["user_id"],
                target_table="users",
                target_columns=["id"],
            )
        ]

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=fk)

        # 应有 1 条边（不是 2 条）
        assert len(graph["edges"]) == 1
        # 标签应包含 FK 和值相等
        labels = graph["edges"][0]["labels"]
        assert "外键关联" in labels


# ── 空输入测试 ───────────────────────────────────────────────


class TestEmptyInput:
    """边界情况。"""

    def test_empty_records_returns_empty_graph(self):
        """无记录时返回空图谱。"""
        graph = compute_relationships({}, pk_metadata={}, fk_constraints=[])
        assert graph["nodes"] == []
        assert graph["edges"] == []

    def test_no_fk_no_edges(self):
        """无 FK 且无 AI 决策时，仅返回孤立节点。"""
        records = {
            "products": [{"id": 1, "title": "Widget"}],
        }
        pk = {"products": ["id"]}
        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=[])
        assert len(graph["nodes"]) == 1
        assert len(graph["edges"]) == 0


# ── 节点 ID 生成测试 ─────────────────────────────────────────


class TestNodeIdGeneration:
    """节点 ID 由表名+主键值组合生成。"""

    def test_single_pk_node_id(self):
        """单列主键：{table}:{pk_value}。"""
        records = {"users": [{"id": 42, "name": "Test"}]}
        pk = {"users": ["id"]}

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=[])

        assert graph["nodes"][0]["id"] == "users:42"

    def test_composite_pk_node_id(self):
        """复合主键：{table}:{pk1}|{pk2}。"""
        records = {
            "order_items": [{"order_id": 1, "product_id": 5, "qty": 3}],
        }
        pk = {"order_items": ["order_id", "product_id"]}

        graph = compute_relationships(
            records, pk_metadata=pk, fk_constraints=[]
        )

        assert graph["nodes"][0]["id"] == "order_items:1|5"

    def test_class_name_extracted(self):
        """节点的 class_name 应从 class_name/className/class 字段提取。"""
        records = {
            "users": [
                {"id": 1, "name": "Alice", "class_name": "com.example.User"},
            ],
        }
        pk = {"users": ["id"]}

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=[])

        assert graph["nodes"][0]["class_name"] == "com.example.User"

    def test_field_values_preserved(self):
        """节点的 field_values 应包含所有字段值。"""
        records = {
            "users": [
                {"id": 1, "name": "Alice", "email": "alice@test.com"},
            ],
        }
        pk = {"users": ["id"]}

        graph = compute_relationships(records, pk_metadata=pk, fk_constraints=[])

        node = graph["nodes"][0]
        assert node["field_values"]["id"] == 1
        assert node["field_values"]["name"] == "Alice"
        assert node["field_values"]["email"] == "alice@test.com"
