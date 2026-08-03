"""Classify database columns by their business-facing roles."""

import re
import unicodedata


CLASS_NAME_FIELDS = {"class_name", "classname", "class"}
CODE_TOKENS = ("code", "number", "no", "serial", "model")


def normalize_field_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKC", name).strip()
    return re.sub(r"(?<!^)(?=[A-Z])", "_", normalized).lower()


def is_name_field(name: str) -> bool:
    return normalize_field_name(name) == "name"


def is_class_name_field(name: str) -> bool:
    normalized = normalize_field_name(name)
    return normalized in CLASS_NAME_FIELDS or normalized.replace("_", "") == "classname"


def business_code_priority(name: str) -> int | None:
    tokens = [token for token in re.split(r"[^a-z0-9]+", normalize_field_name(name)) if token]
    for priority, token in enumerate(CODE_TOKENS):
        if token in tokens:
            return priority
    return None
