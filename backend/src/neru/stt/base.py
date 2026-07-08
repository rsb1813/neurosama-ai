# STT provider 추상 인터페이스 — 마이크를 청취해 발화 이벤트/전사를 큐로 발행
from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod


class STTProvider(ABC):
    """마이크를 연속 청취하며 SpeechStarted / Transcript 이벤트를 발행하는 provider.

    구현체는 로컬 Whisper, 클라우드 STT 등으로 교체 가능하다.
    """

    @abstractmethod
    async def run(self, out: asyncio.Queue) -> None:
        """마이크를 청취하며 events.SpeechStarted / events.Transcript 를 out 큐에 넣는다.

        취소(CancelledError)되면 오디오 자원을 정리하고 종료해야 한다.
        """
        raise NotImplementedError
