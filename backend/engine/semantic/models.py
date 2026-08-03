from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator


def is_safe_business_relation_label(value: str) -> bool:
    """Return whether a label is short, business-facing Han text only."""
    candidate = value.strip()
    return 2 <= len(candidate) <= 12 and all(
        "\u3400" <= character <= "\u9fff" for character in candidate
    )


class _BusinessRelationLabelModel(BaseModel):
    display_label: str = "相关"

    @field_validator("display_label")
    @classmethod
    def validate_display_label(cls, value: str) -> str:
        if not is_safe_business_relation_label(value):
            raise ValueError(
                "display_label must contain 2-12 business-facing Chinese characters"
            )
        return value


class AnalysisStatus(str, Enum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    FAILED = "failed"


class TableScope(BaseModel):
    name: str
    dimensions: list[str]


class AnalysisScope(BaseModel):
    tables: list[TableScope] = Field(min_length=1, max_length=10)
    time_budget_seconds: float = Field(default=180.0, gt=0, le=600.0)


class AnalysisDiagnostics(BaseModel):
    entities_read: int = 0
    plans_created: int = 0
    candidates_retrieved: int = 0
    candidates_completed: int = 0
    candidates_pending: int = 0
    strong_edges_created: int = 0
    weak_edges_created: int = 0


class EntityDocument(BaseModel):
    entity_id: str
    table_name: str
    display_name: str
    display_code: str | None = None
    class_name: str | None = None
    dimensions: dict[str, object]
    normalized_dimensions: dict[str, str]
    search_text: str


class RelationshipPlan(_BusinessRelationLabelModel):
    source_table: str
    target_table: str
    relation_type: str
    direction: Literal["source_to_target", "target_to_source", "undirected"]
    source_dimensions: list[str]
    target_dimensions: list[str]
    retrieval_modes: list[Literal["keyword", "semantic"]]
    candidate_limit_per_source: int = Field(default=20, ge=1, le=50)
    reason: str


class CandidateGroup(BaseModel):
    plan: RelationshipPlan
    source: EntityDocument
    candidates: list[EntityDocument]


class EntitySignatureGroup(BaseModel):
    representative: EntityDocument
    entity_ids: list[str]


class RelationEvidence(BaseModel):
    source_field: str
    source_value: object
    target_field: str
    target_value: object
    method: Literal[
        "foreign_key",
        "unique_identifier",
        "relation_table",
        "llm_semantic_reasoning",
    ]
    reason: str


class RelationDecision(_BusinessRelationLabelModel):
    source: str
    target: str
    relation_type: str
    direction: Literal["source_to_target", "target_to_source", "undirected"]
    strength: Literal["strong", "weak"]
    confidence: float = Field(ge=0, le=1)
    explanation: str
    evidence: list[RelationEvidence] = Field(min_length=1)


class EntityRelation(RelationDecision):
    model_id: str | None = None
    task_id: str | None = None


class EntityEdge(BaseModel):
    id: str
    source: str
    target: str
    relations: list[EntityRelation] = Field(min_length=1)


class EntityNode(BaseModel):
    id: str
    table_id: str
    display_name: str
    display_name_source: Literal["name"] = "name"
    display_code: str | None = None
    class_name: str | None = None
    dimensions: dict[str, object]


class TableNode(BaseModel):
    id: str
    display_name: str
    entity_count: int


class TableEdge(BaseModel):
    id: str
    source_table: str
    target_table: str
    relation_types: list[str]
    strong_count: int
    weak_count: int
    entity_edge_count: int
    average_confidence: float
    supporting_entity_edges: list[str]


class JudgementBatchResult(BaseModel):
    decisions: list[RelationDecision]
    completed_groups: int = 0
    failed_groups: int = 0
    pending_groups: int = 0
    outcomes: list["JudgementGroupOutcome"] = Field(default_factory=list)
    peak_live_tasks: int = 0
    peak_live_groups: int = 0


class JudgementGroupOutcome(BaseModel):
    source_id: str
    candidate_count: int
    status: Literal["completed", "failed", "pending"]


class AnalysisResult(BaseModel):
    status: AnalysisStatus
    table_nodes: list[TableNode]
    entity_nodes: list[EntityNode]
    table_edges: list[TableEdge]
    entity_edges: list[EntityEdge]
    diagnostics: AnalysisDiagnostics
    warnings: list[str]
