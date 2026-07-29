from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from engine.semantic.embeddings import SentenceTransformerEmbeddingAdapter
from engine.semantic.models import EntityDocument, RelationshipPlan
from engine.semantic.retrieval import retrieve_candidate_groups


class FakeEmbeddings:
    def __init__(self) -> None:
        self.document_batches: list[list[str]] = []
        self.query_batches: list[list[str]] = []

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        self.document_batches.append(texts)
        return [self._vector(text) for text in texts]

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        self.query_batches.append(texts)
        return [self._vector(text) for text in texts]

    @staticmethod
    def _vector(text: str) -> list[float]:
        if "转子" in text:
            return [1.0, 0.0]
        if "轴承" in text:
            return [0.9, 0.1]
        if "螺栓" in text:
            return [0.0, 1.0]
        if "装配件" in text:
            return [0.0, 1.0]
        return [-1.0, 0.0]


class RejectingEmbeddings:
    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError("keyword-only retrieval must not embed documents")

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        raise AssertionError("keyword-only retrieval must not embed queries")


def _document(
    entity_id: str,
    table_name: str,
    name: str,
    *,
    secret: str | None = None,
) -> EntityDocument:
    dimensions: dict[str, object] = {"name": name}
    normalized_dimensions = {"name": name.strip().lower()}
    search_parts = [f"name：{name}"]
    if secret is not None:
        dimensions["secret"] = secret
        normalized_dimensions["secret"] = secret.strip().lower()
        search_parts.append(f"secret：{secret}")
    return EntityDocument(
        entity_id=entity_id,
        table_name=table_name,
        display_name=name,
        dimensions=dimensions,
        normalized_dimensions=normalized_dimensions,
        search_text="；".join(search_parts),
    )


def _plan(
    *,
    retrieval_modes: list[str] | None = None,
    candidate_limit: int = 2,
) -> RelationshipPlan:
    return RelationshipPlan(
        source_table="process",
        target_table="part",
        relation_type="工艺涉及零件",
        direction="source_to_target",
        source_dimensions=["name"],
        target_dimensions=["name"],
        retrieval_modes=retrieval_modes or ["keyword", "semantic"],
        candidate_limit_per_source=candidate_limit,
        reason="名称语义",
    )


def test_retrieval_searches_only_planned_target_table_and_honors_final_limit():
    embeddings = FakeEmbeddings()

    groups = retrieve_candidate_groups(
        documents=[
            _document("process:1", "process", "转子装配工艺"),
            _document("process:2", "process", "转子返修工艺"),
            _document("part:1", "part", "转子"),
            _document("part:2", "part", "装配件"),
            _document("part:3", "part", "轴承"),
            _document("material:1", "material", "转子钢"),
        ],
        plans=[_plan(candidate_limit=2)],
        embedding_adapter=embeddings,
    )

    assert [group.source.entity_id for group in groups] == [
        "process:1",
        "process:2",
    ]
    assert {
        candidate.table_name
        for group in groups
        for candidate in group.candidates
    } == {"part"}
    assert all(len(group.candidates) <= 2 for group in groups)


def test_retrieval_returns_duplicate_keyword_and_vector_hit_once():
    groups = retrieve_candidate_groups(
        documents=[
            _document("process:1", "process", "转子返修工艺"),
            _document("part:1", "part", "转子"),
            _document("part:2", "part", "螺栓"),
        ],
        plans=[_plan(candidate_limit=2)],
        embedding_adapter=FakeEmbeddings(),
    )

    assert [
        candidate.entity_id
        for candidate in groups[0].candidates
    ] == ["part:1", "part:2"]


def test_retrieval_uses_only_dimensions_selected_by_the_plan():
    embeddings = FakeEmbeddings()

    groups = retrieve_candidate_groups(
        documents=[
            _document(
                "process:1",
                "process",
                "转子装配工艺",
                secret="DO_NOT_EMBED_SOURCE",
            ),
            _document(
                "part:1",
                "part",
                "转子",
                secret="DO_NOT_EMBED_TARGET",
            ),
        ],
        plans=[_plan()],
        embedding_adapter=embeddings,
    )

    embedded_text = "\n".join(
        text
        for batch in embeddings.document_batches + embeddings.query_batches
        for text in batch
    )
    assert "DO_NOT_EMBED" not in embedded_text
    assert [
        candidate.entity_id
        for candidate in groups[0].candidates
    ] == ["part:1"]


def test_keyword_only_retrieval_does_not_load_embeddings():
    groups = retrieve_candidate_groups(
        documents=[
            _document("process:1", "process", " E-7 "),
            _document("part:1", "part", "e-7"),
        ],
        plans=[
            _plan(
                retrieval_modes=["keyword"],
                candidate_limit=1,
            )
        ],
        embedding_adapter=RejectingEmbeddings(),
    )

    assert [
        candidate.entity_id
        for candidate in groups[0].candidates
    ] == ["part:1"]


def test_sentence_transformer_adapter_loads_lazily_and_normalizes_float32(
    monkeypatch,
):
    instances = []

    class FakeSentenceTransformer:
        def __init__(self, model_name: str) -> None:
            self.model_name = model_name
            self.calls: list[tuple[list[str], dict[str, object]]] = []
            instances.append(self)

        def encode(self, texts, **kwargs):
            self.calls.append((list(texts), kwargs))
            return [[3.0, 4.0], [0.0, 0.0]][: len(texts)]

    monkeypatch.setitem(
        sys.modules,
        "sentence_transformers",
        SimpleNamespace(SentenceTransformer=FakeSentenceTransformer),
    )

    adapter = SentenceTransformerEmbeddingAdapter()
    assert instances == []

    vectors = adapter.encode_documents(["转子", ""])

    assert instances[0].model_name == "BAAI/bge-small-zh-v1.5"
    assert vectors[0] == pytest.approx([0.6, 0.8])
    assert vectors[1] == pytest.approx([0.0, 0.0])
    assert instances[0].calls == [
        (
            ["转子", ""],
            {
                "convert_to_numpy": True,
                "normalize_embeddings": True,
                "show_progress_bar": False,
            },
        )
    ]
