# 입력을 그대로 되돌려주는 테스트/데모용 LLM (실제 Claude 연동 전 파이프라인 검증용)
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from ..events import ReplyChunk
from .base import LLMProvider


class EchoLLM(LLMProvider):
    """사용자 발화를 간단히 반향하는 mock LLM.

    영어 발화와 한국어 자막을 한두 청크로 나눠 스트리밍해 파이프라인을 검증한다.
    chunk_delay로 스트리밍 지연을 흉내 낼 수 있다(barge-in 테스트용).
    """

    def __init__(self, chunk_delay: float = 0.0) -> None:
        self._chunk_delay = chunk_delay

    async def stream_reply(
        self, user_text_ko: str, history: list[dict]
    ) -> AsyncIterator[ReplyChunk]:
        chunks = [
            ReplyChunk(
                speech_en=f"You said: {user_text_ko}.",
                subtitle_ko=f"네가 말했어: {user_text_ko}.",
            ),
            ReplyChunk(
                speech_en="That's interesting!",
                subtitle_ko="흥미롭네!",
            ),
        ]
        for chunk in chunks:
            if self._chunk_delay:
                await asyncio.sleep(self._chunk_delay)
            yield chunk
