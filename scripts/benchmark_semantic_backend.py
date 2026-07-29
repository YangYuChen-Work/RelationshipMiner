from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path
from time import perf_counter


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from engine.semantic.corpus import build_entity_documents  # noqa: E402
from engine.semantic.models import (  # noqa: E402
    AnalysisScope,
    RelationshipPlan,
    TableScope,
)
from engine.semantic import retrieval  # noqa: E402


ENTITY_COUNT = 7_000
TABLE_COUNT = 7
PLANS_COUNT = 10
TOP_K = 8
EMBEDDING_DIMENSIONS = 16


class DeterministicFakeEmbeddings:
    @staticmethod
    def _vector(text: str) -> list[float]:
        digest = hashlib.blake2b(
            text.encode("utf-8"),
            digest_size=EMBEDDING_DIMENSIONS,
        ).digest()
        return [
            (component - 127.5) / 127.5
            for component in digest
        ]

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        return [self._vector(text) for text in texts]


def _synthetic_input() -> tuple[
    dict[str, list[dict[str, object]]],
    AnalysisScope,
    dict[str, list[str]],
    dict[str, str | None],
]:
    entities_per_table = ENTITY_COUNT // TABLE_COUNT
    table_names = [f"table_{index}" for index in range(TABLE_COUNT)]
    records = {
        table_name: [
            {
                "id": entity_index,
                "name": f"{table_name}-entity-{entity_index}",
                "category": f"category-{entity_index % 25}",
            }
            for entity_index in range(entities_per_table)
        ]
        for table_name in table_names
    }
    scope = AnalysisScope(
        tables=[
            TableScope(
                name=table_name,
                dimensions=["name", "category"],
            )
            for table_name in table_names
        ],
    )
    return (
        records,
        scope,
        {table_name: ["id"] for table_name in table_names},
        {table_name: None for table_name in table_names},
    )


def _relationship_plans() -> list[RelationshipPlan]:
    table_pairs = [
        (0, 1),
        (0, 2),
        (1, 2),
        (1, 3),
        (2, 3),
        (2, 4),
        (3, 4),
        (4, 5),
        (5, 6),
        (6, 0),
    ]
    return [
        RelationshipPlan(
            source_table=f"table_{source}",
            target_table=f"table_{target}",
            relation_type=f"relation_{index}",
            direction="source_to_target",
            source_dimensions=["name", "category"],
            target_dimensions=["name", "category"],
            retrieval_modes=["keyword", "semantic"],
            candidate_limit_per_source=TOP_K,
            reason="synthetic semantic benchmark",
        )
        for index, (source, target) in enumerate(table_pairs)
    ]


def main() -> None:
    records, scope, primary_keys, class_name_fields = _synthetic_input()

    started = perf_counter()
    documents = build_entity_documents(
        records,
        scope,
        primary_keys,
        class_name_fields,
    )
    corpus_build_seconds = perf_counter() - started

    plans = _relationship_plans()
    embeddings = DeterministicFakeEmbeddings()
    documents_by_table = retrieval._documents_by_table(documents)

    started = perf_counter()
    keyword_indexes = retrieval._build_keyword_indexes(
        documents_by_table,
        plans,
        None,
    )
    vector_indexes = retrieval._build_vector_indexes(
        documents_by_table,
        plans,
        embeddings,
        None,
    )
    index_build_seconds = perf_counter() - started

    started = perf_counter()
    diagnostics = retrieval.RetrievalDiagnostics()
    groups = retrieval.retrieve_candidate_groups(
        documents,
        plans,
        embeddings,
        diagnostics=diagnostics,
    )
    end_to_end_retrieval_seconds = perf_counter() - started

    candidates = sum(len(group.candidates) for group in groups)
    plans_per_source = Counter(plan.source_table for plan in plans)
    max_plans_per_source = max(plans_per_source.values())
    explicit_pair_count = diagnostics.explicit_pair_count

    assert len(documents) == ENTITY_COUNT
    assert len(plans) == PLANS_COUNT
    assert candidates <= ENTITY_COUNT * max_plans_per_source * TOP_K
    assert diagnostics.peak_materialized_pair_buffer <= TOP_K
    assert explicit_pair_count == 0

    print(
        json.dumps(
            {
                "entities": len(documents),
                "tables": len(scope.tables),
                "plans": len(plans),
                "groups": len(groups),
                "candidates": candidates,
                "max_plans_per_source": max_plans_per_source,
                "top_k": TOP_K,
                "explicit_pair_count": explicit_pair_count,
                "peak_materialized_pair_buffer": (
                    diagnostics.peak_materialized_pair_buffer
                ),
                "keyword_indexes": len(keyword_indexes),
                "vector_indexes": len(vector_indexes),
                "corpus_build_seconds": round(corpus_build_seconds, 6),
                "index_build_seconds": round(index_build_seconds, 6),
                "end_to_end_retrieval_seconds": round(
                    end_to_end_retrieval_seconds,
                    6,
                ),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
