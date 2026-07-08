# 아바타 드라이버 추상 인터페이스 — 발화 구간 립싱크/표정 제어
from __future__ import annotations

from abc import ABC, abstractmethod


class AvatarDriver(ABC):
    """아바타(예: VTube Studio + Live2D)를 제어하는 드라이버.

    발화 시작/종료를 알리고, 오디오 청크를 넘겨 립싱크를 구동한다.
    구현체는 VTube Studio, 웹 네이티브 Live2D 등으로 교체 가능하다.
    """

    @abstractmethod
    async def connect(self) -> None:
        """아바타 앱에 연결한다(핸드셰이크/인증)."""
        raise NotImplementedError

    @abstractmethod
    async def start_speaking(self) -> None:
        """발화 구간 시작을 아바타에 알린다."""
        raise NotImplementedError

    @abstractmethod
    async def feed_audio(self, chunk: bytes) -> None:
        """립싱크 구동을 위해 오디오 청크를 넘긴다(오디오 라우팅 또는 파라미터 주입)."""
        raise NotImplementedError

    @abstractmethod
    async def stop_speaking(self) -> None:
        """발화 구간 종료를 아바타에 알린다(입 다물기)."""
        raise NotImplementedError
