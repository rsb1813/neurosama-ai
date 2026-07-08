# TTS provider 추상 인터페이스 — 영어 텍스트를 오디오 청크로 스트리밍 합성
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class TTSProvider(ABC):
    """영어 텍스트를 저지연 오디오 스트림으로 합성하는 provider.

    구현체는 ElevenLabs, Azure, 로컬 모델 등으로 교체 가능하다.
    """

    @abstractmethod
    def synthesize(self, text_en: str) -> AsyncIterator[bytes]:
        """text_en(영어)을 오디오 바이트 청크로 스트리밍 합성한다.

        첫 청크를 최대한 빨리 내보내 체감 지연을 줄인다. 구현체는 async generator로 작성한다.
        """
        raise NotImplementedError
