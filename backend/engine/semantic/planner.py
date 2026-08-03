from __future__ import annotations

import json

from pydantic import BaseModel

from config import settings
from engine.schema_analyzer import TableSchema

from .interfaces import JsonLlmAdapter
from .models import AnalysisScope, RelationshipPlan


class _PlanEnvelope(BaseModel):
    plans: list[RelationshipPlan]


class PlanValidationError(ValueError):
    """Raised when an LLM plan cannot be used safely and deterministically."""


class RelationshipPlanner:
    def __init__(self, llm: JsonLlmAdapter):
        self._llm = llm

    async def plan(
        self,
        scope: AnalysisScope,
        schemas: dict[str, TableSchema],
        samples: dict[str, list[dict[str, object]]],
    ) -> list[RelationshipPlan]:
        allowed_dimensions = _allowed_dimensions(scope, schemas)
        messages = _build_messages(
            scope,
            schemas,
            samples,
            allowed_dimensions,
        )
        import sys
        print(f'[Planner] generating plans for {len(scope.tables)} tables...', file=sys.stderr, flush=True)
        envelope = await self._complete_plan(messages)
        print(f'[Planner] received {len(envelope.plans)} plans', file=sys.stderr, flush=True)

        plans = _validate_and_cap_plans(
            envelope.plans,
            allowed_dimensions,
            settings.RELATIONSHIP_PLAN_LIMIT,
        )
        return plans

    async def _complete_plan(
        self,
        messages: list[dict[str, object]],
    ) -> _PlanEnvelope:
        payload = await self._llm.complete_json(
            messages,
            max_tokens=8192,
            response_model=_PlanEnvelope,
        )
        return _PlanEnvelope.model_validate(payload)


def _allowed_dimensions(
    scope: AnalysisScope,
    schemas: dict[str, TableSchema],
) -> dict[str, set[str]]:
    allowed: dict[str, set[str]] = {}
    for table_scope in scope.tables:
        schema = schemas.get(table_scope.name)
        if schema is None:
            allowed[table_scope.name] = set()
            continue
        primary_keys = set(schema.primary_keys)
        selected = set(table_scope.dimensions)
        allowed[table_scope.name] = {
            column.name
            for column in schema.columns
            if (
                column.name in selected
                and not column.is_primary_key
                and column.name not in primary_keys
            )
        }
    return allowed


def _build_messages(
    scope: AnalysisScope,
    schemas: dict[str, TableSchema],
    samples: dict[str, list[dict[str, object]]],
    allowed_dimensions: dict[str, set[str]],
) -> list[dict[str, object]]:
    context: list[dict[str, object]] = []
    for table_scope in scope.tables:
        schema = schemas.get(table_scope.name)
        columns_by_name = (
            {column.name: column for column in schema.columns}
            if schema is not None
            else {}
        )
        sample = samples.get(table_scope.name, [])
        sample_row = sample[0] if sample else {}
        dimensions = []
        for name in table_scope.dimensions:
            if name not in allowed_dimensions[table_scope.name]:
                continue
            column = columns_by_name[name]
            dimensions.append(
                {
                    "name": name,
                    "type": column.type,
                    "sample_value": sample_row.get(name),
                }
            )
        context.append(
            {
                "table": table_scope.name,
                "dimensions": dimensions,
            }
        )

    example = {
        "plans": [
            {
                "source_table": "source_table_name",
                "target_table": "target_table_name",
                "relation_type": "business_relationship",
                "direction": "source_to_target",
                "source_dimensions": ["selected_source_dimension"],
                "target_dimensions": ["selected_target_dimension"],
                "retrieval_modes": ["keyword", "semantic"],
                "candidate_limit_per_source": 10,
                "reason": "Why these selected values can reveal a link.",
            }
        ]
    }
    return [
        {
            "role": "system",
            "content": (
                "Plan plausible cross-table semantic relationships. "
                "Use only the provided tables and dimensions. Return "
                "one JSON object and no prose."
            ),
        },
        {
            "role": "user",
            "content": (
                "Selected analysis context:\n"
                f"{json.dumps(context, ensure_ascii=False, default=str)}"
                "\nReturn JSON matching this example:\n"
                f"{json.dumps(example, ensure_ascii=False)}"
            ),
        },
    ]


def _is_scoped_plan(
    plan: RelationshipPlan,
    allowed_dimensions: dict[str, set[str]],
) -> bool:
    if (
        plan.source_table == plan.target_table
        or plan.source_table not in allowed_dimensions
        or plan.target_table not in allowed_dimensions
        or not plan.source_dimensions
        or not plan.target_dimensions
    ):
        return False
    return (
        set(plan.source_dimensions)
        <= allowed_dimensions[plan.source_table]
        and set(plan.target_dimensions)
        <= allowed_dimensions[plan.target_table]
    )


def _validate_and_cap_plans(
    plans: list[RelationshipPlan],
    allowed_dimensions: dict[str, set[str]],
    limit: int,
) -> list[RelationshipPlan]:
    if limit < 1:
        raise PlanValidationError("relationship plan limit must be positive")

    unique: list[RelationshipPlan] = []
    seen: set[str] = set()
    for plan in plans:
        if not _is_scoped_plan(plan, allowed_dimensions):
            raise PlanValidationError("planner returned a plan outside scope")
        key = json.dumps(plan.model_dump(), sort_keys=True, separators=(",", ":"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(plan)

    if len(unique) > limit:
        raise PlanValidationError("planner returned more plans than allowed")
    return unique
