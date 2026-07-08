# Chatterbox(로컬, RTX 5080/CUDA) 기반 TTS provider — 영어 텍스트를 PCM16 오디오 청크로 합성
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import numpy as np

from .base import TTSProvider


class ChatterboxTTS(TTSProvider):
    """Resemble AI Chatterbox로 영어 음성을 합성하는 provider.

    - 모델은 최초 합성 시 1회 로드(무거움) 후 재사용한다.
    - Chatterbox `generate()`는 동기·블로킹이라 `asyncio.to_thread`로 오프로드해
      이벤트 루프(=barge-in 응답성)를 막지 않는다.
    - 문장 단위로 전체를 생성한 뒤 chunk_ms 프레임으로 잘라 스트리밍한다.
      (첫 오디오 지연=문장 생성 시간. 추후 chatterbox-streaming 포크로 더 낮출 여지.)
    - 출력은 24kHz mono PCM16 little-endian 바이트.
    """

    def __init__(
        self,
        device: str = "cuda",
        chunk_ms: int = 50,
        audio_prompt_path: str | None = None,
    ) -> None:
        self._device = device
        self._chunk_ms = chunk_ms
        # 복제 대상 목소리 샘플 경로. None이면 Chatterbox 기본 음성 사용.
        self._audio_prompt_path = audio_prompt_path
        self._model = None
        self.sample_rate: int | None = None

    def _ensure_model(self) -> None:
        # chatterbox는 무거운 import라 provider 인스턴스화가 아니라 첫 사용 시 지연 로드.
        if self._model is None:
            from chatterbox.tts import ChatterboxTTS as _ChatterboxModel

            self._model = _ChatterboxModel.from_pretrained(device=self._device)
            self.sample_rate = self._model.sr

    def _generate_pcm(self, text_en: str) -> bytes:
        self._ensure_model()
        kwargs = {}
        if self._audio_prompt_path is not None:
            kwargs["audio_prompt_path"] = self._audio_prompt_path
        wav = self._model.generate(text_en, **kwargs)  # (1, N) float32 텐서
        audio = wav.squeeze(0).cpu().numpy()
        pcm16 = (np.clip(audio, -1.0, 1.0) * 32767.0).astype("<i2")
        return pcm16.tobytes()

    async def synthesize(self, text_en: str) -> AsyncIterator[bytes]:
        # 생성(모델 로드 포함)은 블로킹이므로 스레드로 오프로드.
        pcm = await asyncio.to_thread(self._generate_pcm, text_en)
        # PCM16 = 샘플당 2바이트. chunk_ms 프레임 경계에 맞춰 자른다.
        assert self.sample_rate is not None
        frame_bytes = int(self.sample_rate * self._chunk_ms / 1000) * 2
        for i in range(0, len(pcm), frame_bytes):
            yield pcm[i : i + frame_bytes]
