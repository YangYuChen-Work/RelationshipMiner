"""HTTP contracts for natural-language table and field selection."""

from __future__ import annotations

from dataclasses import replace

import pytest

from engine.natural_selection.models import (
    SelectionResponse,
    ValidatedTableSelection,
)
from engine.natural_selection.service import SelectionUnavailable


class _StaticSelector:
    def __init__(self, response: SelectionResponse) -> None:
        self.response = response

    async def select(self, description, snapshot) -> SelectionResponse:
        return self.response


class _UnavailableSelector:
    async def select(self, description, snapshot) -> SelectionResponse:
        raise SelectionUnavailable("MODEL_UNAVAILABLE")


@pytest.fixture
def selection_context(client):
    from database import get_engine
    from engine.natural_selection.catalog import build_catalog_snapshot
    from routers.natural_language_selection import NaturalSelectionContext

    engine = client.app.dependency_overrides[get_engine]()
    return NaturalSelectionContext(
        snapshot=build_catalog_snapshot(engine),
        selector=_StaticSelector(
            SelectionResponse(
                status="selected",
                tables=[
                    ValidatedTableSelection(
                        name="orders",
                        auxiliary_fields=["amount"],
                        reason="Untrusted model explanation.",
                    )
                ],
            )
        ),
        glossary_version="test-glossary-v1",
    )


@pytest.fixture
def override_selector(client, selection_context):
    from routers.natural_language_selection import get_natural_selection_context

    client.app.dependency_overrides[get_natural_selection_context] = (
        lambda: selection_context
    )
    yield selection_context
    client.app.dependency_overrides.pop(get_natural_selection_context, None)


@pytest.fixture
def unavailable_selector(client, selection_context):
    from routers.natural_language_selection import get_natural_selection_context

    client.app.dependency_overrides[get_natural_selection_context] = lambda: replace(
        selection_context,
        selector=_UnavailableSelector(),
    )
    yield
    client.app.dependency_overrides.pop(get_natural_selection_context, None)


def test_selection_returns_all_fields_and_metadata_revision(client, override_selector):
    response = client.post(
        "/api/natural-language-selection",
        json={"request_id": "req-1", "description": "分析订单"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["request_id"] == "req-1"
    assert body["status"] == "selected"
    assert body["tables"][0]["table_name"] == "orders"
    assert body["tables"][0]["auxiliary_fields"] == ["amount"]
    assert body["metadata_revision"].startswith("sha256:")
    assert body["glossary_version"] == "test-glossary-v1"
    assert body["selector_version"] == "nl-selection-v1"


def test_model_failure_returns_503_without_internal_message(
    client,
    unavailable_selector,
):
    response = client.post(
        "/api/natural-language-selection",
        json={"request_id": "req-2", "description": "分析订单"},
    )

    assert response.status_code == 503
    assert response.json()["status"] == "unavailable"
    assert response.json()["reason_code"] == "MODEL_UNAVAILABLE"
    assert "api_key" not in response.text


@pytest.mark.parametrize(
    "payload",
    [
        {"request_id": "req-3", "description": ""},
        {"request_id": "req-3", "description": "x" * 1001},
        {
            "request_id": "req-3",
            "description": "分析订单",
            "tables": [{"name": "orders"}],
        },
    ],
)
def test_selection_rejects_invalid_or_client_supplied_scope(payload, client):
    response = client.post("/api/natural-language-selection", json=payload)

    assert response.status_code == 422


def test_scope_too_broad_returns_fixed_clarification_without_tables(
    client,
    override_selector,
):
    from routers.natural_language_selection import get_natural_selection_context

    context = client.app.dependency_overrides[get_natural_selection_context]()
    client.app.dependency_overrides[get_natural_selection_context] = lambda: replace(
        context,
        selector=_StaticSelector(
            SelectionResponse(
                status="needs_clarification",
                reason_code="SCOPE_TOO_BROAD",
                guidance="Untrusted provider wording",
                suggested_questions=["Untrusted provider question"],
            )
        ),
    )

    response = client.post(
        "/api/natural-language-selection",
        json={"request_id": "req-4", "description": "分析所有对象"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "needs_clarification"
    assert body["reason_code"] == "SCOPE_TOO_BROAD"
    assert body["tables"] == []
    assert "Untrusted" not in response.text
    assert body["request_id"] == "req-4"
    assert body["metadata_revision"].startswith("sha256:")
