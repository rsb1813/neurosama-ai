# 상태 변화와 자막을 콘솔에 출력하는 데모용 OutputSink
from __future__ import annotations

from .events import State


class ConsoleSink:
    """파이프라인 흐름을 표준출력으로 보여주는 간단한 싱크(데모/디버그용)."""

    async def on_state(self, state: State) -> None:
        print(f"[state] {state.value}")

    async def on_subtitle(self, subtitle_ko: str, speech_en: str) -> None:
        print(f"[자막] {subtitle_ko}   (EN: {speech_en})")
