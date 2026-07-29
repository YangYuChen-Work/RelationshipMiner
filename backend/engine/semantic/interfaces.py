from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel


class EmbeddingAdapter(Protocol):
    def encode_documents(self, texts: list[str]) -> list[list[float]]: ...

    def encode_queries(self, texts: list[str]) -> list[list[float]]: ...


class JsonLlmAdapter(Protocol):
    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]: ...
