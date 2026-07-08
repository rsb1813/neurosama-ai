# Claude(로컬 Anthropic 형식 프록시) 기반 LLM provider — 영어 발화 + 한국어 자막을 스트리밍
from __future__ import annotations

from collections.abc import AsyncIterator

from anthropic import AsyncAnthropic

from ..config import Settings
from ..events import ReplyChunk
from ..persona import NERU_SYSTEM_PROMPT
from .base import LLMProvider


class ClaudeLLM(LLMProvider):
    """localhost 프록시의 Claude로 neru 답변을 스트리밍 생성하는 provider.

    페르소나가 문장마다 `EN: ...` / `KO: ...` 두 줄을 내보내도록 지시되어 있고,
    이 클래스는 스트림을 줄 단위로 파싱해 완성된 EN/KO 쌍마다 ReplyChunk를 흘려보낸다.
    첫 문장이 완성되는 즉시 방출하므로 TTS로 조기 전달할 수 있다.
    """

    def __init__(self, settings: Settings, max_tokens: int = 1024) -> None:
        self._model = settings.llm_model
        self._max_tokens = max_tokens
        # base_url을 로컬 프록시로 덮어씀. 프록시는 키를 검사하지 않지만 SDK 생성엔 필요.
        self._client = AsyncAnthropic(
            base_url=settings.llm_base_url,
            api_key=settings.llm_api_key,
        )

    async def stream_reply(
        self, user_text_ko: str, history: list[dict]
    ) -> AsyncIterator[ReplyChunk]:
        messages = [*history, {"role": "user", "content": user_text_ko}]
        pending_en: str | None = None
        buffer = ""
        # 저지연 대화라 thinking은 생략(생략 시 opus는 사고 없이 즉답).
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=self._max_tokens,
            system=NERU_SYSTEM_PROMPT,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                buffer += text
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    chunk, pending_en = self._consume_line(line, pending_en)
                    if chunk is not None:
                        yield chunk
        # 스트림 종료 후 개행 없이 남은 마지막 줄 처리
        chunk, pending_en = self._consume_line(buffer, pending_en)
        if chunk is not None:
            yield chunk

    @staticmethod
    def _consume_line(
        line: str, pending_en: str | None
    ) -> tuple[ReplyChunk | None, str | None]:
        """한 줄을 파싱한다. EN이면 보류, KO면 보류된 EN과 쌍지어 ReplyChunk를 만든다.

        반환: (완성된 ReplyChunk 또는 None, 갱신된 pending_en).
        """
        line = line.strip()
        if line.startswith("EN:"):
            return None, line[3:].strip()
        if line.startswith("KO:") and pending_en is not None:
            return ReplyChunk(speech_en=pending_en, subtitle_ko=line[3:].strip()), None
        # 형식 밖 줄(빈 줄 등)은 무시하고 상태 유지
        return None, pending_en
