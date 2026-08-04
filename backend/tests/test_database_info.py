"""Public database information contract."""

from types import SimpleNamespace


def test_database_info_exposes_safe_connection_metadata(client, monkeypatch):
    """The selection page needs connection facts without database credentials."""
    import routers.tables as tables_router

    monkeypatch.setattr(
        tables_router,
        "settings",
        SimpleNamespace(
            DB_HOST="db.internal",
            DB_PORT=3307,
            DB_NAME="operations",
        ),
        raising=False,
    )

    response = client.get("/api/database-info")

    assert response.status_code == 200
    assert response.json() == {
        "connection_status": "connected",
        "database_name": "operations",
        "connection_address": "db.internal:3307/operations",
        "table_count": 4,
    }
