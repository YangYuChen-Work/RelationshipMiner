"""Tests for explicit business field roles."""

from engine.business_fields import (
    business_code_priority,
    is_class_name_field,
    is_name_field,
)


def test_business_field_roles_are_explicit():
    assert is_name_field("name") is True
    assert is_name_field("Name") is True
    assert is_name_field("display_name") is False
    assert is_class_name_field("className") is True
    assert business_code_priority("part_code") == 0
    assert business_code_priority("serial_number") == 1
    assert business_code_priority("id") is None
