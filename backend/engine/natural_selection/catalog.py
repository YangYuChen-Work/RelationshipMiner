"""Build a stable model-visible catalog from database metadata only."""

from __future__ import annotations

import hashlib
import json

from sqlalchemy.engine import Engine

from database import get_table_columns, get_table_names

from .models import CatalogSnapshot, CatalogTable


def build_catalog_snapshot(engine: Engine) -> CatalogSnapshot:
    """Return selectable tables and column roles without querying table rows."""

    tables: list[CatalogTable] = []
    for table_name in get_table_names(engine):
        columns = get_table_columns(engine, table_name)
        if not any(column["is_name"] for column in columns):
            continue
        if not any(column["is_class_name"] for column in columns):
            continue
        tables.append(CatalogTable(name=table_name, columns=columns))

    canonical = [table.model_dump(mode="json") for table in tables]
    metadata_revision = "sha256:" + hashlib.sha256(
        json.dumps(canonical, ensure_ascii=False, sort_keys=True).encode()
    ).hexdigest()
    return CatalogSnapshot(tables=tables, metadata_revision=metadata_revision)
