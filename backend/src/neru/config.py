# 환경변수 기반 런타임 설정 (LLM 프록시 주소·모델·키). .env가 있으면 로드한다.
from __future__ import annotations

import os
from dataclasses import dataclass

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


def load_settings() -> Settings:
    """환경변수에서 설정을 읽어 Settings를 만든다.

    - NEURU_LLM_BASE_URL: 로컬 Anthropic 형식 프록시 주소 (기본 localhost:3456).
    - ANTHROPIC_API_KEY: 프록시는 검사하지 않지만 SDK 생성에 필요 → 더미 허용.
    - NEURU_LLM_MODEL: 프록시가 서빙하는 모델 ID. 현재 프록시는 opus-4-7/4-6,
      sonnet-4-6, haiku-4-5를 서빙(opus-4-8 없음) → 최고 성능인 opus-4-7 기본.
    """
    return Settings(
        llm_base_url=os.getenv("NEURU_LLM_BASE_URL", "http://localhost:3456"),
        llm_api_key=os.getenv("ANTHROPIC_API_KEY", "sk-local-proxy"),
        llm_model=os.getenv("NEURU_LLM_MODEL", "claude-opus-4-7"),
    )
