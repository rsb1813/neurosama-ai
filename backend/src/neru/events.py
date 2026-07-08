# 파이프라인에서 모듈 간에 오가는 이벤트/데이터 타입 정의
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class State(str, Enum):
    """대화 파이프라인의 현재 상태."""

    LISTENING = "listening"  # 사용자 발화 대기/청취
    THINKING = "thinking"  # LLM이 답변 생성 중
    SPEAKING = "speaking"  # TTS로 발화 중


@dataclass(frozen=True)
class SpeechStarted:
    """VAD가 사용자 발화 시작을 감지했음을 알리는 신호."""


@dataclass(frozen=True)
class Transcript:
    """STT 전사 결과. is_final=True면 한 발화가 완결된 것."""

    text: str
    is_final: bool = False


@dataclass(frozen=True)
class ReplyChunk:
    """LLM이 산출한 증분 답변 한 조각. 영어 발화 텍스트 + 대응 한국어 자막."""

    speech_en: str
    subtitle_ko: str


@dataclass(frozen=True)
class Shutdown:
    """오케스트레이터 소비 루프를 정상 종료시키는 sentinel 이벤트."""
