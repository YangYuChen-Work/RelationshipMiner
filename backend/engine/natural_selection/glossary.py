"""Strict, literal YAML glossary loading and matching."""

from __future__ import annotations

from pathlib import Path
import unicodedata

import yaml
from pydantic import BaseModel, ConfigDict, ValidationError
from yaml.constructor import ConstructorError
from yaml.resolver import BaseResolver

from .models import GlossaryHit, GlossaryMapping


class GlossaryError(RuntimeError):
    """Raised when a glossary cannot be safely loaded."""

    def __init__(self, code: str = "GLOSSARY_INVALID") -> None:
        super().__init__(code)
        self.code = code


class _UniqueKeySafeLoader(yaml.SafeLoader):
    """SafeLoader variant that rejects duplicate mapping keys."""


def _construct_unique_mapping(loader, node, deep=False):
    mapping: dict[object, object] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            is_duplicate = key in mapping
        except TypeError as error:
            raise ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                "found an unhashable key",
                key_node.start_mark,
            ) from error
        if is_duplicate:
            raise ConstructorError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key ({key!r})",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


_UniqueKeySafeLoader.add_constructor(
    BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


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
        payload = yaml.load(
            path.read_text(encoding="utf-8"),
            Loader=_UniqueKeySafeLoader,
        )
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
