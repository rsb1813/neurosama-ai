# 실제 오디오 없이 가짜 오디오 청크를 내보내는 테스트/데모용 TTS
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from .base import TTSProvider


class SilentTTS(TTSProvider):
    """텍스트 길이에 비례한 가짜 오디오 청크를 스트리밍하는 mock TTS.

    실제 소리는 내지 않으며, 파이프라인의 오디오 흐름과 지연만 흉내 낸다.
    """

    def __init__(self, chunk_delay: float = 0.0) -> None:
        self._chunk_delay = chunk_delay

    async def synthesize(self, text_en: str) -> AsyncIterator[bytes]:
        # 대략 단어 단위로 오디오 청크가 나온다고 가정.
        for word in text_en.split():
            if self._chunk_delay:
                await asyncio.sleep(self._chunk_delay)
            yield word.encode("utf-8")
