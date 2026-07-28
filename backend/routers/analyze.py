"""分析任务 API — 提交分析 + WebSocket 进度推送 + 导出。"""

import uuid
from fastapi import APIRouter, Depends, WebSocket, HTTPException
from sqlalchemy.engine import Engine

from database import get_engine
from models.schemas import AnalyzeRequest, AnalyzeResponse
from engine.pipeline import run_analysis_pipeline, AnalysisTimeoutError

router = APIRouter(prefix="/api", tags=["analyze"])

# 任务注册表：task_id → {"status": "pending"|"running"|"done"|"error", ...}
_task_registry: dict[str, dict] = {}


@router.post("/analyze", response_model=AnalyzeResponse)
def create_analysis_task(
    request: AnalyzeRequest,
    engine: Engine = Depends(get_engine),
):
    """提交分析任务，返回 task_id。

    前端使用该 task_id 连接 WebSocket 获取实时进度。
    """
    # 验证：至少 1 张表
    if not request.tables:
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "请至少选择一张表",
                "suggestion": "在左侧面板中勾选要分析的数据表",
            },
        )

    # 验证表存在
    from database import get_table_names

    table_names = get_table_names(engine)
    for t in request.tables:
        if t.name not in table_names:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": f"表 '{t.name}' 不存在",
                    "suggestion": "请刷新页面获取最新的表列表",
                },
            )

    # 验证字段存在
    from database import get_table_columns

    for t in request.tables:
        columns = get_table_columns(engine, t.name)
        valid_names = {c["name"] for c in columns}
        for f in t.fields:
            if f not in valid_names:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": f"表 '{t.name}' 中不存在字段 '{f}'",
                        "suggestion": f"可用字段: {', '.join(sorted(valid_names))}",
                    },
                )

    task_id = str(uuid.uuid4())
    _task_registry[task_id] = {
        "status": "pending",
        "request": request.model_dump(),
    }
    return {"task_id": task_id}


@router.websocket("/ws/analyze/{task_id}")
async def analyze_progress(
    ws: WebSocket,
    task_id: str,
    engine: Engine = Depends(get_engine),
):
    """WebSocket 端点 — 推送分析进度与最终图谱。

    消息格式：
    - 进度消息: {phase: int, message: str, progress: float}
    - 完成消息: {phase: 5, message: str, progress: 1.0, graph: {nodes, edges}}
    """
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
        tables = task["request"]["tables"]

        async def send_progress(phase: int, message: str, progress: float):
            await ws.send_json(
                {"phase": phase, "message": message, "progress": progress}
            )

        result = await run_analysis_pipeline(
            engine=engine,
            tables=tables,
            on_progress=send_progress,
        )

        graph = result["graph"]

        # 发送最终完成消息（含图谱数据）
        await ws.send_json(
            {
                "phase": 5,
                "message": "分析完成",
                "progress": 1.0,
                "graph": graph,
            }
        )

        task["status"] = "done"
        task["graph"] = graph
        task["records"] = result["records"]
        task["ai_decisions"] = result["ai_decisions"]
        task["class_name_fields"] = result["class_name_fields"]

    except AnalysisTimeoutError as e:
        task["status"] = "error"
        task["error"] = str(e)
        try:
            await ws.send_json(
                {
                    "phase": -1,
                    "message": str(e),
                    "progress": 0.0,
                    "error": str(e),
                }
            )
        except Exception:
            pass
    except Exception as e:
        task["status"] = "error"
        task["error"] = str(e)
        try:
            await ws.send_json(
                {
                    "phase": -1,
                    "message": f"分析失败: {str(e)}",
                    "progress": 0.0,
                    "error": str(e),
                }
            )
        except Exception:
            pass

    finally:
        try:
            await ws.close()
        except Exception:
            pass


# ── 导出端点 ──────────────────────────────────────────────────


@router.get("/export/{task_id}")
def export_analysis_snapshot(task_id: str):
    """返回分析结果的完整 JSON 快照。

    包含：
    - graph: 图谱数据（节点 + 边）
    - raw_data: 所有字段原始值（按表分组）
    - config: 分析配置（表/字段选择 + AI 决策）
    - layout: 布局坐标（由前端 D3 填充，后端返回空列表）
    """
    task = _task_registry.get(task_id)
    if task is None:
        raise HTTPException(
            status_code=404,
            detail={
                "detail": "任务不存在或已过期",
                "suggestion": "请重新运行分析后再导出",
            },
        )

    if task["status"] != "done":
        raise HTTPException(
            status_code=400,
            detail={
                "detail": "分析尚未完成，无法导出",
                "suggestion": f"当前状态: {task['status']}，请等待分析完成后再导出",
            },
        )

    # AI 决策已在 pipeline 中通过 asdict() 转换为 dict，直接使用
    ai_decisions_serializable = task.get("ai_decisions", [])

    return {
        "graph": task.get("graph"),
        "raw_data": task.get("records", {}),
        "config": {
            "tables": task.get("request", {}).get("tables", []),
            "ai_decisions": ai_decisions_serializable,
            "class_name_fields": task.get("class_name_fields", {}),
        },
        "layout": [],
    }
