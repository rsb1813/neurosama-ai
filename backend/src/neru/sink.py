# 파이프라인 출력(상태 변화·자막)을 프론트/테스트 등 외부로 내보내는 싱크 인터페이스
from __future__ import annotations

from typing import Protocol, runtime_checkable

from .events import State


@runtime_checkable
class OutputSink(Protocol):
    """오케스트레이터가 상태 변화와 자막을 밀어내는 출력 경계(boundary).

    provider(STT/LLM/TTS/Avatar)는 파이프라인 내부 엔진이라 ABC로 두지만, 싱크는
    외부 소비자(WebSocket 서버, 테스트 recorder 등)가 구현하는 경계이므로 구조적
    타이핑(Protocol)이 더 자연스럽다. 이 차이는 의도된 것이며 드리프트가 아니다.
    """

    async def on_state(self, state: State) -> None:
        """파이프라인 상태 변화를 통지한다."""
        ...

    async def on_subtitle(self, subtitle_ko: str, speech_en: str) -> None:
        """한 조각의 자막(한국어)과 대응 영어 발화를 통지한다."""
        ...
