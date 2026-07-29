"""Deterministic planner, embedding, and judge adapters at production seams."""

from __future__ import annotations

from engine.semantic.models import (
    CandidateGroup,
    EntityDocument,
    EntityRelation,
    JudgementBatchResult,
    JudgementGroupOutcome,
    RelationEvidence,
    RelationshipPlan,
)


FIXTURE_MODEL_ID = "fixture-semantic-model-v1"
FIXTURE_TASK_ID = "integration-task-1"


class ExactBusinessPlanner:
    """Return exactly the two approved cross-table business plans."""

    def __init__(self) -> None:
        self.calls = 0
        self.plans = [
            RelationshipPlan(
                source_table="requirements",
                target_table="operations",
                relation_type="人员行为",
                direction="source_to_target",
                source_dimensions=[
                    "title",
                    "creator_name",
                    "creator_employee_no",
                ],
                target_dimensions=[
                    "action",
                    "operator_name",
                    "operator_employee_no",
                ],
                retrieval_modes=["semantic"],
                candidate_limit_per_source=4,
                reason="需求创建人和操作人可通过姓名与工号确认人员行为。",
            ),
            RelationshipPlan(
                source_table="processes",
                target_table="parts",
                relation_type="工艺涉及零件",
                direction="source_to_target",
                source_dimensions=["process_name", "description"],
                target_dimensions=["part_name", "part_code", "description"],
                retrieval_modes=["semantic"],
                candidate_limit_per_source=4,
                reason="工艺名称和描述可说明其涉及的具体零件。",
            ),
        ]

    async def plan(
        self,
        *args: object,
        **kwargs: object,
    ) -> list[RelationshipPlan]:
        self.calls += 1
        return list(self.plans)


class FixtureEmbeddingAdapter:
    """Make every scoped target retrievable without bypassing retrieval."""

    def __init__(self) -> None:
        self.document_batches: list[list[str]] = []
        self.query_batches: list[list[str]] = []

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        self.document_batches.append(list(texts))
        return [[1.0, 0.0] for _ in texts]

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        self.query_batches.append(list(texts))
        return [[1.0, 0.0] for _ in texts]


class FixtureSemanticJudge:
    """Approve only explicit business matches and record rejected candidates."""

    def __init__(self) -> None:
        self.rejected_entity_ids: set[str] = set()

    async def judge_groups(
        self,
        groups: list[CandidateGroup],
        deadline: float,
    ) -> JudgementBatchResult:
        if hasattr(groups, "__aiter__"):
            groups = [group async for group in groups]
        else:
            groups = list(groups)
        decisions: list[EntityRelation] = []
        for group in groups:
            for candidate in group.candidates:
                decision = self._person_decision(group, candidate)
                if decision is None:
                    decision = self._part_decision(group, candidate)
                if decision is None:
                    self.rejected_entity_ids.add(candidate.entity_id)
                else:
                    decisions.append(decision)
        return JudgementBatchResult(
            decisions=decisions,
            completed_groups=len(groups),
            outcomes=[JudgementGroupOutcome(
                source_id=group.source.entity_id,
                candidate_count=len(group.candidates),
                status="completed",
            ) for group in groups],
        )

    @staticmethod
    def _person_decision(
        group: CandidateGroup,
        candidate: EntityDocument,
    ) -> EntityRelation | None:
        if group.plan.relation_type != "人员行为":
            return None
        source = group.source
        if (
            candidate.dimensions["operator_name"]
            != source.dimensions["creator_name"]
            or candidate.dimensions["operator_employee_no"]
            != source.dimensions["creator_employee_no"]
        ):
            return None
        return EntityRelation(
            source=source.entity_id,
            target=candidate.entity_id,
            relation_type=group.plan.relation_type,
            direction=group.plan.direction,
            strength="weak",
            confidence=0.97,
            explanation=(
                f"需求创建人张三（工号 EMP-001）与“"
                f"{candidate.dimensions['action']}”的操作人姓名、工号均一致，"
                "确认属于同一人员的业务行为。"
            ),
            evidence=[
                RelationEvidence(
                    source_field="creator_name",
                    source_value=source.dimensions["creator_name"],
                    target_field="operator_name",
                    target_value=candidate.dimensions["operator_name"],
                    method="llm_semantic_reasoning",
                    reason="创建人与操作人的姓名一致。",
                ),
                RelationEvidence(
                    source_field="creator_employee_no",
                    source_value=source.dimensions["creator_employee_no"],
                    target_field="operator_employee_no",
                    target_value=candidate.dimensions["operator_employee_no"],
                    method="llm_semantic_reasoning",
                    reason="姓名相同且员工工号一致，可排除同名人员。",
                ),
            ],
            model_id=FIXTURE_MODEL_ID,
            task_id=FIXTURE_TASK_ID,
        )

    @staticmethod
    def _part_decision(
        group: CandidateGroup,
        candidate: EntityDocument,
    ) -> EntityRelation | None:
        if group.plan.relation_type != "工艺涉及零件":
            return None
        if not str(candidate.dimensions["part_code"]).startswith("RTR-"):
            return None
        source = group.source
        return EntityRelation(
            source=source.entity_id,
            target=candidate.entity_id,
            relation_type=group.plan.relation_type,
            direction=group.plan.direction,
            strength="weak",
            confidence=0.94,
            explanation=(
                f"转子装配工艺说明明确包含{candidate.dimensions['part_name']}，"
                "该记录是实际装配零件而不是名称相似的工艺文件。"
            ),
            evidence=[
                RelationEvidence(
                    source_field="description",
                    source_value=source.dimensions["description"],
                    target_field="part_name",
                    target_value=candidate.dimensions["part_name"],
                    method="llm_semantic_reasoning",
                    reason="工艺描述明确列出该零件名称。",
                ),
                RelationEvidence(
                    source_field="process_name",
                    source_value=source.dimensions["process_name"],
                    target_field="part_code",
                    target_value=candidate.dimensions["part_code"],
                    method="llm_semantic_reasoning",
                    reason="零件编码属于转子装配零件系列。",
                ),
            ],
            model_id=FIXTURE_MODEL_ID,
            task_id=FIXTURE_TASK_ID,
        )
