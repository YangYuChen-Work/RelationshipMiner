"""Data models for deterministic natural-language table selection."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


class CatalogColumn(BaseModel):
    """One model-visible database column and its structural roles."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    type: str
    is_name: bool
    is_class_name: bool
    is_primary_key: bool
    is_foreign_key: bool


class CatalogTable(BaseModel):
    """One selectable table with metadata only, never row values."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    columns: list[CatalogColumn]


class CatalogSnapshot(BaseModel):
    """A stable, metadata-only catalog visible to the selection model."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tables: list[CatalogTable]
    metadata_revision: str


class ModelTableSelection(BaseModel):
    """Structured field-selection intent returned by the model."""

    model_config = ConfigDict(extra="forbid")

    table_name: str
    field_selection: Literal["all", "specified"]
    auxiliary_fields: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=1, max_length=160)


class ModelSelection(BaseModel):
    """The complete structured selection response returned by the model."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["selected", "needs_clarification"]
    tables: list[ModelTableSelection] = Field(default_factory=list)
    reason_code: str | None = None
    guidance: str | None = None
    suggested_questions: list[str] = Field(default_factory=list, max_length=2)


class ValidatedTableSelection(BaseModel):
    """A safe table selection with fully expanded auxiliary fields."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str
    auxiliary_fields: list[str]
    reason: str


class ValidatedSelection(BaseModel):
    """The deterministic result that may be returned to the caller."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    tables: list[ValidatedTableSelection]


class SelectionResponse(BaseModel):
    """Safe service result for a selection or a user clarification request."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    status: Literal["selected", "needs_clarification"]
    tables: list[ValidatedTableSelection] = Field(default_factory=list)
    reason_code: str | None = None
    guidance: str | None = None
    suggested_questions: list[str] = Field(default_factory=list, max_length=2)
