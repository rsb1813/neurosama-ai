# 스크립트된 이벤트를 순서대로 발행하는 테스트/데모용 STT
from __future__ import annotations

import asyncio

from .base import STTProvider


class ScriptedSTT(STTProvider):
    """미리 정해둔 이벤트 목록을 순서대로 큐에 넣는 mock STT.

    script 소진 후에는 취소될 때까지 유휴 상태로 대기한다.
    """

    def __init__(self, script: list, gap: float = 0.0) -> None:
        self._script = list(script)
        self._gap = gap

    async def run(self, out: asyncio.Queue) -> None:
        for event in self._script:
            if self._gap:
                await asyncio.sleep(self._gap)
            await out.put(event)
        # 스크립트 소진 후 취소될 때까지 대기(실제 마이크가 계속 열려 있는 상황을 흉내).
        await asyncio.Event().wait()
