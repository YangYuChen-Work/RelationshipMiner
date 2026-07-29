"""Low-cost readiness probes that never load models or call an LLM."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal, TypedDict

from sqlalchemy import text

from config import Settings, settings


class ReadinessReport(TypedDict):
    status: Literal["ready", "degraded"]
    database: Literal["ready", "unavailable"]
    embedding_model: Literal["ready", "missing"]
    llm: Literal["configured", "missing"]


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
        if api_key.strip() and model.strip():
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
        if _contains_model_files(configured_path):
            return "ready"

        hub_directory = f"models--{name.replace('/', '--')}"
        legacy_directory = name.replace("/", "_")
        for cache_root in _huggingface_cache_roots():
            if (
                _contains_model_files(cache_root / hub_directory)
                or _contains_model_files(cache_root / legacy_directory)
            ):
                return "ready"
    except Exception:
        return "missing"
    return "missing"


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
    if not (directory / "config.json").is_file():
        return False
    return (
        any(directory.glob("*.safetensors"))
        or any(directory.glob("pytorch_model*.bin"))
    )


def _huggingface_cache_roots() -> tuple[Path, ...]:
    """Resolve cache roots without importing huggingface_hub or Torch."""
    roots: list[Path] = []
    hub_cache = os.getenv("HF_HUB_CACHE", "").strip()
    if hub_cache:
        roots.append(Path(hub_cache).expanduser())

    hf_home = settings.HF_HOME.strip()
    if hf_home:
        roots.append(Path(hf_home).expanduser() / "hub")
    else:
        xdg_cache = os.getenv("XDG_CACHE_HOME", "").strip()
        cache_home = (
            Path(xdg_cache).expanduser()
            if xdg_cache
            else Path.home() / ".cache"
        )
        roots.append(cache_home / "huggingface" / "hub")

    sentence_transformers_home = os.getenv(
        "SENTENCE_TRANSFORMERS_HOME",
        "",
    ).strip()
    if sentence_transformers_home:
        roots.append(Path(sentence_transformers_home).expanduser())

    return tuple(dict.fromkeys(roots))
