# 호출 이력을 기록/로그하는 테스트/데모용 아바타 드라이버 (실제 VTube Studio 연동 전)
from __future__ import annotations

from .base import AvatarDriver


class LoggingAvatar(AvatarDriver):
    """실제 아바타 없이 제어 호출을 리스트에 기록하는 mock 드라이버.

    calls 리스트로 start/stop/feed 호출 순서를 검증할 수 있다.
    """

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.audio_chunks: list[bytes] = []

    async def connect(self) -> None:
        self.calls.append("connect")

    async def start_speaking(self) -> None:
        self.calls.append("start_speaking")

    async def feed_audio(self, chunk: bytes) -> None:
        self.audio_chunks.append(chunk)

    async def stop_speaking(self, drain: bool = False) -> None:
        self.calls.append("stop_speaking")
