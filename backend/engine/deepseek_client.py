"""DeepSeek API 客户端 — OpenAI 兼容 SDK 封装。

通过 OpenAI 兼容接口调用 DeepSeek API，用于 AI 字段语义匹配决策。
"""

import asyncio
import inspect
import json
import math
import sys
import time

from openai import AsyncOpenAI
from openai import OpenAI
from pydantic import BaseModel, ValidationError

from config import settings


class LlmBatchError(RuntimeError):
    """Raised when a structured LLM response cannot be completed."""

    def __init__(
        self,
        message: str,
        reason_code: str = "MODEL_UNAVAILABLE",
    ) -> None:
        super().__init__(message)
        self.reason_code = reason_code


class _StructuredOutputError(ValueError):
    """A provider response could not satisfy the requested JSON contract."""


class DeepSeekJsonAdapter:
    """Async DeepSeek adapter for JSON-object completions."""

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        client: object | None = None,
        request_timeout_seconds: float | None = None,
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
        self.request_timeout_seconds = (
            request_timeout_seconds
            if request_timeout_seconds is not None
            else settings.LLM_REQUEST_TIMEOUT_SECONDS
        )
        if not (
            math.isfinite(self.request_timeout_seconds)
            and self.request_timeout_seconds > 0
        ):
            raise ValueError("request_timeout_seconds must be positive")
        self._client = client

    async def complete_json(
        self,
        messages: list[dict[str, object]],
        max_tokens: int,
        response_model: type[BaseModel] | None = None,
    ) -> dict[str, object]:
        if not self.api_key:
            raise LlmBatchError("DeepSeek API key is not configured")
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
            )

        attempt_messages = [dict(message) for message in messages]
        _call_count = getattr(type(self), '_total_calls', 0) + 1
        type(self)._total_calls = _call_count
        _phase = 'unknown'
        for msg in messages:
            c = str(msg.get('content', ''))
            if 'Plan plausible cross-table' in c:
                _phase = 'planner'
            elif 'Judge only the proposed' in c:
                _phase = 'judge'
        _desc = f'[LLM #{_call_count}] [{_phase}] {self.model}'
        print(f'{_desc} -> calling...', file=sys.stderr, flush=True)
        _start = time.monotonic()
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                try:
                    async with asyncio.timeout(self.request_timeout_seconds):
                        response = await self._client.chat.completions.create(
                            model=self.model,
                            messages=attempt_messages,
                            temperature=0.1,
                            response_format={"type": "json_object"},
                            max_tokens=max_tokens,
                        )
                except TimeoutError as error:
                    raise TimeoutError(
                        "LLM provider attempt timed out"
                    ) from error
                choice = response.choices[0]
                _elapsed = time.monotonic() - _start
                usage = getattr(response, "usage", None)
                _tokens = getattr(usage, "total_tokens", "?")
                print(
                    f'{_desc} <- {_elapsed:.1f}s, {_tokens} tokens, '
                    f'finish={choice.finish_reason}',
                    file=sys.stderr, flush=True,
                )
                if choice.finish_reason == "length":
                    raise _StructuredOutputError(
                        "finish_reason=length: JSON output was truncated"
                    )
                content = choice.message.content
                if not content or not content.strip():
                    raise _StructuredOutputError("empty response content")
                try:
                    data = json.loads(content)
                except json.JSONDecodeError as error:
                    raise _StructuredOutputError(
                        f"JSON validation error: {error}"
                    ) from error
                if not isinstance(data, dict):
                    raise _StructuredOutputError(
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
                            "JSON object matching the requested contract."
                        ),
                    },
                ]

        reason_code = (
            "INVALID_MODEL_OUTPUT"
            if isinstance(last_error, (_StructuredOutputError, ValidationError))
            else "MODEL_UNAVAILABLE"
        )
        raise LlmBatchError(
            "DeepSeek JSON completion failed after two attempts: "
            f"{last_error}",
            reason_code=reason_code,
        ) from last_error

    async def aclose(self) -> None:
        """Close a lazily created async provider client when a request ends."""

        client, self._client = self._client, None
        close = getattr(client, "close", None)
        if close is None:
            return
        try:
            result = close()
            if inspect.isawaitable(result):
                await result
        except Exception:
            # Provider shutdown errors must not replace a completed API response.
            return


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
