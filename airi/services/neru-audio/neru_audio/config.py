# 게이트웨이 런타임 설정 — 클로닝 음성 경로와 STT 모델 크기 (.env 있으면 로드)
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# 기본 클로닝 음성(Neuro-sama 레퍼런스). config.py 기준 ../assets/voices/.
_DEFAULT_VOICE_PROMPT = Path(__file__).resolve().parents[1] / "assets" / "voices" / "neuro_ref.wav"

try:  # python-dotenv는 선택적 — 없으면 실제 환경변수만 사용
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass


@dataclass(frozen=True)
class Settings:
    """게이트웨이 실행에 필요한 설정."""

    # TTS 클로닝 대상 음성 wav 경로. None이면 Chatterbox 기본 음성.
    tts_voice_prompt: str | None
    # faster-whisper 모델 크기.
    stt_model_size: str


def load_settings() -> Settings:
    # NERU_TTS_VOICE_PROMPT: 빈 문자열이면 기본 음성, 미설정이면 번들 Neuro 레퍼런스.
    voice_prompt = os.getenv("NERU_TTS_VOICE_PROMPT")
    if voice_prompt is None:
        voice_prompt = str(_DEFAULT_VOICE_PROMPT)
    elif voice_prompt == "":
        voice_prompt = None
    return Settings(
        tts_voice_prompt=voice_prompt,
        stt_model_size=os.getenv("NERU_STT_MODEL_SIZE", "large-v3"),
    )
