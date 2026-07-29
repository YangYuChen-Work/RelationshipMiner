from __future__ import annotations

from typing import Protocol


class EmbeddingAdapter(Protocol):
    def encode_documents(self, texts: list[str]) -> list[list[float]]: ...

    def encode_queries(self, texts: list[str]) -> list[list[float]]: ...


class JsonLlmAdapter(Protocol):
    async def complete_json(
        self, messages: list[dict[str, object]], max_tokens: int
    ) -> dict[str, object]: ...
