"""Low-cost readiness probes that never load models or call an LLM."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any, Literal, TypedDict

from sqlalchemy import text

from config import Settings, settings


class ReadinessReport(TypedDict):
    status: Literal["ready", "degraded"]
    database: Literal["ready", "unavailable"]
    embedding_model: Literal["ready", "missing"]
    llm: Literal["configured", "missing"]


_PLACEHOLDER_LLM_KEYS = frozenset(
    {
        "apikey",
        "changeme",
        "dummy",
        "example",
        "examplekey",
        "placeholder",
        "replacewithyourkey",
        "testkey",
        "yourkey",
        "yourkeyhere",
    }
)


def readiness_report(
    engine: Any,
    config: Settings = settings,
) -> ReadinessReport:
    """Return fixed status values without exposing configuration or errors."""
    database = _database_status(engine)
    embedding_model = _embedding_model_status(config.EMBEDDING_MODEL)
    llm = _llm_status(
        config.DEEPSEEK_API_KEY,
        config.DEEPSEEK_MODEL,
    )
    overall = (
        "ready"
        if (
            database == "ready"
            and embedding_model == "ready"
            and llm == "configured"
        )
        else "degraded"
    )
    return {
        "status": overall,
        "database": database,
        "embedding_model": embedding_model,
        "llm": llm,
    }


def _database_status(
    engine: Any,
) -> Literal["ready", "unavailable"]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        return "unavailable"
    return "ready"


def _llm_status(
    api_key: str,
    model: str,
) -> Literal["configured", "missing"]:
    try:
        key = api_key.strip()
        normalized_key = re.sub(r"[^a-z0-9]", "", key.casefold())
        if (
            key
            and normalized_key not in _PLACEHOLDER_LLM_KEYS
            and model.strip()
        ):
            return "configured"
    except Exception:
        pass
    return "missing"


def _embedding_model_status(
    model_name: str,
) -> Literal["ready", "missing"]:
    try:
        name = model_name.strip()
        if not name:
            return "missing"

        configured_path = Path(name).expanduser()
        if configured_path.is_absolute():
            return (
                "ready"
                if _contains_model_files(configured_path.resolve())
                else "missing"
            )
        if not _is_safe_hf_repo_id(name):
            return "missing"

        hub_directory = f"models--{name.replace('/', '--')}"
        for cache_root in _huggingface_cache_roots():
            root = cache_root.expanduser().resolve()
            model_cache = (root / hub_directory).resolve()
            if not _is_within(model_cache, root):
                return "missing"
            if _contains_model_files(model_cache):
                return "ready"
    except Exception:
        return "missing"
    return "missing"


def _is_safe_hf_repo_id(repo_id: str) -> bool:
    if "\\" in repo_id or len(repo_id) > 96:
        return False
    segments = repo_id.split("/")
    if len(segments) not in (1, 2):
        return False
    if ".." in repo_id or "--" in repo_id:
        return False
    return all(
        re.fullmatch(
            r"[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?",
            segment,
        )
        is not None
        and not segment.endswith(".git")
        for segment in segments
    )


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _contains_model_files(directory: Path) -> bool:
    if not directory.is_dir():
        return False
    if _is_model_snapshot(directory):
        return True

    snapshots = directory / "snapshots"
    if not snapshots.is_dir():
        return False
    return any(
        _is_model_snapshot(snapshot)
        for snapshot in snapshots.iterdir()
        if snapshot.is_dir()
    )


def _is_model_snapshot(directory: Path) -> bool:
    if not _has_essential_sentence_transformer_files(directory):
        return False
    if any(
        _is_nonempty_file(directory / name)
        for name in ("model.safetensors", "pytorch_model.bin")
    ):
        return True
    return any(
        _has_complete_shards(directory, index_name, pattern)
        for index_name, pattern in (
            (
                "model.safetensors.index.json",
                re.compile(
                    r"model-(?P<number>\d{5})-of-"
                    r"(?P<total>\d{5})\.safetensors",
                ),
            ),
            (
                "pytorch_model.bin.index.json",
                re.compile(
                    r"pytorch_model-(?P<number>\d{5})-of-"
                    r"(?P<total>\d{5})\.bin",
                ),
            ),
        )
    )


def _has_essential_sentence_transformer_files(directory: Path) -> bool:
    """Check cached files only; do not import or construct a model here."""
    if not all(
        _is_nonempty_file(directory / name)
        for name in ("config.json", "modules.json", "tokenizer_config.json")
    ):
        return False
    return any(
        _is_nonempty_file(directory / name)
        for name in ("tokenizer.json", "tokenizer.model", "vocab.txt")
    )


def _has_complete_shards(
    directory: Path,
    index_name: str,
    shard_pattern: re.Pattern[str],
) -> bool:
    index_path = directory / index_name
    if not _is_nonempty_file(index_path):
        return False
    try:
        payload = json.loads(index_path.read_text(encoding="utf-8"))
        weight_map = payload["weight_map"]
        filenames = set(weight_map.values())
    except (KeyError, TypeError, ValueError, OSError):
        return False
    if not filenames or not all(isinstance(name, str) for name in filenames):
        return False

    matches = [shard_pattern.fullmatch(name) for name in filenames]
    if any(match is None for match in matches):
        return False
    totals = {int(match["total"]) for match in matches if match is not None}
    numbers = {int(match["number"]) for match in matches if match is not None}
    if len(totals) != 1:
        return False
    total = totals.pop()
    if total < 1 or numbers != set(range(1, total + 1)):
        return False
    return all(_is_nonempty_file(directory / name) for name in filenames)


def _is_nonempty_file(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def _huggingface_cache_roots() -> tuple[Path, ...]:
    """Resolve the one cache root Sentence Transformers will actually use."""
    for variable in (
        "SENTENCE_TRANSFORMERS_HOME",
        "HF_HUB_CACHE",
        "HUGGINGFACE_HUB_CACHE",
    ):
        if variable in os.environ:
            return (_expanded_path(os.environ[variable]),)

    if "HF_HOME" in os.environ:
        return (_expanded_path(os.environ["HF_HOME"]) / "hub",)
    if "XDG_CACHE_HOME" in os.environ:
        cache_home = _expanded_path(os.environ["XDG_CACHE_HOME"])
    else:
        cache_home = Path.home() / ".cache"
    return ((cache_home / "huggingface" / "hub").resolve(),)


def _expanded_path(value: str) -> Path:
    return Path(os.path.expandvars(value)).expanduser().resolve()
