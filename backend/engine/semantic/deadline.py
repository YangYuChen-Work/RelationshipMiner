"""Cooperative deadline support for bounded semantic-analysis stages."""

from __future__ import annotations


class DeadlineExceeded(RuntimeError):
    """Raised by a stage that discovers the shared analysis deadline elapsed."""

    def __init__(self, stage: str) -> None:
        self.stage = stage
        super().__init__(f"分析超时：{stage}。")
