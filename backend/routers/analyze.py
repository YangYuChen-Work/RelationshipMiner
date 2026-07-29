"""Semantic analysis submission, progress, and result export endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, WebSocket
from sqlalchemy.engine import Engine

from database import get_engine, get_table_columns, get_table_names
from engine.pipeline import run_analysis_pipeline
from engine.semantic.models import AnalysisDiagnostics, AnalysisResult, AnalysisStatus
from models.schemas import AnalyzeRequest, AnalyzeResponse

router = APIRouter(prefix="/api", tags=["analyze"])
_task_registry: dict[str, dict[str, object]] = {}


@router.post("/analyze", response_model=AnalyzeResponse)
def create_analysis_task(
    request: AnalyzeRequest,
    engine: Engine = Depends(get_engine),
) -> AnalyzeResponse:
    if not request.tables:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "请至少选择一张表",
                "suggestion": "在左侧面板中勾选要分析的数据表",
            },
        )

    table_names = set(get_table_names(engine))
    for table in request.tables:
        if table.name not in table_names:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": f"表 '{table.name}' 不存在",
                    "suggestion": "请刷新页面获取最新的表列表",
                },
            )
        valid_dimensions = {
            column["name"] for column in get_table_columns(engine, table.name)
        }
        unknown = set(table.dimensions) - valid_dimensions
        if unknown:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"表 '{table.name}' 中不存在字段: "
                        f"{', '.join(sorted(unknown))}"
                    ),
                    "suggestion": f"可用字段: {', '.join(sorted(valid_dimensions))}",
                },
            )

    task_id = str(uuid.uuid4())
    _task_registry[task_id] = {
        "status": "pending",
        "request": request.model_dump(),
    }
    return AnalyzeResponse(task_id=task_id)


@router.websocket("/ws/analyze/{task_id}")
async def analyze_progress(
    ws: WebSocket,
    task_id: str,
    engine: Engine = Depends(get_engine),
) -> None:
    await ws.accept()
    task = _task_registry.get(task_id)
    if task is None:
        await ws.send_json({"error": "任务不存在", "task_id": task_id})
        await ws.close()
        return
    if task["status"] == "running":
        await ws.send_json({"error": "任务已在执行中", "task_id": task_id})
        await ws.close()
        return

    task["status"] = "running"
    try:
        async def send_progress(event: dict[str, object]) -> None:
            await ws.send_json(event)

        result = await run_analysis_pipeline(
            engine=engine,
            tables=task["request"]["tables"],
            on_progress=send_progress,
        )
        result_payload = result.model_dump(mode="json")
        graph = {
            key: result_payload[key]
            for key in (
                "table_nodes",
                "entity_nodes",
                "table_edges",
                "entity_edges",
            )
        }
        final = {
            "phase": "complete",
            "progress": 1.0,
            "status": result_payload["status"],
            "graph": graph,
            "diagnostics": result_payload["diagnostics"],
            "warnings": result_payload["warnings"],
        }
        task["status"] = "done"
        # Keep the domain result, not a parallel export-specific snapshot.
        task["result"] = result
        await ws.send_json(final)
    except Exception as error:
        result = AnalysisResult(
            status=AnalysisStatus.FAILED,
            table_nodes=[],
            entity_nodes=[],
            table_edges=[],
            entity_edges=[],
            diagnostics=AnalysisDiagnostics(),
            warnings=[f"Analysis failed: {error}"],
        )
        result_payload = result.model_dump(mode="json")
        task["status"] = "done"
        task["result"] = result
        try:
            await ws.send_json(
                {
                    "phase": "complete",
                    "progress": 1.0,
                    "status": "failed",
                    "graph": {
                        key: result_payload[key]
                        for key in (
                            "table_nodes",
                            "entity_nodes",
                            "table_edges",
                            "entity_edges",
                        )
                    },
                    "diagnostics": result_payload["diagnostics"],
                    "warnings": result_payload["warnings"],
                }
            )
        except Exception:
            pass
    finally:
        try:
            await ws.close()
        except Exception:
            pass


@router.get("/export/{task_id}")
def export_analysis_snapshot(task_id: str) -> dict[str, object]:
    task = _task_registry.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="任务不存在")
    if task["status"] != "done":
        raise HTTPException(status_code=400, detail="分析尚未完成")
    result = task["result"]
    assert isinstance(result, AnalysisResult)
    result_payload = result.model_dump(mode="json")
    return {
        "status": result_payload["status"],
        "graph": {
            key: result_payload[key]
            for key in (
                "table_nodes",
                "entity_nodes",
                "table_edges",
                "entity_edges",
            )
        },
        "diagnostics": result_payload["diagnostics"],
        "warnings": result_payload["warnings"],
    }
