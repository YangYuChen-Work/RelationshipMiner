"""Pydantic 数据模型。"""

from pydantic import BaseModel, Field


class TableInfo(BaseModel):
    """数据库表基本信息。"""

    name: str


class ColumnInfo(BaseModel):
    """数据库列信息。"""

    name: str
    type: str
    is_class_name: bool
    is_primary_key: bool


class TableColumnsResponse(BaseModel):
    """表的列列表响应。"""

    table_name: str
    columns: list[ColumnInfo]


class ErrorResponse(BaseModel):
    """错误响应。"""

    detail: str
    suggestion: str


# ── 分析请求 / 响应 ──────────────────────────────────────────


class TableSelection(BaseModel):
    """单张表的分析选择。"""

    name: str
    fields: list[str]


class AnalyzeRequest(BaseModel):
    """分析任务请求。"""

    tables: list[TableSelection]


class AnalyzeResponse(BaseModel):
    """分析任务创建响应。"""

    task_id: str


# ── 图谱数据 ─────────────────────────────────────────────────


class NodeData(BaseModel):
    """图谱节点。"""

    id: str = Field(..., description="唯一标识 (表名:主键值)")
    source_table: str = Field(..., description="来源表名")
    class_name: str | None = Field(None, description="Java 类全限定名")
    field_values: dict[str, object] = Field(
        default_factory=dict, description="所有字段值"
    )
    degree: int = Field(0, description="关联度数")


class EdgeData(BaseModel):
    """图谱边。"""

    source: str = Field(..., description="源节点 ID")
    target: str = Field(..., description="目标节点 ID")
    labels: list[str] = Field(..., description="关系标签列表")
    confidence: float = Field(..., ge=0.0, le=1.0, description="置信度分数")


class GraphData(BaseModel):
    """完整图谱数据。"""

    nodes: list[NodeData]
    edges: list[EdgeData]
