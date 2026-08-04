"""表与字段浏览 API。"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from config import settings
from database import (
    get_engine,
    get_table_columns,
    get_table_names,
    get_table_summary_input,
)
from engine.deepseek_client import DeepSeekJsonAdapter
from engine.table_semantics import (
    TableBusinessSummary,
    TableSummaryInput,
    fallback_semantic_name,
    infer_table_summaries,
)
from models.schemas import (
    ColumnInfo,
    DatabaseInfoResponse,
    TableBusinessSummaryResponse,
    TableColumnsResponse,
    TableInfo,
)

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


def _collect_table_summary_inputs(engine: Engine) -> list[TableSummaryInput]:
    inputs: list[TableSummaryInput] = []
    for table_name in get_table_names(engine):
        try:
            inputs.append(get_table_summary_input(engine, table_name))
        except ValueError:
            # Such tables stay visible through /api/tables, but cannot
            # provide the two required business-role samples.
            continue
    return inputs


def _fallback_summaries(
    inputs: list[TableSummaryInput],
) -> list[TableBusinessSummary]:
    return [
        TableBusinessSummary(
            table_name=summary_input.table_name,
            semantic_name=fallback_semantic_name(summary_input.table_name),
            row_count=summary_input.row_count,
            name_samples=summary_input.name_samples,
            status="fallback",
        )
        for summary_input in inputs
    ]


def _database_address() -> str:
    """Return connection location only; credentials must never reach clients."""
    return f"{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"


@router.get("/database-info", response_model=DatabaseInfoResponse)
def database_info(engine: Engine = Depends(get_engine)):
    """Return safe database connection facts for the selection workspace."""
    try:
        table_count = len(get_table_names(engine))
    except (SQLAlchemyError, RuntimeError):
        return DatabaseInfoResponse(
            connection_status="unavailable",
            database_name=settings.DB_NAME,
            connection_address=_database_address(),
            table_count=0,
        )

    return DatabaseInfoResponse(
        connection_status="connected",
        database_name=settings.DB_NAME,
        connection_address=_database_address(),
        table_count=table_count,
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
    "/table-summaries",
    response_model=list[TableBusinessSummaryResponse],
)
async def list_table_summaries(engine: Engine = Depends(get_engine)):
    """Return bounded summaries without exposing inference failures."""

    try:
        inputs = await asyncio.to_thread(_collect_table_summary_inputs, engine)
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_unavailable() from exc

    try:
        summaries = await infer_table_summaries(inputs, DeepSeekJsonAdapter())
    except Exception:
        summaries = _fallback_summaries(inputs)
    return [
        TableBusinessSummaryResponse(**summary.model_dump())
        for summary in summaries
    ]


@router.get(
    "/tables/{table_name}/fields",
    response_model=TableColumnsResponse,
)
def list_fields(table_name: str, engine: Engine = Depends(get_engine)):
    """返回字段类型、业务角色以及主外键浏览元数据。

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
                is_foreign_key=c["is_foreign_key"],
            )
            for c in columns_raw
        ]

        return TableColumnsResponse(table_name=table_name, columns=columns)

    except HTTPException:
        raise
    except (SQLAlchemyError, RuntimeError) as exc:
        raise _database_unavailable() from exc
