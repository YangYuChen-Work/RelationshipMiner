"""Strict, literal YAML glossary loading and matching."""

from __future__ import annotations

from pathlib import Path
import unicodedata

import yaml
from pydantic import BaseModel, ConfigDict, ValidationError

from .models import GlossaryHit, GlossaryMapping


class GlossaryError(RuntimeError):
    """Raised when a glossary cannot be safely loaded."""

    def __init__(self, code: str = "GLOSSARY_INVALID") -> None:
        super().__init__(code)
        self.code = code


class _RawGlossaryMapping(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    aliases: list[str]
    tables: list[str]


class _RawGlossary(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schema_version: int
    glossary_version: str
    mappings: list[_RawGlossaryMapping]


def normalize_text(value: str) -> str:
    """Normalize text for deterministic literal containment matching."""

    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


class Glossary(BaseModel):
    """Validated mappings which can be matched without catalog filtering."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: str
    mappings: tuple[GlossaryMapping, ...]

    def match(self, description: str) -> list[GlossaryHit]:
        """Return every configured alias/table pair contained in description."""

        normalized = normalize_text(description)
        hits: list[GlossaryHit] = []
        seen_hits: set[tuple[str, str]] = set()
        for mapping in self.mappings:
            for alias in mapping.aliases:
                if alias not in normalized:
                    continue
                for table_name in mapping.tables:
                    identity = (alias, table_name)
                    if identity not in seen_hits:
                        seen_hits.add(identity)
                        hits.append(GlossaryHit(alias=alias, table_name=table_name))
        return hits


def load_glossary(path: Path, catalog_table_names: set[str]) -> Glossary:
    """Load a strict data-only glossary whose table targets exist in the catalog."""

    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
        raw_glossary = _RawGlossary.model_validate(payload)
    except (OSError, UnicodeDecodeError, ValidationError, yaml.YAMLError) as error:
        raise GlossaryError() from error

    if (
        raw_glossary.schema_version != 1
        or not raw_glossary.glossary_version.strip()
        or not raw_glossary.mappings
    ):
        raise GlossaryError()

    seen_aliases: set[str] = set()
    mappings: list[GlossaryMapping] = []
    for raw_mapping in raw_glossary.mappings:
        aliases = tuple(normalize_text(alias) for alias in raw_mapping.aliases)
        tables = tuple(raw_mapping.tables)
        if (
            not aliases
            or not tables
            or any(not alias for alias in aliases)
            or any(table_name not in catalog_table_names for table_name in tables)
            or len(set(aliases)) != len(aliases)
            or len(set(tables)) != len(tables)
            or seen_aliases.intersection(aliases)
        ):
            raise GlossaryError()
        seen_aliases.update(aliases)
        mappings.append(GlossaryMapping(aliases=aliases, tables=tables))

    return Glossary(
        version=raw_glossary.glossary_version.strip(),
        mappings=tuple(mappings),
    )


__all__ = [
    "Glossary",
    "GlossaryError",
    "GlossaryHit",
    "GlossaryMapping",
    "load_glossary",
    "normalize_text",
]
