from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np
from usearch.index import Index

from config import settings

from .interfaces import EmbeddingAdapter
from .models import CandidateGroup, EntityDocument, RelationshipPlan


_ALPHANUMERIC_OR_CJK = re.compile(r"[a-z0-9]+|[\u3400-\u9fff]+")
_CorpusKey = tuple[str, tuple[str, ...]]
_SourceKey = tuple[str, tuple[str, ...]]


@dataclass
class _KeywordIndex:
    postings: dict[str, list[str]]
    order: dict[str, int]

    def search(self, query: str, count: int) -> list[str]:
        matches: set[str] = set()
        for token in _keyword_tokens(query):
            matches.update(self.postings.get(token, ()))
        return sorted(matches, key=self.order.__getitem__)[:count]


@dataclass
class _VectorIndex:
    index: Index
    entity_ids_by_key: dict[int, str]
    ndim: int

    def search(self, query: np.ndarray, count: int) -> list[str]:
        vector = _usable_vector(query, expected_ndim=self.ndim)
        if vector is None:
            return []
        matches = self.index.search(
            vector,
            count=count,
        )
        return [
            self.entity_ids_by_key[int(key)]
            for key in matches.keys
        ]


@dataclass
class _SourceVectorCache:
    vectors_by_entity_id: dict[str, np.ndarray]


@dataclass
class RetrievalDiagnostics:
    """Observed candidate batches before the final per-source Top-K cap."""

    explicit_pair_count: int = 0


def retrieve_candidate_groups(
    documents: list[EntityDocument],
    plans: list[RelationshipPlan],
    embedding_adapter: EmbeddingAdapter,
    *,
    check_deadline: Callable[[str], None] | None = None,
    diagnostics: RetrievalDiagnostics | None = None,
) -> list[CandidateGroup]:
    _check_deadline(check_deadline, "构建候选索引前")
    documents_by_table = _documents_by_table(documents)
    documents_by_id = {
        document.entity_id: document for document in documents
    }
    keyword_indexes = _build_keyword_indexes(
        documents_by_table,
        plans,
        check_deadline,
    )
    vector_indexes = _build_vector_indexes(
        documents_by_table,
        plans,
        embedding_adapter,
        check_deadline,
    )
    source_vector_caches = _build_source_vector_caches(
        documents_by_table,
        plans,
        vector_indexes,
        embedding_adapter,
        check_deadline,
    )
    groups: list[CandidateGroup] = []

    for plan in plans:
        _check_deadline(check_deadline, "检索候选计划前")
        corpus_key = _corpus_key(plan)
        for source in documents_by_table.get(plan.source_table, []):
            _check_deadline(check_deadline, "检索候选源实体前")
            candidate_ids: list[str] = []
            seen: set[str] = set()
            source_text = _dimension_text(
                source,
                plan.source_dimensions,
            )

            if "keyword" in plan.retrieval_modes:
                keyword_candidates = keyword_indexes[corpus_key].search(
                    source_text,
                    plan.candidate_limit_per_source,
                )
                _record_candidate_batch(
                    diagnostics,
                    keyword_candidates,
                    plan.candidate_limit_per_source,
                )
                _extend_unique(
                    candidate_ids,
                    seen,
                    keyword_candidates,
                    plan.candidate_limit_per_source,
                )

            vector_index = vector_indexes.get(corpus_key)
            if (
                "semantic" in plan.retrieval_modes
                and vector_index is not None
            ):
                source_cache = source_vector_caches[
                    _source_key(plan)
                ]
                query_vector = source_cache.vectors_by_entity_id.get(
                    source.entity_id
                )
                if query_vector is not None:
                    semantic_candidates = vector_index.search(
                        query_vector,
                        plan.candidate_limit_per_source,
                    )
                    _record_candidate_batch(
                        diagnostics,
                        semantic_candidates,
                        plan.candidate_limit_per_source,
                    )
                    _extend_unique(
                        candidate_ids,
                        seen,
                        semantic_candidates,
                        plan.candidate_limit_per_source,
                    )

            groups.append(
                CandidateGroup(
                    plan=plan,
                    source=source,
                    candidates=[
                        documents_by_id[entity_id]
                        for entity_id in candidate_ids
                    ],
                )
            )

    return groups


def _documents_by_table(
    documents: list[EntityDocument],
) -> dict[str, list[EntityDocument]]:
    by_table: dict[str, list[EntityDocument]] = {}
    for document in documents:
        by_table.setdefault(document.table_name, []).append(document)
    return by_table


def _build_keyword_indexes(
    documents_by_table: dict[str, list[EntityDocument]],
    plans: list[RelationshipPlan],
    check_deadline: Callable[[str], None] | None,
) -> dict[_CorpusKey, _KeywordIndex]:
    indexes: dict[_CorpusKey, _KeywordIndex] = {}
    for plan in plans:
        _check_deadline(check_deadline, "构建关键词索引前")
        key = _corpus_key(plan)
        if key in indexes:
            continue

        postings: dict[str, list[str]] = {}
        targets = documents_by_table.get(plan.target_table, [])
        for target in targets:
            _check_deadline(check_deadline, "构建关键词目标索引时")
            text = _dimension_text(target, plan.target_dimensions)
            for token in _keyword_tokens(text):
                postings.setdefault(token, []).append(target.entity_id)
        indexes[key] = _KeywordIndex(
            postings=postings,
            order={
                target.entity_id: index
                for index, target in enumerate(targets)
            },
        )
    return indexes


def _build_vector_indexes(
    documents_by_table: dict[str, list[EntityDocument]],
    plans: list[RelationshipPlan],
    embedding_adapter: EmbeddingAdapter,
    check_deadline: Callable[[str], None] | None,
) -> dict[_CorpusKey, _VectorIndex]:
    indexes: dict[_CorpusKey, _VectorIndex] = {}
    for plan in plans:
        _check_deadline(check_deadline, "构建向量目标索引前")
        key = _corpus_key(plan)
        if (
            key in indexes
            or "semantic" not in plan.retrieval_modes
        ):
            continue

        targets = documents_by_table.get(plan.target_table, [])
        if not targets:
            continue

        eligible_targets = [
            (
                target_index,
                target,
                text,
            )
            for target_index, target in enumerate(targets)
            if (text := _dimension_text(
                target,
                plan.target_dimensions,
            ))
        ]
        index: Index | None = None
        ndim: int | None = None
        entity_ids_by_key: dict[int, str] = {}
        batch_size = max(1, settings.EMBEDDING_BATCH_SIZE)

        for batch_start in range(
            0,
            len(eligible_targets),
            batch_size,
        ):
            _check_deadline(check_deadline, "编码目标向量批次前")
            batch = eligible_targets[
                batch_start : batch_start + batch_size
            ]
            encoded = embedding_adapter.encode_documents(
                [text for _, _, text in batch]
            )
            _check_deadline(check_deadline, "编码目标向量批次后")
            valid_keys: list[int] = []
            valid_vectors: list[np.ndarray] = []

            for (
                target_index,
                target,
                _,
            ), raw_vector in zip(batch, encoded, strict=True):
                vector = _usable_vector(
                    raw_vector,
                    expected_ndim=ndim,
                )
                if vector is None:
                    continue
                if ndim is None:
                    ndim = vector.shape[0]
                    index = Index(
                        ndim=ndim,
                        metric="cos",
                        dtype="f32",
                    )
                valid_keys.append(target_index)
                valid_vectors.append(vector)
                entity_ids_by_key[target_index] = target.entity_id

            if index is not None and valid_vectors:
                index.add(
                    np.asarray(valid_keys, dtype=np.uint64),
                    np.stack(valid_vectors).astype(
                        np.float32,
                        copy=False,
                    ),
                )

        if index is not None and ndim is not None:
            indexes[key] = _VectorIndex(
                index=index,
                entity_ids_by_key=entity_ids_by_key,
                ndim=ndim,
            )
    return indexes


def _build_source_vector_caches(
    documents_by_table: dict[str, list[EntityDocument]],
    plans: list[RelationshipPlan],
    vector_indexes: dict[_CorpusKey, _VectorIndex],
    embedding_adapter: EmbeddingAdapter,
    check_deadline: Callable[[str], None] | None,
) -> dict[_SourceKey, _SourceVectorCache]:
    caches: dict[_SourceKey, _SourceVectorCache] = {}
    for plan in plans:
        _check_deadline(check_deadline, "构建查询向量缓存前")
        key = _source_key(plan)
        if (
            key in caches
            or "semantic" not in plan.retrieval_modes
            or _corpus_key(plan) not in vector_indexes
        ):
            continue

        sources = documents_by_table.get(plan.source_table, [])
        eligible_sources = [
            (
                source,
                text,
            )
            for source in sources
            if (text := _dimension_text(
                source,
                plan.source_dimensions,
            ))
        ]
        vectors_by_entity_id: dict[str, np.ndarray] = {}
        batch_size = max(1, settings.EMBEDDING_BATCH_SIZE)
        for batch_start in range(
            0,
            len(eligible_sources),
            batch_size,
        ):
            _check_deadline(check_deadline, "编码查询向量批次前")
            batch = eligible_sources[
                batch_start : batch_start + batch_size
            ]
            vectors = embedding_adapter.encode_queries(
                [text for _, text in batch]
            )
            _check_deadline(check_deadline, "编码查询向量批次后")
            for (source, _), raw_vector in zip(
                batch,
                vectors,
                strict=True,
            ):
                vector = _usable_vector(raw_vector)
                if vector is None:
                    continue
                vectors_by_entity_id[source.entity_id] = vector

        caches[key] = _SourceVectorCache(
            vectors_by_entity_id=vectors_by_entity_id,
        )
    return caches


def _corpus_key(plan: RelationshipPlan) -> _CorpusKey:
    return plan.target_table, tuple(plan.target_dimensions)


def _source_key(plan: RelationshipPlan) -> _SourceKey:
    return plan.source_table, tuple(plan.source_dimensions)


def _usable_vector(
    raw_vector: object,
    expected_ndim: int | None = None,
) -> np.ndarray | None:
    try:
        vector = np.asarray(raw_vector, dtype=np.float32)
    except (TypeError, ValueError):
        return None
    if (
        vector.ndim != 1
        or vector.size == 0
        or (
            expected_ndim is not None
            and vector.shape[0] != expected_ndim
        )
        or not np.all(np.isfinite(vector))
    ):
        return None
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm == 0:
        return None
    return vector


def _dimension_text(
    document: EntityDocument,
    dimensions: list[str],
) -> str:
    return "；".join(
        document.normalized_dimensions.get(dimension, "")
        for dimension in dimensions
        if document.normalized_dimensions.get(dimension, "")
    )


def _keyword_tokens(text: str) -> set[str]:
    tokens: set[str] = set()
    for segment in _ALPHANUMERIC_OR_CJK.findall(text.lower()):
        tokens.add(segment)
        if all("\u3400" <= character <= "\u9fff" for character in segment):
            tokens.update(
                segment[index : index + 2]
                for index in range(len(segment) - 1)
            )
    return tokens


def _extend_unique(
    destination: list[str],
    seen: set[str],
    entity_ids: list[str],
    limit: int,
) -> None:
    if len(destination) >= limit:
        return
    for entity_id in entity_ids:
        if entity_id in seen:
            continue
        seen.add(entity_id)
        destination.append(entity_id)
        if len(destination) >= limit:
            return


def _record_candidate_batch(
    diagnostics: RetrievalDiagnostics | None,
    entity_ids: list[str],
    limit: int,
) -> None:
    if diagnostics is not None and len(entity_ids) > limit:
        diagnostics.explicit_pair_count += len(entity_ids)


def _check_deadline(
    check_deadline: Callable[[str], None] | None,
    stage: str,
) -> None:
    if check_deadline is not None:
        check_deadline(stage)
