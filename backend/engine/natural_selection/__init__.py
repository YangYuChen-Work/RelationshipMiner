"""Deterministic natural-language table-selection helpers."""

from .glossary import (
    Glossary,
    GlossaryError,
    GlossaryHit,
    GlossaryMapping,
    load_glossary,
)

__all__ = [
    "Glossary",
    "GlossaryError",
    "GlossaryHit",
    "GlossaryMapping",
    "load_glossary",
]
