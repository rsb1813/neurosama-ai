# LLM provider 추상 인터페이스 — 한국어 입력을 받아 영어답변+한국어자막을 스트리밍
from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator

from ..events import ReplyChunk


class LLMProvider(ABC):
    """사용자의 한국어 발화에 대해 neru의 답변을 스트리밍 생성하는 provider.

    답변은 (영어 발화, 한국어 자막) 쌍인 ReplyChunk 단위로 흘러나온다.
    구현체는 Claude API, 로컬 모델 등으로 교체 가능하다.
    """

    @abstractmethod
    def stream_reply(
        self, user_text_ko: str, history: list[dict]
    ) -> AsyncIterator[ReplyChunk]:
        """user_text_ko(한국어)에 대한 답변을 ReplyChunk 단위로 비동기 스트리밍한다.

        history는 [{"role": "user"|"assistant", "content": str}, ...] 형태의 대화 이력.
        구현체는 async generator로 작성한다.
        """
