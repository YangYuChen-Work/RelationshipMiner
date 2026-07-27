"""数据库连接管理 — SQLAlchemy 引擎与会话。"""

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import Engine

from config import settings


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
) -> list[dict[str, str]]:
    """获取指定表的所有列信息。

    Args:
        engine: SQLAlchemy Engine 实例。
        table_name: 表名。

    Returns:
        列信息列表，每项包含 name、type、is_class_name 字段。
    """
    inspector = inspect(engine)
    columns = inspector.get_columns(table_name)

    # 约定命名识别 class_name 字段
    CLASS_NAME_CANDIDATES = {"class_name", "classname", "class"}

    result = []
    for col in columns:
        name = col["name"]
        col_type = str(col["type"])
        is_class_name = name.lower() in CLASS_NAME_CANDIDATES
        result.append(
            {
                "name": name,
                "type": col_type,
                "is_class_name": is_class_name,
            }
        )
    return result
