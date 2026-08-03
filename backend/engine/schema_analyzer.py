"""Schema 分析器 — 提取数据库元数据。

从 SQLAlchemy Inspector 提取：
- 外键约束
- 索引信息
- 字段类型元数据
- class_name 候选字段

输出供流水线后续阶段使用的结构化 Schema 信息。
"""

from dataclasses import dataclass, field
from sqlalchemy.engine import Engine
from sqlalchemy.engine.reflection import Inspector
from sqlalchemy import inspect

from engine.business_fields import is_class_name_field, is_name_field


@dataclass
class FKConstraint:
    """Foreign-key metadata owned by the production schema boundary."""

    source_table: str
    source_columns: list[str]
    target_table: str
    target_columns: list[str]



# ── 数据结构 ──────────────────────────────────────────────────


@dataclass
class ColumnMeta:
    """列元数据。"""

    name: str
    type: str
    nullable: bool
    is_class_name: bool
    is_name: bool = False
    is_primary_key: bool = False


@dataclass
class IndexMeta:
    """索引元数据。"""

    name: str
    columns: list[str]
    unique: bool


@dataclass
class TableSchema:
    """单张表的完整 Schema 信息。"""

    name: str
    columns: list[ColumnMeta] = field(default_factory=list)
    primary_keys: list[str] = field(default_factory=list)
    foreign_keys: list[FKConstraint] = field(default_factory=list)
    indexes: list[IndexMeta] = field(default_factory=list)


@dataclass
class SchemaAnalysisResult:
    """Schema 分析阶段的完整输出。"""

    tables: dict[str, TableSchema]  # table_name → TableSchema
    all_foreign_keys: list[FKConstraint]
    pk_metadata: dict[str, list[str]]  # table_name → [pk_columns]


# ── 约定常量 ──────────────────────────────────────────────────

# ── 分析函数 ──────────────────────────────────────────────────


def analyze_schema(
    engine: Engine, selected_tables: list[str]
) -> SchemaAnalysisResult:
    """分析选中表的 Schema 元数据。

    Args:
        engine: SQLAlchemy Engine 实例。
        selected_tables: 用户选中的表名列表。

    Returns:
        结构化的 Schema 分析结果。
    """
    inspector = inspect(engine)
    tables: dict[str, TableSchema] = {}
    all_fks: list[FKConstraint] = []
    pk_metadata: dict[str, list[str]] = {}

    for table_name in selected_tables:
        schema = _analyze_single_table(inspector, table_name)
        tables[table_name] = schema
        all_fks.extend(schema.foreign_keys)
        pk_metadata[table_name] = schema.primary_keys

    return SchemaAnalysisResult(
        tables=tables,
        all_foreign_keys=all_fks,
        pk_metadata=pk_metadata,
    )


def _analyze_single_table(inspector: Inspector, table_name: str) -> TableSchema:
    """分析单张表的 Schema。"""
    # 列
    columns = []
    pk_cols = _get_pk_columns(inspector, table_name)
    pk_set = set(pk_cols)

    for col in inspector.get_columns(table_name):
        name = col["name"]
        col_type = str(col["type"])
        nullable = col.get("nullable", True)
        is_name = is_name_field(name)
        is_class_name = is_class_name_field(name)
        columns.append(
            ColumnMeta(
                name=name,
                type=col_type,
                nullable=nullable,
                is_name=is_name,
                is_class_name=is_class_name,
                is_primary_key=(name in pk_set),
            )
        )

    # 外键
    foreign_keys = []
    for fk in inspector.get_foreign_keys(table_name):
        foreign_keys.append(
            FKConstraint(
                source_table=table_name,
                source_columns=fk["constrained_columns"],
                target_table=fk["referred_table"],
                target_columns=fk["referred_columns"],
            )
        )

    # 索引
    indexes = []
    for idx in inspector.get_indexes(table_name):
        indexes.append(
            IndexMeta(
                name=idx["name"],
                columns=idx["column_names"],
                unique=idx.get("unique", False),
            )
        )

    return TableSchema(
        name=table_name,
        columns=columns,
        primary_keys=pk_cols,
        foreign_keys=foreign_keys,
        indexes=indexes,
    )


def _get_pk_columns(inspector: Inspector, table_name: str) -> list[str]:
    """获取表的主键列名列表。"""
    try:
        pk = inspector.get_pk_constraint(table_name)
        return pk.get("constrained_columns", [])
    except Exception:
        return []
