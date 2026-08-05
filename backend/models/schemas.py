"""Pydantic 数据模型。"""

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class TableInfo(BaseModel):
    """数据库表基本信息。"""

    name: str


class ColumnInfo(BaseModel):
    """数据库列信息。"""

    name: str
    type: str
    is_name: bool
    is_class_name: bool
    is_primary_key: bool
    is_foreign_key: bool


class DatabaseInfoResponse(BaseModel):
    """Safe connection metadata for the data-selection workspace."""

    connection_status: Literal["connected", "unavailable"]
    database_name: str
    connection_address: str
    table_count: int


class TableColumnsResponse(BaseModel):
    """表的列列表响应。"""

    table_name: str
    columns: list[ColumnInfo]


class TableBusinessSummaryResponse(BaseModel):
    """Response-safe business summary for one database table."""

    table_name: str
    semantic_name: str
    row_count: int
    name_samples: list[str]
    status: Literal["inferred", "fallback"]


class ErrorResponse(BaseModel):
    """错误响应。"""

    detail: str
    suggestion: str


# ── 分析请求 / 响应 ──────────────────────────────────────────


class TableSelection(BaseModel):
    """单张表的分析选择。"""

    name: str
    dimensions: list[str] = Field(
        validation_alias=AliasChoices("dimensions", "fields"),
        serialization_alias="dimensions",
    )

    @property
    def fields(self) -> list[str]:
        """Legacy read-only alias used by older callers."""
        return self.dimensions


class AnalyzeRequest(BaseModel):
    """分析任务请求。"""

    tables: list[TableSelection]
    metadata_revision: str | None = Field(default=None, max_length=80)


class AnalyzeResponse(BaseModel):
    """分析任务创建响应。"""

    task_id: str


class NaturalLanguageSelectionRequest(BaseModel):
    """The only client-controlled inputs to natural-language selection."""

    model_config = ConfigDict(extra="forbid")

    request_id: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=1000)


class NaturalLanguageSelectedTable(BaseModel):
    """One safe, expanded table selection for the existing analysis UI."""

    table_name: str
    auxiliary_fields: list[str]
    reason: str
    matched_terms: list[str] = Field(default_factory=list)


class NaturalLanguageSelectionResponse(BaseModel):
    """Public selected or clarification response, with stable provenance."""

    status: Literal["selected", "needs_clarification"]
    request_id: str
    metadata_revision: str
    glossary_version: str
    selector_version: str
    tables: list[NaturalLanguageSelectedTable] = Field(default_factory=list)
    reason_code: str | None = None
    guidance: str | None = None
    suggested_questions: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class NaturalLanguageSelectionUnavailableResponse(BaseModel):
    """Safe error payload that never exposes provider or configuration details."""

    status: Literal["unavailable"]
    reason_code: str
    guidance: str


class NaturalLanguageSelectionInvalidRequestResponse(BaseModel):
    """A fixed validation error that does not echo client input."""

    status: Literal["invalid_request"]
    message: str


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
