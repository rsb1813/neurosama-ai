# 환경변수 기반 런타임 설정 (LLM 프록시 주소·모델·키). .env가 있으면 로드한다.
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# 기본 클로닝 음성(Neuro-sama 레퍼런스) 절대 경로. config.py 기준 assets/voices/.
_DEFAULT_VOICE_PROMPT = (
    Path(__file__).resolve().parents[2] / "assets" / "voices" / "neuro_ref.wav"
)

try:  # python-dotenv는 선택적 — 없으면 실제 환경변수만 사용
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover - dotenv 미설치 환경 대비
    pass


@dataclass(frozen=True)
class Settings:
    """파이프라인 실행에 필요한 설정 값 묶음."""

    llm_base_url: str
    llm_api_key: str
    llm_model: str
    # TTS 클로닝 대상 음성 샘플 경로. None이면 Chatterbox 기본 음성.
    tts_voice_prompt: str | None
    # STT faster-whisper 모델 크기.
    stt_model_size: str
    # 마이크 입력 장치 인덱스. None이면 시스템 기본 입력.
    stt_device_index: int | None


def load_settings() -> Settings:
    """환경변수에서 설정을 읽어 Settings를 만든다.

    - NEURU_LLM_BASE_URL: 로컬 Anthropic 형식 프록시 주소 (기본 localhost:3456).
    - ANTHROPIC_API_KEY: 프록시는 검사하지 않지만 SDK 생성에 필요 → 더미 허용.
    - NEURU_LLM_MODEL: 프록시가 서빙하는 모델 ID. 현재 프록시는 opus-4-7/4-6,
      sonnet-4-6, haiku-4-5를 서빙(opus-4-8 없음) → 최고 성능인 opus-4-7 기본.
    - NEURU_TTS_VOICE_PROMPT: 클로닝 대상 음성 wav 경로. 기본은 번들된 Neuro-sama
      레퍼런스. 빈 문자열이면 클로닝 없이 Chatterbox 기본 음성 사용.
    - NEURU_STT_MODEL_SIZE: faster-whisper 모델 크기(기본 large-v3).
    - NEURU_STT_DEVICE_INDEX: 마이크 장치 인덱스(미설정 시 기본 입력).
    """
    voice_prompt = os.getenv("NEURU_TTS_VOICE_PROMPT")
    if voice_prompt is None:
        voice_prompt = str(_DEFAULT_VOICE_PROMPT)
    elif voice_prompt == "":
        voice_prompt = None  # 명시적 빈 값 = 기본 음성
    mic_env = os.getenv("NEURU_STT_DEVICE_INDEX")
    return Settings(
        llm_base_url=os.getenv("NEURU_LLM_BASE_URL", "http://localhost:3456"),
        llm_api_key=os.getenv("ANTHROPIC_API_KEY", "sk-local-proxy"),
        llm_model=os.getenv("NEURU_LLM_MODEL", "claude-opus-4-7"),
        tts_voice_prompt=voice_prompt,
        stt_model_size=os.getenv("NEURU_STT_MODEL_SIZE", "large-v3"),
        stt_device_index=int(mic_env) if mic_env else None,
    )
