# 파이프라인 출력(상태 변화·자막)을 프론트/테스트 등 외부로 내보내는 싱크 인터페이스
from __future__ import annotations

from typing import Protocol, runtime_checkable

from .events import State


@runtime_checkable
class OutputSink(Protocol):
    """오케스트레이터가 상태 변화와 자막을 밀어내는 대상.

    실제 운영에서는 WebSocket 서버, 테스트에서는 기록용 recorder가 구현한다.
    """

    async def on_state(self, state: State) -> None:
        """파이프라인 상태 변화를 통지한다."""
        ...

    async def on_subtitle(self, subtitle_ko: str, speech_en: str) -> None:
        """한 조각의 자막(한국어)과 대응 영어 발화를 통지한다."""
        ...
