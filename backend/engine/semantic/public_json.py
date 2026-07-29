"""Deterministic, safe projection for all public semantic-analysis JSON."""

from __future__ import annotations

import base64
import math
from datetime import date, datetime, time
from decimal import Decimal
from uuid import UUID

_MAX_SAFE_INTEGER = 2**53 - 1


def public_json_value(value: object) -> object:
    """Return a JSON-only value without relying on framework-specific encoders."""
    if value is None or isinstance(value, (bool, str)):
        return value
    if isinstance(value, int):
        return value if abs(value) <= _MAX_SAFE_INTEGER else {"$type": "integer", "value": str(value)}
    if isinstance(value, float):
        return value if math.isfinite(value) else {"$type": "float", "value": repr(value)}
    if isinstance(value, Decimal):
        return {"$type": "decimal", "value": str(value)}
    if isinstance(value, datetime):
        return {"$type": "datetime", "value": value.isoformat()}
    if isinstance(value, date):
        return {"$type": "date", "value": value.isoformat()}
    if isinstance(value, time):
        return {"$type": "time", "value": value.isoformat()}
    if isinstance(value, UUID):
        return {"$type": "uuid", "value": str(value)}
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {"$type": "bytes", "encoding": "base64", "value": base64.b64encode(bytes(value)).decode("ascii")}
    if isinstance(value, dict):
        return {str(key): public_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [public_json_value(item) for item in value]
    return {"$type": "unsupported", "value": type(value).__name__}


def public_model_json(model: object) -> dict[str, object]:
    """Project a Pydantic domain model before it is stored or sent publicly."""
    payload = model.model_dump(mode="python")  # type: ignore[attr-defined]
    value = public_json_value(payload)
    assert isinstance(value, dict)
    return value
