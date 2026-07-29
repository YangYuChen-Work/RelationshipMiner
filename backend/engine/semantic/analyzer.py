"""Deadline-bounded orchestration for semantic relationship analysis."""

from __future__ import annotations

import inspect
import asyncio
import time
from collections.abc import Callable
from typing import Any

from sqlalchemy.engine import Engine

from engine.schema_analyzer import analyze_schema

from .corpus import (
    build_entity_documents,
    group_documents_by_signature,
    load_scoped_records,
)
from .deadline import DeadlineExceeded
from .deterministic import build_fk_edges, build_unique_identifier_edges
from .graph_builder import build_graph
from .models import (
    AnalysisDiagnostics,
    AnalysisResult,
    AnalysisScope,
    AnalysisStatus,
    EntityDocument,
    EntitySignatureGroup,
    JudgementBatchResult,
    RelationDecision,
    RelationEvidence,
)
from .planner import RelationshipPlanner
from .retrieval import iter_candidate_groups

ProgressCallback = Callable[[dict[str, object]], object]

_END = object()
_SAFE_TIMEOUT_WARNING = "Analysis timed out."
_SAFE_RETRIEVAL_WARNING = "Candidate retrieval failed (internal_error)."
_SAFE_INCOMPLETE_JUDGEMENT_WARNING = (
    "Candidate judgement did not complete for all groups."
)


class _ThreadedCandidateGroups:
    """Advance a blocking retrieval iterator without blocking the event loop."""

    def __init__(self, groups: object, deadline: float) -> None:
        self._iterator = iter(groups)
        self._deadline = deadline

    def __aiter__(self) -> "_ThreadedCandidateGroups":
        return self

    async def __anext__(self) -> object:
        try:
            async with asyncio.timeout_at(self._deadline):
                group = await asyncio.to_thread(
                    _next_or_end,
                    self._iterator,
                )
        except TimeoutError as error:
            raise StopAsyncIteration from error
        if group is _END:
            raise StopAsyncIteration
        return group


def _next_or_end(iterator: object) -> object:
    return next(iterator, _END)


class RelationshipAnalyzer:
    """Coordinate one bounded, explainable relationship-analysis task.

    The constructor accepts collaborators so callers can use deterministic
    test adapters without loading an embedding model or contacting an LLM.
    """

    def __init__(
        self,
        *,
        planner: Any | None = None,
        embedding_adapter: Any | None = None,
        judge: Any | None = None,
    ) -> None:
        if planner is None or judge is None:
            from engine.deepseek_client import DeepSeekJsonAdapter

            llm = DeepSeekJsonAdapter()
            if planner is None:
                planner = RelationshipPlanner(llm)
            if judge is None:
                from .judge import SemanticJudge

                judge = SemanticJudge(llm)
        if embedding_adapter is None:
            from .embeddings import SentenceTransformerEmbeddingAdapter

            embedding_adapter = SentenceTransformerEmbeddingAdapter()

        self._planner = planner
        self._embedding_adapter = embedding_adapter
        self._judge = judge

    async def analyze(
        self,
        engine: Engine,
        scope: AnalysisScope,
        on_progress: ProgressCallback | None = None,
    ) -> AnalysisResult:
        """Analyze ``scope`` within its one absolute monotonic deadline."""
        deadline = time.monotonic() + scope.time_budget_seconds
        diagnostics = AnalysisDiagnostics()
        warnings: list[str] = []
        timed_out = False
        planner_failed = False
        planner_timed_out = False
        failed_groups = 0
        pending_groups = 0
        completed_groups = 0

        async def emit(phase: str, message: str, progress: float) -> None:
            if on_progress is None:
                return
            event = {
                "phase": phase,
                "message": message,
                "progress": progress,
                "entities_read": diagnostics.entities_read,
                "plans_created": diagnostics.plans_created,
                "candidates_retrieved": diagnostics.candidates_retrieved,
                "candidates_completed": diagnostics.candidates_completed,
                "candidates_pending": diagnostics.candidates_pending,
                "entity_edges_created": (
                    diagnostics.strong_edges_created
                    + diagnostics.weak_edges_created
                ),
            }
            response = on_progress(event)
            if inspect.isawaitable(response):
                await response

        def before(stage: str) -> bool:
            nonlocal timed_out
            if time.monotonic() < deadline:
                return True
            timed_out = True
            warning = str(DeadlineExceeded(f"{stage}已达到时间预算"))
            if warning not in warnings:
                warnings.append(warning)
            return False

        def require_deadline(stage: str) -> None:
            if not before(stage):
                raise DeadlineExceeded(f"{stage}已达到时间预算")

        def remaining_seconds(stage: str) -> float:
            require_deadline(stage)
            return max(0.0, deadline - time.monotonic())

        async def await_blocking(
            operation: Callable[..., Any],
            *args: object,
            stage: str,
            **kwargs: object,
        ) -> Any:
            """Keep blocking DB/schema work off the FastAPI event loop.

            Timing out this wait does not physically interrupt a driver call;
            deployments must configure a database-driver statement timeout as
            well for physical query cancellation.
            """
            try:
                async with asyncio.timeout(
                    max(0.0, deadline - time.monotonic())
                ):
                    value = await asyncio.to_thread(
                        operation,
                        *args,
                        **kwargs,
                    )
            except TimeoutError as error:
                raise DeadlineExceeded(stage) from error
            require_deadline(stage)
            return value

        await emit("schema", "Reading selected table schemas.", 0.02)
        if not before("读取 Schema 前"):
            return self._empty_partial(diagnostics, warnings)
        try:
            schema_result = await await_blocking(
                analyze_schema,
                engine,
                [table.name for table in scope.tables],
                stage="schema",
            )
            require_deadline("读取 Schema 后")
        except DeadlineExceeded as error:
            if str(error) not in warnings:
                warnings.append(str(error))
            return self._empty_partial(diagnostics, warnings)
        except Exception:
            warnings.append("Schema analysis failed (internal_error).")
            return self._empty_failed(diagnostics, warnings)

        class_name_fields = {
            name: next(
                (
                    column.name
                    for column in schema.columns
                    if column.is_class_name
                ),
                None,
            )
            for name, schema in schema_result.tables.items()
        }
        effective_scope = AnalysisScope(
            tables=[
                table_scope.model_copy(
                    update={
                        "dimensions": [
                            name
                            for name in table_scope.dimensions
                            if name not in schema_result.tables[table_scope.name].primary_keys
                            and not any(
                                name in foreign_key.source_columns
                                for foreign_key in schema_result.tables[
                                    table_scope.name
                                ].foreign_keys
                            )
                            and name != class_name_fields[table_scope.name]
                        ]
                    }
                )
                for table_scope in scope.tables
            ],
            time_budget_seconds=scope.time_budget_seconds,
        )
        records: dict[str, list[dict[str, object]]] = {}
        for table_scope in effective_scope.tables:
            if not before(f"读取表 {table_scope.name} 前"):
                break
            table_scope_only = AnalysisScope(
                tables=[table_scope],
                time_budget_seconds=scope.time_budget_seconds,
            )
            try:
                loaded = await await_blocking(
                    load_scoped_records,
                    engine,
                    table_scope_only,
                    schema_result,
                    stage="records",
                )
            except DeadlineExceeded as error:
                timed_out = True
                if str(error) not in warnings:
                    warnings.append(str(error))
                break
            records.update(loaded)
            diagnostics.entities_read += len(records.get(table_scope.name, []))
            await emit("entities", f"Read {table_scope.name} entities.", 0.18)

        if timed_out:
            return self._empty_partial(diagnostics, warnings)

        documents = build_entity_documents(
            records,
            effective_scope,
            schema_result.pk_metadata,
            class_name_fields,
        )
        signature_groups = group_documents_by_signature(documents)
        groups_by_representative = {
            group.representative.entity_id: group for group in signature_groups
        }

        plans = []
        if len(effective_scope.tables) > 1:
            if before("关系规划前"):
                try:
                    async with asyncio.timeout(
                        remaining_seconds("关系规划前")
                    ):
                        plans = await self._planner.plan(
                            effective_scope,
                            schema_result.tables,
                            {
                                name: rows[:1]
                                for name, rows in records.items()
                            },
                        )
                    require_deadline("关系规划后")
                except TimeoutError:
                    planner_failed = True
                    planner_timed_out = True
                    warnings.append(
                        "分析超时：关系规划阶段未在剩余时间内完成。"
                    )
                except DeadlineExceeded as error:
                    planner_failed = True
                    planner_timed_out = True
                    if str(error) not in warnings:
                        warnings.append(str(error))
                except Exception:
                    planner_failed = True
                    warnings.append("Relationship planning failed (internal_error).")
            else:
                planner_failed = True
                planner_timed_out = True
        diagnostics.plans_created = len(plans)
        await emit("planning", "Relationship planning finished.", 0.35)
        if planner_timed_out:
            return self._empty_failed(diagnostics, warnings)

        # Strong links do not depend on an LLM and survive a planner failure.
        deterministic_edges = build_fk_edges(
            records,
            schema_result.pk_metadata,
            schema_result.all_foreign_keys,
        )
        deterministic_edges.extend(
            build_unique_identifier_edges(records, schema_result, plans)
        )

        representative_documents = [
            group.representative for group in signature_groups
        ]
        relation_decisions: list[RelationDecision] = []
        for plan in plans:
            if not before("构建候选索引前"):
                pending_groups += 1
                continue
            try:
                retrieved_groups = iter_candidate_groups(
                    representative_documents,
                    [plan],
                    self._embedding_adapter,
                    check_deadline=require_deadline,
                )
            except DeadlineExceeded as error:
                pending_groups += 1
                if str(error) not in warnings:
                    warnings.append(str(error))
                break
            except Exception as error:
                warnings.append(f"Candidate retrieval failed: {error}")
                failed_groups += 1
                continue
            candidate_count = 0
            async def non_empty_groups():
                nonlocal candidate_count
                async for group in _ThreadedCandidateGroups(
                    retrieved_groups,
                    deadline,
                ):
                    if group.candidates:
                        candidate_count += len(group.candidates)
                        yield group
            candidate_groups = non_empty_groups()
            if not before("启动候选判断前"):
                # The stream has not been consumed, so there is no bounded
                # candidate total to claim.  Preserve partial status without
                # materializing every remaining group merely for diagnostics.
                pending_groups += 1
                continue
            try:
                judgement = await self._judge.judge_groups(
                    candidate_groups, deadline
                )
            except Exception:
                failed_groups += 1
                warnings.append("Semantic judgement failed (internal_error).")
                continue
            diagnostics.candidates_retrieved += candidate_count
            await emit("candidates", "Candidate retrieval finished.", 0.55)
            completed_groups += judgement.completed_groups
            failed_groups += judgement.failed_groups
            pending_groups += judgement.pending_groups
            completed_candidate_count = sum(
                outcome.candidate_count for outcome in judgement.outcomes
                if outcome.status == "completed"
            )
            diagnostics.candidates_completed += completed_candidate_count
            unfinished = [
                outcome for outcome in judgement.outcomes
                if outcome.status != "completed"
            ]
            unfinished_group_count = len(unfinished)
            if unfinished_group_count:
                warnings.append(
                    f"{unfinished_group_count} candidate groups did not complete judgement."
                )
                diagnostics.candidates_pending += sum(
                    outcome.candidate_count for outcome in unfinished
                )
            relation_decisions.extend(
                _expand_signature_decisions(
                    judgement.decisions,
                    groups_by_representative,
                    {document.entity_id: document for document in documents},
                )
            )
            await emit("semantic_judging", "Semantic judgement finished.", 0.76)

        if not before("组装图谱前"):
            if planner_failed and not deterministic_edges:
                return self._empty_failed(diagnostics, warnings)
            return self._empty_partial(diagnostics, warnings)
        try:
            table_nodes, entity_nodes, table_edges, entity_edges = build_graph(
                documents,
                deterministic_edges,
                relation_decisions,
                check_deadline=require_deadline,
            )
        except DeadlineExceeded as error:
            if str(error) not in warnings:
                warnings.append(str(error))
            return self._empty_partial(diagnostics, warnings)

        diagnostics.strong_edges_created = sum(
            relation.strength == "strong"
            for edge in entity_edges
            for relation in edge.relations
        )
        diagnostics.weak_edges_created = sum(
            relation.strength == "weak"
            for edge in entity_edges
            for relation in edge.relations
        )
        await emit("graph", "图谱组装完成。", 0.95)
        no_trustworthy_output = not entity_edges
        all_judgement_groups_failed = (
            completed_groups == 0
            and failed_groups > 0
            and pending_groups == 0
        )
        incomplete = (
            timed_out
            or planner_failed
            or failed_groups > 0
            or pending_groups > 0
        )
        if no_trustworthy_output and (
            planner_failed or all_judgement_groups_failed
        ):
            status = AnalysisStatus.FAILED
        elif incomplete:
            status = AnalysisStatus.PARTIAL
        else:
            status = AnalysisStatus.COMPLETE
            if not entity_edges:
                warnings.append(
                    "No relationships were found after all planned candidates completed."
                )

        result = AnalysisResult(
            status=status,
            table_nodes=table_nodes,
            entity_nodes=entity_nodes,
            table_edges=table_edges,
            entity_edges=entity_edges,
            diagnostics=diagnostics,
            warnings=_safe_warnings(warnings),
        )
        return result

    @staticmethod
    def _empty_partial(
        diagnostics: AnalysisDiagnostics,
        warnings: list[str],
    ) -> AnalysisResult:
        return AnalysisResult(
            status=AnalysisStatus.PARTIAL,
            table_nodes=[],
            entity_nodes=[],
            table_edges=[],
            entity_edges=[],
            diagnostics=diagnostics,
            warnings=_safe_warnings(warnings),
        )

    @staticmethod
    def _empty_failed(
        diagnostics: AnalysisDiagnostics,
        warnings: list[str],
    ) -> AnalysisResult:
        return AnalysisResult(
            status=AnalysisStatus.FAILED,
            table_nodes=[],
            entity_nodes=[],
            table_edges=[],
            entity_edges=[],
            diagnostics=diagnostics,
            warnings=_safe_warnings(warnings),
        )


def _safe_warnings(warnings: list[str]) -> list[str]:
    """Keep exception details and dynamic counters out of public payloads."""
    safe: list[str] = []
    for warning in warnings:
        if warning.startswith("Candidate retrieval failed"):
            normalized = _SAFE_RETRIEVAL_WARNING
        elif warning.endswith("candidate groups did not complete judgement."):
            normalized = _SAFE_INCOMPLETE_JUDGEMENT_WARNING
        elif warning in {
            "Schema analysis failed (internal_error).",
            "Relationship planning failed (internal_error).",
            "Semantic judgement failed (internal_error).",
            "No relationships were found after all planned candidates completed.",
        }:
            normalized = warning
        else:
            normalized = _SAFE_TIMEOUT_WARNING
        if normalized not in safe:
            safe.append(normalized)
    return safe


def _expand_signature_decisions(
    decisions: list[RelationDecision],
    groups_by_representative: dict[str, EntitySignatureGroup],
    documents_by_id: dict[str, EntityDocument],
) -> list[RelationDecision]:
    """Apply one representative verdict to every concrete signature pair."""
    expanded: list[RelationDecision] = []
    for decision in decisions:
        source_group = groups_by_representative.get(decision.source)
        target_group = groups_by_representative.get(decision.target)
        if source_group is None or target_group is None:
            # A judge must only return representatives. Treat any mismatch as
            # untrusted rather than permitting an edge outside the corpus.
            continue
        for source_id in source_group.entity_ids:
            source_document = documents_by_id[source_id]
            for target_id in target_group.entity_ids:
                target_document = documents_by_id[target_id]
                expanded.append(
                    decision.model_copy(
                        update={
                            "source": source_id,
                            "target": target_id,
                            "evidence": [
                                RelationEvidence(
                                    source_field=evidence.source_field,
                                    source_value=source_document.dimensions[
                                        evidence.source_field
                                    ],
                                    target_field=evidence.target_field,
                                    target_value=target_document.dimensions[
                                        evidence.target_field
                                    ],
                                    method=evidence.method,
                                    reason=evidence.reason,
                                )
                                for evidence in decision.evidence
                            ],
                        }
                    )
                )
    return expanded
