"""DeepSeek API 客户端 — OpenAI 兼容 SDK 封装。

通过 OpenAI 兼容接口调用 DeepSeek API，用于 AI 字段语义匹配决策。
"""

import json

from openai import AsyncOpenAI
from openai import OpenAI
from pydantic import BaseModel

from config import settings


class LlmBatchError(RuntimeError):
    """Raised when a structured LLM response cannot be completed."""


class DeepSeekJsonAdapter:
    """Async DeepSeek adapter for JSON-object completions."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        client: object | None = None,
    ):
        self.api_key = (
            api_key
            if api_key is not None
            else settings.DEEPSEEK_API_KEY
        )
        self.base_url = (
            base_url
            if base_url is not None
            else settings.DEEPSEEK_BASE_URL
        )
        self.model = (
            model if model is not None else settings.DEEPSEEK_MODEL
        )
        self._client = client

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]:
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
            )

        attempt_messages = [dict(message) for message in messages]
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                response = await self._client.chat.completions.create(
                    model=self.model,
                    messages=attempt_messages,
                    temperature=0.1,
                    response_format={"type": "json_object"},
                    max_tokens=max_tokens,
                )
                choice = response.choices[0]
                if choice.finish_reason == "length":
                    raise ValueError(
                        "finish_reason=length: JSON output was truncated"
                    )
                content = choice.message.content
                if not content or not content.strip():
                    raise ValueError("empty response content")
                try:
                    data = json.loads(content)
                except json.JSONDecodeError as error:
                    raise ValueError(
                        f"JSON validation error: {error}"
                    ) from error
                if not isinstance(data, dict):
                    raise ValueError(
                        "JSON validation error: root must be an object"
                    )
                if response_model is not None:
                    return (
                        response_model.model_validate(data).model_dump()
                    )
                return data
            except Exception as error:
                last_error = error
                if attempt == 1:
                    break
                attempt_messages = [
                    *attempt_messages,
                    {
                        "role": "user",
                        "content": (
                            "The previous JSON response failed "
                            f"validation: {error}. Return one corrected "
                            "JSON object matching the requested example "
                            "and schema."
                        ),
                    },
                ]

        raise LlmBatchError(
            "DeepSeek JSON completion failed after two attempts: "
            f"{last_error}"
        ) from last_error


class DeepSeekClient:
    """DeepSeek API 客户端，封装 OpenAI 兼容接口。

    所有配置从 settings 读取，也可通过构造函数参数覆盖（便于测试）。
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
    ):
        self.api_key = api_key if api_key is not None else settings.DEEPSEEK_API_KEY
        self.base_url = (
            base_url if base_url is not None else settings.DEEPSEEK_BASE_URL
        )
        self.model = model if model is not None else settings.DEEPSEEK_MODEL

    @property
    def is_configured(self) -> bool:
        """检查 API Key 是否已配置。"""
        return bool(self.api_key)

    def chat_completion(self, messages: list[dict[str, str]]) -> str:
        """发送聊天补全请求，返回模型响应文本。

        Args:
            messages: 标准 OpenAI 消息格式列表。

        Returns:
            模型响应的文本内容。

        Raises:
            ValueError: API Key 未配置。
            Exception: API 调用失败时透传异常。
        """
        if not self.is_configured:
            raise ValueError(
                "DeepSeek API Key 未配置，请在 .env 中设置 DEEPSEEK_API_KEY"
            )

        client = OpenAI(api_key=self.api_key, base_url=self.base_url)
        response = client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=0.1,  # 低温度以获得稳定的结构化输出
        )
        return response.choices[0].message.content or ""
