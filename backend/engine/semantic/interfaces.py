from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel


class EmbeddingAdapter(Protocol):
    def encode_documents(self, texts: list[str]) -> list[list[float]]: ...

    def encode_queries(self, texts: list[str]) -> list[list[float]]: ...


class JsonLlmAdapter(Protocol):
    """Contract for bounded, validated JSON-object completions.

    Implementations own response validation and retry behavior. They
    must make at most two total LLM attempts: one initial attempt and
    one repair attempt.
    """

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]:
        """Return validated JSON or raise ``LlmBatchError``.

        When ``response_model`` is provided, the implementation must
        validate the JSON object with that model on each attempt. Empty,
        truncated, malformed, non-object, or model-invalid output may
        receive one repair attempt. If the second attempt fails, raise
        ``LlmBatchError``; never turn a failure into a silent empty
        result.
        """
        ...
