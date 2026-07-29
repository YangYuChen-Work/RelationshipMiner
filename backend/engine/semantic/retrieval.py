from __future__ import annotations

import re
from dataclasses import dataclass

import numpy as np
from usearch.index import Index

from .interfaces import EmbeddingAdapter
from .models import CandidateGroup, EntityDocument, RelationshipPlan


_ALPHANUMERIC_OR_CJK = re.compile(r"[a-z0-9]+|[\u3400-\u9fff]+")
_CorpusKey = tuple[str, tuple[str, ...]]


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

    def search(self, query: list[float], count: int) -> list[str]:
        matches = self.index.search(
            np.asarray(query, dtype=np.float32),
            count=count,
        )
        return [
            self.entity_ids_by_key[int(key)]
            for key in matches.keys
        ]


def retrieve_candidate_groups(
    documents: list[EntityDocument],
    plans: list[RelationshipPlan],
    embedding_adapter: EmbeddingAdapter,
) -> list[CandidateGroup]:
    documents_by_table = _documents_by_table(documents)
    documents_by_id = {
        document.entity_id: document for document in documents
    }
    keyword_indexes = _build_keyword_indexes(
        documents_by_table,
        plans,
    )
    vector_indexes = _build_vector_indexes(
        documents_by_table,
        plans,
        embedding_adapter,
    )
    groups: list[CandidateGroup] = []

    for plan in plans:
        corpus_key = _corpus_key(plan)
        for source in documents_by_table.get(plan.source_table, []):
            candidate_ids: list[str] = []
            seen: set[str] = set()
            source_text = _dimension_text(
                source,
                plan.source_dimensions,
            )

            if "keyword" in plan.retrieval_modes:
                _extend_unique(
                    candidate_ids,
                    seen,
                    keyword_indexes[corpus_key].search(
                        source_text,
                        plan.candidate_limit_per_source,
                    ),
                    plan.candidate_limit_per_source,
                )

            vector_index = vector_indexes.get(corpus_key)
            if (
                "semantic" in plan.retrieval_modes
                and vector_index is not None
            ):
                query_vector = embedding_adapter.encode_queries(
                    [source_text]
                )[0]
                _extend_unique(
                    candidate_ids,
                    seen,
                    vector_index.search(
                        query_vector,
                        plan.candidate_limit_per_source,
                    ),
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
) -> dict[_CorpusKey, _KeywordIndex]:
    indexes: dict[_CorpusKey, _KeywordIndex] = {}
    for plan in plans:
        key = _corpus_key(plan)
        if key in indexes:
            continue

        postings: dict[str, list[str]] = {}
        targets = documents_by_table.get(plan.target_table, [])
        for target in targets:
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
) -> dict[_CorpusKey, _VectorIndex]:
    indexes: dict[_CorpusKey, _VectorIndex] = {}
    for plan in plans:
        key = _corpus_key(plan)
        if (
            key in indexes
            or "semantic" not in plan.retrieval_modes
        ):
            continue

        targets = documents_by_table.get(plan.target_table, [])
        if not targets:
            continue
        target_vectors = np.asarray(
            embedding_adapter.encode_documents(
                [
                    _dimension_text(target, plan.target_dimensions)
                    for target in targets
                ]
            ),
            dtype=np.float32,
        )
        if target_vectors.ndim != 2 or target_vectors.shape[1] == 0:
            continue

        index = Index(
            ndim=target_vectors.shape[1],
            metric="cos",
            dtype="f32",
        )
        keys = np.arange(len(targets), dtype=np.uint64)
        index.add(keys, target_vectors)
        indexes[key] = _VectorIndex(
            index=index,
            entity_ids_by_key={
                int(key): target.entity_id
                for key, target in zip(keys, targets, strict=True)
            },
        )
    return indexes


def _corpus_key(plan: RelationshipPlan) -> _CorpusKey:
    return plan.target_table, tuple(plan.target_dimensions)


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
