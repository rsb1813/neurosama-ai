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
    # STT(faster-whisper) 활성 여부. 음성 입력이 프로젝트 차원에서 보류 중이라 기본 False —
    # 이러면 /v1/audio/transcriptions가 503을 돌려주고 whisper large-v3(~3GB VRAM)를 아예
    # 로드하지 않는다. 음성 작업 재개 시 NERU_STT_ENABLED=true 로 되살린다.
    stt_enabled: bool
    # /v1/* 요청에 요구하는 Bearer 토큰. 기본값은 neruPreseed.ts가 심는 더미 apiKey와 동일 —
    # 다른 값을 쓰려면 두 곳(NERU_API_KEY, stage-tamagotchi 프리시드) 모두 맞춰야 한다.
    api_key: str


def load_settings() -> Settings:
    # NERU_TTS_VOICE_PROMPT: 빈 문자열이면 기본 음성, 미설정이면 번들 Neuro 레퍼런스.
    voice_prompt = os.getenv("NERU_TTS_VOICE_PROMPT")
    if voice_prompt is None:
        voice_prompt = str(_DEFAULT_VOICE_PROMPT)
    elif voice_prompt == "":
        voice_prompt = None
    # NERU_STT_ENABLED: 미설정/거짓이면 STT 비활성(whisper 미로드). 보류 중이라 기본 off.
    stt_enabled = os.getenv("NERU_STT_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")
    return Settings(
        tts_voice_prompt=voice_prompt,
        stt_model_size=os.getenv("NERU_STT_MODEL_SIZE", "large-v3"),
        stt_enabled=stt_enabled,
        api_key=os.getenv("NERU_API_KEY", "sk-local-proxy"),
    )
