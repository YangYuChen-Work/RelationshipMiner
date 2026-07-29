"""关系计算引擎 — 纯函数。

对全量记录执行关系计算：
- FK 追踪：基于外键约束的确定性关联
- 精确值相等匹配：基于字段值完全相等的关联
- 多重关系合并：同一对节点的多种关系合并为单边
- NULL 处理：NULL 值不参与任何匹配

该模块为纯函数，不依赖数据库或外部 API，可直接单元测试。
"""

from dataclasses import dataclass, field
from typing import Any


# ── 数据结构 ──────────────────────────────────────────────────


@dataclass
class FKConstraint:
    """外键约束元数据。"""

    source_table: str
    source_columns: list[str]
    target_table: str
    target_columns: list[str]


@dataclass
class Node:
    """图谱节点（内部使用）。"""

    id: str
    source_table: str
    class_name: str | None
    field_values: dict[str, Any]
    degree: int = 0


@dataclass
class Edge:
    """图谱边（内部使用）。"""

    source: str
    target: str
    labels: list[str]
    confidence: float


# ── 帮助函数 ──────────────────────────────────────────────────


def _make_node_id(table_name: str, pk_values: list[Any]) -> str:
    """生成节点唯一标识符。

    格式：{table_name}:{pk_value} 或 {table_name}:{pk1}|{pk2}（复合主键）。
    """
    from engine.semantic.corpus import _entity_id

    synthetic_row = {
        str(position): value
        for position, value in enumerate(pk_values)
    }
    return _entity_id(
        table_name,
        synthetic_row,
        list(synthetic_row),
    )


def _extract_class_name(field_values: dict[str, Any]) -> str | None:
    """从字段值中提取 class_name。"""
    for key in ("class_name", "className", "class"):
        if key in field_values and field_values[key] is not None:
            return str(field_values[key])
    return None


def _convert_value(val: Any) -> Any:
    """将数据库值转换为可 JSON 序列化的类型。

    处理 datetime、Decimal 等常见非基本类型。
    """
    if val is None:
        return None
    if isinstance(val, (int, float, str, bool)):
        return val
    # datetime / date
    if hasattr(val, "isoformat"):
        return val.isoformat()
    # Decimal
    if hasattr(val, "__float__"):
        return float(val)
    # 其他 — 转字符串
    return str(val)


# ── 主函数 ────────────────────────────────────────────────────


def compute_relationships(
    records: dict[str, list[dict[str, Any]]],
    pk_metadata: dict[str, list[str]],
    fk_constraints: list[FKConstraint] | None = None,
    ai_decisions: list[dict] | None = None,
) -> dict[str, Any]:
    """对全量记录执行关系计算。

    Args:
        records: {table_name: [row_dict, ...]}，每个 row_dict 包含所有选中字段。
        pk_metadata: {table_name: [pk_column_names]}。
        fk_constraints: 外键约束列表。
        ai_decisions: AI 字段匹配决策列表（工单 03 接入），每项格式：
            {source_table, source_field, target_table, target_field, algorithm, confidence}。
            当前版本传入空列表或 None 时仅执行 FK 追踪。

    Returns:
        {"nodes": [node_dict, ...], "edges": [edge_dict, ...]}
    """
    fk_list = fk_constraints or []

    # ── 构建节点 ──────────────────────────────────────────
    nodes: dict[str, Node] = {}  # node_id → Node

    for table_name, rows in records.items():
        pk_cols = pk_metadata.get(table_name, [])
        for row in rows:
            pk_values = [row[c] for c in pk_cols]
            node_id = _make_node_id(table_name, pk_values)
            converted = {k: _convert_value(v) for k, v in row.items()}
            class_name = _extract_class_name(row)
            nodes[node_id] = Node(
                id=node_id,
                source_table=table_name,
                class_name=class_name,
                field_values=converted,
                degree=0,
            )

    # ── 构建边 ──────────────────────────────────────────
    edges: dict[tuple[str, str], Edge] = {}  # (sorted_a, sorted_b) → Edge

    for fk in fk_list:
        source_rows = records.get(fk.source_table, [])
        target_rows = records.get(fk.target_table, [])

        # 构建目标表索引：{pk_tuple → node_id}
        target_pk_cols = pk_metadata.get(fk.target_table, [])
        target_index: dict[tuple, str] = {}
        for row in target_rows:
            target_values = tuple(row[c] for c in fk.target_columns)
            if any(value is None for value in target_values):
                continue
            pk_vals = tuple(row[c] for c in target_pk_cols)
            target_index[target_values] = _make_node_id(
                fk.target_table,
                pk_vals,
            )

        source_pk_cols = pk_metadata.get(fk.source_table, [])
        for row in source_rows:
            # 检查 FK 列值是否含 NULL
            fk_values = [row[c] for c in fk.source_columns]
            if any(v is None for v in fk_values):
                continue

            fk_tuple = tuple(fk_values)
            if fk_tuple in target_index:
                source_pk_vals = [row[c] for c in source_pk_cols]
                source_id = _make_node_id(fk.source_table, source_pk_vals)
                target_id = target_index[fk_tuple]

                _add_or_merge_edge(
                    edges,
                    source_id,
                    target_id,
                    label="外键关联",
                    confidence=1.0,
                )

    # ── 精确值相等匹配（基于 AI 决策） ─────────────────
    if ai_decisions:
        for decision in ai_decisions:
            src_table = decision["source_table"]
            src_field = decision["source_field"]
            tgt_table = decision["target_table"]
            tgt_field = decision["target_field"]
            confidence = decision.get("confidence", 0.5)

            src_rows = records.get(src_table, [])
            tgt_rows = records.get(tgt_table, [])

            # 构建目标字段值索引
            tgt_pk_cols = pk_metadata.get(tgt_table, [])
            tgt_index: dict[Any, list[str]] = {}
            for row in tgt_rows:
                val = row.get(tgt_field)
                if val is None:
                    continue
                pk_vals = tuple(row[c] for c in tgt_pk_cols)
                node_id = _make_node_id(tgt_table, pk_vals)
                tgt_index.setdefault(val, []).append(node_id)

            src_pk_cols = pk_metadata.get(src_table, [])
            for row in src_rows:
                val = row.get(src_field)
                if val is None:
                    continue
                if val in tgt_index:
                    src_pk_vals = [row[c] for c in src_pk_cols]
                    src_id = _make_node_id(src_table, src_pk_vals)
                    for tgt_id in tgt_index[val]:
                        _add_or_merge_edge(
                            edges,
                            src_id,
                            tgt_id,
                            label=f"值相等({src_field}↔{tgt_field})",
                            confidence=confidence,
                        )

    # ── 计算度数 ──────────────────────────────────────────
    for edge in edges.values():
        if edge.source in nodes:
            nodes[edge.source].degree += 1
        if edge.target in nodes:
            nodes[edge.target].degree += 1

    # ── 输出 ──────────────────────────────────────────────
    return {
        "nodes": [
            {
                "id": n.id,
                "source_table": n.source_table,
                "class_name": n.class_name,
                "field_values": n.field_values,
                "degree": n.degree,
            }
            for n in nodes.values()
        ],
        "edges": [
            {
                "source": e.source,
                "target": e.target,
                "labels": sorted(e.labels),
                "confidence": e.confidence,
            }
            for e in edges.values()
        ],
    }


def _add_or_merge_edge(
    edges: dict[tuple[str, str], Edge],
    node_a: str,
    node_b: str,
    label: str,
    confidence: float,
) -> None:
    """添加边或合并到已有边。

    同一对节点的多种关系合并为一条边，标签拼接，
    置信度取最高值。
    """
    key = tuple(sorted([node_a, node_b]))
    if key in edges:
        existing = edges[key]
        if label not in existing.labels:
            existing.labels.append(label)
        existing.confidence = max(existing.confidence, confidence)
    else:
        edges[key] = Edge(
            source=node_a,
            target=node_b,
            labels=[label],
            confidence=confidence,
        )
