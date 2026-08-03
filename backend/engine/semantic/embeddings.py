from __future__ import annotations

import os
os.environ.setdefault("HF_HUB_OFFLINE", "1")

from typing import Any

import numpy as np

from config import settings


class SentenceTransformerEmbeddingAdapter:
    def __init__(self, model_name: str | None = None) -> None:
        self._model_name = model_name or settings.EMBEDDING_MODEL
        self._model: Any | None = None

    def encode_documents(self, texts: list[str]) -> list[list[float]]:
        return self._encode(texts)

    def encode_queries(self, texts: list[str]) -> list[list[float]]:
        return self._encode(texts)

    def _encode(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        vectors = self._get_model().encode(
            texts,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        matrix = np.asarray(vectors, dtype=np.float32)
        if matrix.ndim == 1:
            matrix = matrix.reshape(1, -1)

        norms = np.linalg.norm(matrix, axis=1, keepdims=True)
        normalized = np.divide(
            matrix,
            norms,
            out=np.zeros_like(matrix, dtype=np.float32),
            where=norms != 0,
        )
        return normalized.astype(np.float32, copy=False).tolist()

    def _get_model(self) -> Any:
        if self._model is None:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer(
                self._model_name,
                local_files_only=True,
            )
        return self._model
