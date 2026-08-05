"""Safe HTTP boundary for natural-language table and field selection."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.engine import Engine

from database import get_engine
from engine.deepseek_client import DeepSeekJsonAdapter
from engine.natural_selection.catalog import build_catalog_snapshot
from engine.natural_selection.glossary import GlossaryError, load_glossary
from engine.natural_selection.models import CatalogSnapshot, SelectionResponse
from engine.natural_selection.service import (
    NaturalSelectionService,
    SelectionUnavailable,
)
from models.schemas import (
    NaturalLanguageSelectedTable,
    NaturalLanguageSelectionRequest,
    NaturalLanguageSelectionResponse,
    NaturalLanguageSelectionUnavailableResponse,
)


router = APIRouter(prefix="/api", tags=["natural-language-selection"])
SELECTOR_VERSION = "nl-selection-v1"
_GLOSSARY_PATH = Path(__file__).resolve().parents[1] / "config" / "natural_language_glossary.yaml"
_UNAVAILABLE_GUIDANCE = "当前无法完成自动选取，已有选择未发生变化；可稍后重试或切换到手动选取。"
_DEFAULT_CLARIFICATION_GUIDANCE = "请补充要分析的业务对象或关系，以便确定分析范围。"
_SCOPE_TOO_BROAD_GUIDANCE = "选择范围过大，请缩小到十张以内的核心表。"
_SELECTED_REASON = "根据描述匹配到可分析的业务表。"
_SAFE_CLARIFICATION_CODES = {
    "MISSING_BUSINESS_OBJECT",
    "AMBIGUOUS_INTENT",
    "NO_RELIABLE_MATCH",
    "SCOPE_TOO_BROAD",
}
_SAFE_UNAVAILABLE_CODES = {
    "METADATA_UNAVAILABLE",
    "GLOSSARY_INVALID",
    "MODEL_UNAVAILABLE",
    "INVALID_MODEL_OUTPUT",
}


@dataclass(frozen=True)
class NaturalSelectionContext:
    """The one request-scoped catalog, glossary, and selector dependency."""

    snapshot: CatalogSnapshot | None
    selector: NaturalSelectionService | object | None
    glossary_version: str | None
    unavailable_reason_code: str | None = None


def get_natural_selection_context(
    engine: Engine = Depends(get_engine),
) -> NaturalSelectionContext:
    """Build all server-owned selection dependencies without client input."""

    try:
        snapshot = build_catalog_snapshot(engine)
    except Exception:
        return NaturalSelectionContext(
            snapshot=None,
            selector=None,
            glossary_version=None,
            unavailable_reason_code="METADATA_UNAVAILABLE",
        )

    try:
        glossary = load_glossary(
            _GLOSSARY_PATH,
            {table.name for table in snapshot.tables},
        )
    except GlossaryError:
        return NaturalSelectionContext(
            snapshot=None,
            selector=None,
            glossary_version=None,
            unavailable_reason_code="GLOSSARY_INVALID",
        )

    return NaturalSelectionContext(
        snapshot=snapshot,
        selector=NaturalSelectionService(glossary, DeepSeekJsonAdapter()),
        glossary_version=glossary.version,
    )


def _unavailable(reason_code: str) -> JSONResponse:
    """Return a fixed response independent of any internal exception text."""

    safe_code = (
        reason_code
        if reason_code in _SAFE_UNAVAILABLE_CODES
        else "MODEL_UNAVAILABLE"
    )
    body = NaturalLanguageSelectionUnavailableResponse(
        status="unavailable",
        reason_code=safe_code,
        guidance=_UNAVAILABLE_GUIDANCE,
    )
    return JSONResponse(status_code=503, content=body.model_dump())


def _clarification_response(
    request: NaturalLanguageSelectionRequest,
    context: NaturalSelectionContext,
    result: SelectionResponse,
) -> NaturalLanguageSelectionResponse:
    reason_code = (
        result.reason_code
        if result.reason_code in _SAFE_CLARIFICATION_CODES
        else "NO_RELIABLE_MATCH"
    )
    if reason_code == "SCOPE_TOO_BROAD":
        guidance = _SCOPE_TOO_BROAD_GUIDANCE
        questions = ["请优先说明最需要分析的十张以内核心表。"]
    else:
        guidance = _DEFAULT_CLARIFICATION_GUIDANCE
        questions = ["您希望分析哪些业务对象及其关系？"]
    assert context.snapshot is not None
    assert context.glossary_version is not None
    return NaturalLanguageSelectionResponse(
        status="needs_clarification",
        request_id=request.request_id,
        metadata_revision=context.snapshot.metadata_revision,
        glossary_version=context.glossary_version,
        selector_version=SELECTOR_VERSION,
        reason_code=reason_code,
        guidance=guidance,
        suggested_questions=questions,
    )


def _selected_response(
    request: NaturalLanguageSelectionRequest,
    context: NaturalSelectionContext,
    result: SelectionResponse,
) -> NaturalLanguageSelectionResponse:
    assert context.snapshot is not None
    assert context.glossary_version is not None
    return NaturalLanguageSelectionResponse(
        status="selected",
        request_id=request.request_id,
        metadata_revision=context.snapshot.metadata_revision,
        glossary_version=context.glossary_version,
        selector_version=SELECTOR_VERSION,
        tables=[
            NaturalLanguageSelectedTable(
                table_name=table.name,
                auxiliary_fields=table.auxiliary_fields,
                reason=_SELECTED_REASON,
            )
            for table in result.tables
        ],
    )


@router.post(
    "/natural-language-selection",
    response_model=NaturalLanguageSelectionResponse,
    responses={503: {"model": NaturalLanguageSelectionUnavailableResponse}},
)
async def select_from_natural_language(
    request: NaturalLanguageSelectionRequest,
    context: NaturalSelectionContext = Depends(get_natural_selection_context),
) -> NaturalLanguageSelectionResponse | JSONResponse:
    """Select only server-owned catalog fields from a user description."""

    if context.unavailable_reason_code is not None:
        return _unavailable(context.unavailable_reason_code)
    if context.snapshot is None or context.selector is None:
        return _unavailable("METADATA_UNAVAILABLE")

    try:
        result = await context.selector.select(request.description, context.snapshot)
    except SelectionUnavailable as error:
        return _unavailable(error.reason_code)

    if result.status == "needs_clarification":
        return _clarification_response(request, context, result)
    return _selected_response(request, context, result)
