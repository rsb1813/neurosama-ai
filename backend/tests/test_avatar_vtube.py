# VTubeStudioAvatar의 지연 연결·오디오 버퍼링 회귀 테스트 (VTS/오디오 하드웨어 없이)
from __future__ import annotations

from neru.avatar.base import AvatarDriver
from neru.avatar.vtube_studio import VTubeStudioAvatar


def test_avatar_is_typed_and_lazy():
    """생성만으로는 VTS에 연결하지 않아야 하고 AvatarDriver여야 한다."""
    avatar = VTubeStudioAvatar(sample_rate=24000)
    assert isinstance(avatar, AvatarDriver)
    assert avatar._vts is None
    assert avatar._connected is False


async def test_feed_audio_buffers():
    """feed_audio가 재생 버퍼에 쌓이고 buffer_empty가 이를 반영해야 한다."""
    avatar = VTubeStudioAvatar(sample_rate=24000)
    assert await avatar.buffer_empty()
    await avatar.feed_audio(b"\x00\x01" * 32)
    assert not await avatar.buffer_empty()
