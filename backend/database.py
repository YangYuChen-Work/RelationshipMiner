"""数据库连接管理 — SQLAlchemy 引擎与会话。"""

from sqlalchemy import (
    MetaData,
    Table,
    and_,
    create_engine,
    func,
    inspect,
    select,
)
from sqlalchemy.engine import Engine

from config import settings
from engine.business_fields import is_class_name_field, is_name_field
from engine.table_semantics import TableSummaryInput


def create_db_engine(database_url: str | None = None) -> Engine:
    """创建 SQLAlchemy 引擎。

    Args:
        database_url: 数据库连接字符串，默认使用 settings.database_url。

    Returns:
        SQLAlchemy Engine 实例。
    """
    url = database_url or settings.database_url
    return create_engine(url)


# 模块级引擎缓存 — 避免每次请求重建连接池
_engine: Engine | None = None


def get_engine() -> Engine:
    """FastAPI 依赖注入 — 返回缓存的默认数据库引擎。

    引擎在首次调用时创建，后续调用复用同一实例。
    """
    global _engine
    if _engine is None:
        _engine = create_db_engine()
    return _engine


def get_table_names(engine: Engine) -> list[str]:
    """获取数据库中所有用户表名。

    Args:
        engine: SQLAlchemy Engine 实例。

    Returns:
        表名字符串列表，按字母排序。
    """
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    return sorted(tables)


def get_table_columns(
    engine: Engine, table_name: str
) -> list[dict[str, str | bool]]:
    """获取指定表的所有列信息。

    Args:
        engine: SQLAlchemy Engine 实例。
        table_name: 表名。

    Returns:
        列信息列表，每项包含 name、type、is_class_name、is_primary_key 字段。
    """
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)

    # 获取主键列名
    try:
        pk_constraint = inspector.get_pk_constraint(table_name)
        primary_key_columns = set(
            pk_constraint.get("constrained_columns") or []
        )
    except Exception:
        primary_key_columns = set()

    # 约定命名识别 class_name 字段
    result = []
    for col in columns:
        name = col["name"]
        col_type = str(col["type"])
        is_name = is_name_field(name)
        is_class_name = is_class_name_field(name)
        is_primary_key = name in primary_key_columns
        result.append(
            {
                "name": name,
                "type": col_type,
                "is_name": is_name,
                "is_class_name": is_class_name,
                "is_primary_key": is_primary_key,
            }
        )
    return result


def get_table_summary_input(
    engine: Engine,
    table_name: str,
    sample_limit: int = 3,
) -> TableSummaryInput:
    """Collect a bounded table summary input without loading arbitrary rows."""

    metadata = MetaData()
    table = Table(
        table_name,
        metadata,
        autoload_with=engine,
        resolve_fks=False,
    )
    name_column = next(
        (column for column in table.columns if is_name_field(column.name)),
        None,
    )
    class_name_column = next(
        (
            column
            for column in table.columns
            if is_class_name_field(column.name)
        ),
        None,
    )
    if name_column is None or class_name_column is None:
        raise ValueError(
            f"Table {table_name} is missing required name and class_name fields"
        )

    bounded_limit = max(0, min(int(sample_limit), 3))
    sample_query = (
        select(name_column, class_name_column)
        .where(
            and_(
                name_column.is_not(None),
                func.trim(name_column) != "",
                class_name_column.is_not(None),
                func.trim(class_name_column) != "",
            )
        )
        .limit(bounded_limit)
    )
    primary_key_columns = list(table.primary_key.columns)
    if primary_key_columns:
        sample_query = sample_query.order_by(*primary_key_columns)

    with engine.connect() as connection:
        row_count = connection.execute(
            select(func.count()).select_from(table)
        ).scalar_one()
        rows = connection.execute(sample_query).all()

    return TableSummaryInput(
        table_name=table_name,
        row_count=int(row_count),
        name_samples=[str(row[0]).strip()[:80] for row in rows],
        class_name_samples=[str(row[1]).strip()[:80] for row in rows],
        column_names=[column.name for column in table.columns],
    )
