"""表与字段浏览 API。"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from database import get_engine, get_table_names, get_table_columns
from models.schemas import TableInfo, ColumnInfo, TableColumnsResponse

router = APIRouter(prefix="/api", tags=["tables"])


def _database_unavailable() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "code": "database_unavailable",
            "message": "数据库连接不可用，请检查数据库配置和服务状态",
            "suggestion": (
                "确认 DB_HOST、DB_PORT、DB_USER、DB_PASSWORD、DB_NAME 配置正确，"
                "并确保 MySQL 服务正在运行"
            ),
        },
    )


@router.get("/tables", response_model=list[TableInfo])
def list_tables(engine: Engine = Depends(get_engine)):
    """返回数据库中所有表名列表。"""
    try:
        names = get_table_names(engine)
        return [TableInfo(name=n) for n in names]
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_unavailable() from exc


@router.get(
    "/tables/{table_name}/fields",
    response_model=TableColumnsResponse,
)
def list_fields(table_name: str, engine: Engine = Depends(get_engine)):
    """返回指定表的字段名、类型，并标记 class_name 候选字段。

    class_name 候选字段通过约定命名自动识别：
    - `class_name`
    - `className`
    - `class`
    """
    try:
        names = get_table_names(engine)

        if table_name not in names:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": f"表 '{table_name}' 不存在",
                    "suggestion": f"可用的表: {', '.join(names)}",
                },
            )

        columns_raw = get_table_columns(engine, table_name)
        columns = [
            ColumnInfo(
                name=c["name"],
                type=c["type"],
                is_name=c["is_name"],
                is_class_name=c["is_class_name"],
                is_primary_key=c["is_primary_key"],
            )
            for c in columns_raw
        ]

        return TableColumnsResponse(table_name=table_name, columns=columns)

    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_unavailable() from exc
