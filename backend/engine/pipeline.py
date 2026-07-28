"""分析流水线编排器。

5 阶段流水线：
1. 数据读取 — SELECT 拉取选中表与字段的全量数据
2. Schema 分析 — 外键、索引、字段类型元数据
3. AI 决策 — DeepSeek API 字段语义匹配 + 算法推荐
4. 关系计算 — FK 追踪 + 精确值相等
5. 图谱生成 — 组装最终 GraphData

支持 3 分钟超时（可通过 timeout_seconds 参数配置）。
"""

import asyncio
import logging
from collections.abc import Callable, Awaitable
from dataclasses import asdict
from sqlalchemy.engine import Engine
from sqlalchemy import Table, MetaData

from engine.schema_analyzer import analyze_schema
from engine.relationship_computer import compute_relationships
from engine.ai_decision_maker import (
    decide_matches,
    FieldMatchDecision,
)

logger = logging.getLogger(__name__)

# 进度回调类型：(phase: int, message: str, progress: float) -> None
ProgressCallback = Callable[[int, str, float], None] | Callable[
    [int, str, float], Awaitable[None]
]

# ── 超时异常 ──────────────────────────────────────────────────


class AnalysisTimeoutError(Exception):
    """分析超时异常。"""

    def __init__(self, elapsed: float):
        self.elapsed = elapsed
        super().__init__(
            f"分析超时（{elapsed:.0f} 秒），建议减少表数量或行数后重试"
        )


# ── 流水线 ────────────────────────────────────────────────────


async def run_analysis_pipeline(
    engine: Engine,
    tables: list[dict],
    on_progress: ProgressCallback | None = None,
    timeout_seconds: float = 180.0,
) -> dict:
    """运行完整的 5 阶段分析流水线。

    Args:
        engine: SQLAlchemy Engine 实例。
        tables: [{name: str, fields: [str]}] — 用户选择的表和字段。
        on_progress: 进度回调，接收 (phase, message, progress)。
        timeout_seconds: 分析超时秒数，默认 180（3 分钟）。

    Returns:
        {
            "graph": {nodes, edges} — 图谱数据,
            "records": {table_name: [row_dict]} — 原始数据,
            "ai_decisions": [FieldMatchDecision] — AI 字段匹配决策,
            "class_name_fields": {table_name: str|None} — class_name 字段映射,
        }

    Raises:
        AnalysisTimeoutError: 分析超时。
    """
    selected_names = [t["name"] for t in tables]

    async def progress(phase: int, message: str, progress_val: float):
        if on_progress:
            result = on_progress(phase, message, progress_val)
            # 支持同步和异步回调
            if hasattr(result, "__await__"):
                await result

    start_time = asyncio.get_event_loop().time()

    def check_timeout():
        elapsed = asyncio.get_event_loop().time() - start_time
        if elapsed > timeout_seconds:
            raise AnalysisTimeoutError(elapsed)

    # ── 阶段 1: 数据读取 ─────────────────────────────────
    await progress(1, "正在读取数据...", 0.05)
    records: dict[str, list[dict]] = {}

    for table_cfg in tables:
        check_timeout()
        tname = table_cfg["name"]
        fields = table_cfg["fields"]
        metadata = MetaData()
        table = Table(tname, metadata, autoload_with=engine)
        columns = [table.c[f] for f in fields]
        from sqlalchemy import select as sa_select

        with engine.connect() as conn:
            result = conn.execute(sa_select(*columns))
            rows = []
            for row in result:
                rows.append(dict(row._mapping))
            records[tname] = rows

    await progress(1, f"数据读取完成，共 {sum(len(r) for r in records.values())} 条记录", 0.15)

    # ── 阶段 2: Schema 分析 ──────────────────────────────
    check_timeout()
    await progress(2, "正在分析 Schema...", 0.20)

    schema_result = analyze_schema(engine, selected_names)

    # 构建 class_name 字段映射
    class_name_fields: dict[str, str | None] = {}
    for tname, tschema in schema_result.tables.items():
        cn_cols = [c.name for c in tschema.columns if c.is_class_name]
        class_name_fields[tname] = cn_cols[0] if cn_cols else None

    await progress(
        2,
        f"Schema 分析完成，发现 {len(schema_result.all_foreign_keys)} 个外键约束",
        0.30,
    )

    # ── 阶段 3: AI 决策 ──────────────────────────────────
    check_timeout()
    await progress(3, "正在分析字段语义匹配...", 0.35)

    # 构建 AI 分析所需的 schema 信息
    table_schemas_for_ai: list[dict] = []
    for tname in selected_names:
        tschema = schema_result.tables.get(tname)
        if tschema is None:
            continue
        columns = [
            {"name": c.name, "type": c.type} for c in tschema.columns
        ]
        table_schemas_for_ai.append({"name": tname, "columns": columns})

    # 提取采样值（每表 1 行）
    sample_values: dict[str, list[dict]] = {}
    for tname in selected_names:
        rows = records.get(tname, [])
        if rows:
            sample_values[tname] = [rows[0]]

    try:
        ai_decision_objects = decide_matches(
            table_schemas=table_schemas_for_ai,
            sample_values=sample_values,
        )
        ai_decisions = [asdict(d) for d in ai_decision_objects]
        match_count = len(ai_decisions)
        await progress(
            3,
            f"语义分析完成，AI 推荐 {match_count} 对字段匹配",
            0.40,
        )
    except Exception:
        logger.warning("AI 决策失败，继续仅执行 FK 分析", exc_info=True)
        ai_decisions = []
        await progress(
            3,
            "AI 服务暂不可用，请稍后重试",
            0.40,
        )

    # ── 阶段 4: 关系计算 ────────────────────────────────
    check_timeout()
    await progress(4, "正在计算关系...", 0.45)

    graph = compute_relationships(
        records=records,
        pk_metadata=schema_result.pk_metadata,
        fk_constraints=schema_result.all_foreign_keys,
        ai_decisions=ai_decisions,
    )

    await progress(
        4,
        f"关系计算完成，发现 {len(graph['edges'])} 条边",
        0.80,
    )

    # ── 阶段 5: 图谱生成 ────────────────────────────────
    check_timeout()
    await progress(5, "正在生成图谱...", 0.90)

    # 补充节点的 class_name（从记录中提取）
    for node in graph["nodes"]:
        if node["class_name"] is None:
            tn = node["source_table"]
            cn_field = class_name_fields.get(tn)
            if cn_field and cn_field in node["field_values"]:
                node["class_name"] = node["field_values"][cn_field]

    await progress(5, "图谱生成完成", 1.0)

    return {
        "graph": graph,
        "records": records,
        "ai_decisions": ai_decisions,
        "class_name_fields": class_name_fields,
    }
