# WhisperLocalSTT의 지연 로딩·기본 설정 회귀 테스트 (무거운 모델·오디오 의존성 없이)
from __future__ import annotations

from neru.stt.base import STTProvider
from neru.stt.whisper_local import WhisperLocalSTT


def test_provider_is_lazy_and_typed():
    """생성만으로는 모델을 로드하지 않아야 하고(무거움) STTProvider여야 한다."""
    stt = WhisperLocalSTT(model_size="large-v3")
    assert isinstance(stt, STTProvider)
    # 생성 시점엔 무거운 자원이 로드되지 않음 — 첫 run()/_load()에서만 로드.
    assert stt._model is None
    assert stt._silero is None
    assert stt._language == "ko"
