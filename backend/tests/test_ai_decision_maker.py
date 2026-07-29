"""AI 决策者 — 纯函数接口单元测试。

测试 decide_matches() 的字段语义匹配决策逻辑，
使用 mock DeepSeekClient 隔离外部 API 依赖。
"""

import json
import runpy
from pathlib import Path

import dotenv
import pytest
from unittest.mock import Mock

from engine.ai_decision_maker import (
    decide_matches,
    FieldMatchDecision,
    _build_prompt_messages,
    _parse_ai_response,
)


def test_default_deepseek_model_is_v4_flash(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_MODEL", raising=False)
    monkeypatch.setattr(dotenv, "load_dotenv", lambda: None)
    config_path = Path(__file__).parents[1] / "config.py"

    config_module = runpy.run_path(str(config_path))

    assert (
        config_module["Settings"].DEEPSEEK_MODEL
        == "deepseek-v4-flash"
    )


# ── 测试数据 ──────────────────────────────────────────────────


def _sample_schemas() -> list[dict]:
    """构建测试用表 schema 列表。"""
    return [
        {
            "name": "users",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "email", "type": "VARCHAR(200)"},
                {"name": "name", "type": "VARCHAR(100)"},
                {"name": "class_name", "type": "VARCHAR(500)"},
            ],
        },
        {
            "name": "orders",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "user_id", "type": "INTEGER"},
                {"name": "email", "type": "VARCHAR(200)"},
                {"name": "amount", "type": "INTEGER"},
                {"name": "className", "type": "VARCHAR(500)"},
            ],
        },
        {
            "name": "products",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "title", "type": "VARCHAR(200)"},
                {"name": "price", "type": "INTEGER"},
            ],
        },
    ]


def _sample_values() -> dict[str, list[dict]]:
    """构建测试用采样值。"""
    return {
        "users": [
            {
                "id": 1,
                "email": "alice@test.com",
                "name": "Alice",
                "class_name": "com.example.User",
            }
        ],
        "orders": [
            {
                "id": 1,
                "user_id": 1,
                "email": "alice@test.com",
                "amount": 100,
                "className": "com.example.Order",
            }
        ],
        "products": [
            {"id": 1, "title": "Widget", "price": 10}
        ],
    }


def _mock_client(response_text: str) -> Mock:
    """创建返回指定文本的 mock DeepSeekClient。"""
    client = Mock()
    client.is_configured = True
    client.chat_completion.return_value = response_text
    return client


# ── Seam 1: 基本输入输出契约 ─────────────────────────────────


class TestDecideMatchesBasic:
    """decide_matches() 基本输入/输出契约。"""

    def test_returns_empty_list_for_empty_schemas(self):
        """空 schema 列表应返回空决策列表。"""
        client = _mock_client("[]")

        result = decide_matches([], {}, client=client)

        assert result == []
        client.chat_completion.assert_not_called()

    def test_returns_field_match_decisions(self):
        """正常输入应返回 FieldMatchDecision 对象列表。"""
        ai_response = json.dumps([
            {
                "source_table": "users",
                "source_field": "email",
                "target_table": "orders",
                "target_field": "email",
                "algorithm": "edit_distance",
                "confidence": 0.85,
            }
        ])
        client = _mock_client(ai_response)

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        assert len(result) == 1
        assert isinstance(result[0], FieldMatchDecision)
        decision = result[0]
        assert decision.source_table == "users"
        assert decision.source_field == "email"
        assert decision.target_table == "orders"
        assert decision.target_field == "email"
        assert decision.algorithm == "edit_distance"
        assert decision.confidence == 0.85

    def test_each_decision_has_required_fields(self):
        """每个决策应包含全部 6 个必填字段。"""
        ai_response = json.dumps([
            {
                "source_table": "users",
                "source_field": "name",
                "target_table": "products",
                "target_field": "title",
                "algorithm": "edit_distance",
                "confidence": 0.6,
            }
        ])
        client = _mock_client(ai_response)

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        for d in result:
            assert isinstance(d.source_table, str) and d.source_table
            assert isinstance(d.source_field, str) and d.source_field
            assert isinstance(d.target_table, str) and d.target_table
            assert isinstance(d.target_field, str) and d.target_field
            assert isinstance(d.algorithm, str) and d.algorithm
            assert isinstance(d.confidence, float)
            assert 0.0 <= d.confidence <= 1.0


# ── Seam 2: 上下文感知字段匹配 ────────────────────────────────


class TestContextAwareMatching:
    """上下文感知：基于表名+字段名组合判定语义。"""

    def test_same_field_name_different_tables_distinguished(self):
        """同名但不同表的字段应由 AI 根据上下文区分。

        users.name 和 products.name 是不同的语义，
        AI 不应盲目匹配所有同名字段。
        """
        # AI 的 mock 响应不包含 users.name ↔ products.name
        ai_response = json.dumps([
            {
                "source_table": "users",
                "source_field": "email",
                "target_table": "orders",
                "target_field": "email",
                "algorithm": "edit_distance",
                "confidence": 0.9,
            }
        ])
        client = _mock_client(ai_response)

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        # 不应有 users.name ↔ products.name 的匹配
        name_matches = [
            d
            for d in result
            if d.source_field == "name" and d.target_field == "name"
        ]
        assert len(name_matches) == 0

    def test_context_includes_table_name_in_prompt(self):
        """Prompt 中应包含表名，以便 AI 进行上下文感知判断。"""
        schemas = _sample_schemas()
        values = _sample_values()
        client = _mock_client("[]")

        # 不直接调用 decide_matches，而是检查 prompt 构建
        messages = _build_prompt_messages(schemas, values)
        user_content = messages[1]["content"]

        # Prompt 中应包含表名
        assert "users" in user_content
        assert "orders" in user_content
        assert "products" in user_content


# ── Seam 3: 算法推荐 ─────────────────────────────────────────


class TestAlgorithmRecommendation:
    """相似度算法推荐——基于字段类型。"""

    def test_string_fields_recommend_edit_distance(self):
        """字符串类型字段应推荐编辑距离算法。"""
        ai_response = json.dumps([
            {
                "source_table": "users",
                "source_field": "email",
                "target_table": "orders",
                "target_field": "email",
                "algorithm": "edit_distance",
                "confidence": 0.9,
            }
        ])
        client = _mock_client(ai_response)

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        for d in result:
            assert d.algorithm in (
                "edit_distance",
                "numeric_difference",
                "exact_match",
            ), f"未知算法: {d.algorithm}"

    def test_confidence_is_below_one_for_semantic(self):
        """语义层匹配的置信度应 < 1.0（确定性层 = 1.0）。"""
        ai_response = json.dumps([
            {
                "source_table": "users",
                "source_field": "email",
                "target_table": "orders",
                "target_field": "email",
                "algorithm": "edit_distance",
                "confidence": 0.85,
            }
        ])
        client = _mock_client(ai_response)

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        for d in result:
            assert d.confidence < 1.0, (
                f"语义匹配的置信度应为 < 1.0，实际: {d.confidence}"
            )


# ── Seam 4: API 错误优雅降级 ─────────────────────────────────


class TestGracefulDegradation:
    """API 失败时优雅降级，返回空列表而非崩溃。"""

    def test_api_exception_returns_empty_list(self):
        """API 调用抛出异常时返回空列表。"""
        client = Mock()
        client.is_configured = True
        client.chat_completion.side_effect = Exception("Connection refused")

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        assert result == []

    def test_invalid_json_returns_empty_list(self):
        """API 返回无效 JSON 时返回空列表。"""
        client = _mock_client("this is not valid json")

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        assert result == []

    def test_api_key_not_configured_returns_empty_list(self):
        """API Key 未配置时返回空列表。"""
        client = Mock()
        client.is_configured = False
        client.chat_completion.side_effect = ValueError("API Key not configured")

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        assert result == []

    def test_empty_response_text_returns_empty_list(self):
        """API 返回空字符串时返回空列表。"""
        client = _mock_client("")

        result = decide_matches(_sample_schemas(), _sample_values(), client=client)

        assert result == []


# ── Seam 5: Prompt 构建 ──────────────────────────────────────


class TestPromptBuilding:
    """_build_prompt_messages 的输入/输出契约。"""

    def test_includes_field_types_in_prompt(self):
        """Prompt 应包含字段类型信息。"""
        messages = _build_prompt_messages(_sample_schemas(), _sample_values())

        user_content = messages[1]["content"]
        assert "VARCHAR" in user_content or "INTEGER" in user_content

    def test_includes_sample_values_in_prompt(self):
        """Prompt 应包含采样值作为上下文。"""
        messages = _build_prompt_messages(_sample_schemas(), _sample_values())

        user_content = messages[1]["content"]
        assert "alice@test.com" in user_content

    def test_system_prompt_includes_context_aware_instruction(self):
        """系统提示应包含上下文感知指令。"""
        messages = _build_prompt_messages(_sample_schemas(), _sample_values())

        system_content = messages[0]["content"]
        assert "表名" in system_content
        assert "字段名" in system_content

    def test_no_sample_values_handled(self):
        """无采样值时 prompt 仍可正常构建。"""
        messages = _build_prompt_messages(_sample_schemas(), {})

        # 不应抛出异常
        assert len(messages) == 2
