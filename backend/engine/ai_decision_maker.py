"""AI 决策者 — 字段语义匹配 + 相似度算法推荐。

纯函数编排模块：
- decide_matches() — 调用 DeepSeek API 判定字段语义匹配关系
- _build_prompt_messages() — 构建包含 schema + 采样值的提示词
- _parse_ai_response() — 解析 AI 返回的结构化 JSON

所有 I/O 通过 DeepSeekClient 参数注入，便于单元测试 mock。
"""

import json

__deprecated__ = (
    "Non-production compatibility module; use RelationshipAnalyzer instead."
)
import logging
import re
from dataclasses import dataclass

from engine.deepseek_client import DeepSeekClient

logger = logging.getLogger(__name__)


# ── 数据结构 ──────────────────────────────────────────────────


@dataclass
class FieldMatchDecision:
    """AI 字段匹配决策。

    Attributes:
        source_table: 源表名。
        source_field: 源字段名。
        target_table: 目标表名。
        target_field: 目标字段名。
        algorithm: 推荐相似度算法 (edit_distance / numeric_difference / exact_match)。
        confidence: 匹配置信度，语义层 < 1.0，确定性层 = 1.0。
    """

    source_table: str
    source_field: str
    target_table: str
    target_field: str
    algorithm: str
    confidence: float


# ── 算法白名单 ─────────────────────────────────────────────────

VALID_ALGORITHMS = {"edit_distance", "numeric_difference", "exact_match"}


# ── 公共接口 ──────────────────────────────────────────────────


def decide_matches(
    table_schemas: list[dict],
    sample_values: dict[str, list[dict]],
    client: DeepSeekClient | None = None,
) -> list[FieldMatchDecision]:
    """将表 schema 列表发送给 AI，返回字段语义匹配决策列表。

    少于 2 张表时无需跨表匹配，直接返回空列表。
    API 故障或返回无效数据时优雅降级，返回空列表。

    Args:
        table_schemas: [{name, columns: [{name, type}]}] — 表 schema 信息。
        sample_values: {table_name: [row_dict]} — 每表 1 行采样数据。
        client: DeepSeek 客户端，为 None 时从环境变量创建。

    Returns:
        FieldMatchDecision 对象列表，字段匹配按置信度降序排列。
    """
    if len(table_schemas) < 2:
        return []

    try:
        if client is None:
            client = DeepSeekClient()

        messages = _build_prompt_messages(table_schemas, sample_values)
        response_text = client.chat_completion(messages)
        decisions = _parse_ai_response(response_text)

        # 验证并过滤
        valid_decisions = _validate_decisions(decisions, table_schemas)
        return sorted(valid_decisions, key=lambda d: d.confidence, reverse=True)

    except Exception:
        logger.warning("AI 决策失败，回退到空决策列表", exc_info=True)
        return []


# ── Prompt 构建 ───────────────────────────────────────────────


def _build_prompt_messages(
    table_schemas: list[dict],
    sample_values: dict[str, list[dict]],
) -> list[dict[str, str]]:
    """构建发送给 DeepSeek 的 messages 列表。

    生成系统提示 + 用户消息，包含表 schema、字段类型、
    采样值上下文，以及明确的上下文感知匹配指令。
    """
    system_prompt = (
        "你是一个数据库字段语义分析专家。"
        "你的任务是分析多张数据库表的字段，找出哪些字段之间存在语义匹配关系，"
        "并为每对匹配推荐最合适的相似度计算算法。\n\n"
        "重要规则：\n"
        "1. 上下文感知：必须基于 **表名+字段名的组合** 来判定语义，"
        "不能仅看字段名。例如 users.name 和 products.name 语义完全不同，不应匹配。\n"
        "2. 算法推荐：\n"
        "   - 字符串类型字段（VARCHAR、TEXT、CHAR 等）→ edit_distance\n"
        "   - 数值类型字段（INTEGER、INT、FLOAT、DOUBLE、DECIMAL、NUMERIC 等）→ numeric_difference\n"
        "   - 完全相同的枚举/代码值 → exact_match\n"
        "3. 置信度：语义匹配的置信度应在 0.5–0.95 之间，"
        "不要给出 1.0 的绝对置信度（确定性匹配如 FK 才给 1.0）。\n"
        "4. 只输出有实际语义相关的匹配，不要为了凑数而强行匹配不相关的字段。\n"
        "5. 两张不同的表之间才可以匹配，同一张表内的字段不要匹配。\n\n"
        "输出格式：纯 JSON 数组，每个元素为：\n"
        '{"source_table": "表1", "source_field": "字段A", '
        '"target_table": "表2", "target_field": "字段B", '
        '"algorithm": "edit_distance|numeric_difference|exact_match", '
        '"confidence": 0.0-1.0}'
    )

    # 构建用户消息：schema + 采样值
    lines = ["请分析以下数据库表的字段语义匹配关系：\n"]

    for ts in table_schemas:
        tname = ts["name"]
        lines.append(f"## 表: {tname}")
        lines.append("| 字段名 | 类型 |")
        lines.append("|--------|------|")
        for col in ts["columns"]:
            lines.append(f"| {col['name']} | {col['type']} |")

        # 附加采样值
        samples = sample_values.get(tname, [])
        if samples:
            row = samples[0]  # 取第一行
            filtered = {k: v for k, v in row.items() if k in {c["name"] for c in ts["columns"]}}
            lines.append(f"\n采样值: {json.dumps(filtered, ensure_ascii=False, default=str)}")
        lines.append("")

    user_content = "\n".join(lines)
    # 最后一轮追加指令以确保输出 JSON
    user_content += "\n请输出 JSON 数组，不要包含任何其他文字说明。"

    return [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]


# ── 响应解析 ──────────────────────────────────────────────────


def _parse_ai_response(response_text: str) -> list[dict]:
    """解析 AI 响应的 JSON，返回原始字典列表。

    处理 AI 可能包裹在 ```json ... ``` 代码块中的情况。
    """
    if not response_text or not response_text.strip():
        return []

    text = response_text.strip()

    # 尝试提取 ```json ... ``` 或 ``` ... ``` 代码块
    # 使用捕获组提取 fence 内的内容，兼容关闭 fence 不在独立行的情况
    m = re.search(r"```(?:json)?\s*\n(.*?)```", text, re.DOTALL)
    if m:
        text = m.group(1).strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("AI 响应 JSON 解析失败", exc_info=True)
        return []

    if not isinstance(data, list):
        return []

    return data


# ── 决策验证 ──────────────────────────────────────────────────


def _validate_decisions(
    raw_decisions: list[dict],
    table_schemas: list[dict],
) -> list[FieldMatchDecision]:
    """验证并过滤 AI 返回的原始决策。

    只保留字段和表名在 schema 中实际存在、算法有效的决策。
    """
    # 构建 {table_name: {field_names}} 索引
    valid_fields: dict[str, set[str]] = {}
    for ts in table_schemas:
        valid_fields[ts["name"]] = {c["name"] for c in ts["columns"]}

    validated = []
    for item in raw_decisions:
        try:
            src_table = item["source_table"]
            src_field = item["source_field"]
            tgt_table = item["target_table"]
            tgt_field = item["target_field"]
            algorithm = item["algorithm"]
            confidence = float(item["confidence"])

            # 同表跳过
            if src_table == tgt_table:
                continue

            # 算法白名单
            if algorithm not in VALID_ALGORITHMS:
                continue

            # 字段存在性校验
            if src_field not in valid_fields.get(src_table, set()):
                continue
            if tgt_field not in valid_fields.get(tgt_table, set()):
                continue

            # 置信度裁剪 + 语义层 / 确定性层区分
            confidence = max(0.0, min(1.0, confidence))
            if algorithm == "exact_match":
                # 精确匹配是确定性的 → confidence = 1.0
                confidence = 1.0
            elif confidence >= 1.0:
                # 语义匹配（edit_distance / numeric_difference）必须 < 1.0
                confidence = 0.95

            validated.append(
                FieldMatchDecision(
                    source_table=src_table,
                    source_field=src_field,
                    target_table=tgt_table,
                    target_field=tgt_field,
                    algorithm=algorithm,
                    confidence=confidence,
                )
            )
        except (KeyError, TypeError, ValueError):
            continue

    return validated
