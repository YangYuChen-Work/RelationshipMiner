"""Data models for the natural-language glossary."""

from pydantic import BaseModel, ConfigDict


class GlossaryMapping(BaseModel):
    """One normalized alias group and its catalog table targets."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    aliases: tuple[str, ...]
    tables: tuple[str, ...]


class GlossaryHit(BaseModel):
    """A literal alias match paired with one configured table."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    alias: str
    table_name: str
