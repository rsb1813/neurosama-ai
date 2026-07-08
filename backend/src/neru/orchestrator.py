# 턴테이킹 상태머신 + barge-in(끼어들기)을 담당하는 파이프라인 오케스트레이터
from __future__ import annotations

import asyncio
import contextlib

from .avatar.base import AvatarDriver
from .events import Shutdown, SpeechStarted, State, Transcript
from .llm.base import LLMProvider
from .sink import OutputSink
from .stt.base import STTProvider
from .tts.base import TTSProvider


class Orchestrator:
    """STT→LLM→TTS→아바타를 연결하고 발화 타이밍과 끼어들기를 관리하는 중앙 조립부.

    각 provider는 인터페이스로만 의존하므로 자유롭게 교체 가능하다.
    """

    def __init__(
        self,
        stt: STTProvider,
        llm: LLMProvider,
        tts: TTSProvider,
        avatar: AvatarDriver,
        sink: OutputSink,
    ) -> None:
        self._stt = stt
        self._llm = llm
        self._tts = tts
        self._avatar = avatar
        self._sink = sink

        self._queue: asyncio.Queue = asyncio.Queue()
        self._response_task: asyncio.Task | None = None
        self._history: list[dict] = []
        self._state: State = State.LISTENING

    # STT를 거치지 않고 이벤트를 직접 주입(테스트/외부 트리거용)
    async def submit(self, event) -> None:
        await self._queue.put(event)

    async def run(self) -> None:
        """아바타 연결 → STT 시작 → 소비 루프. Shutdown 이벤트로 정상 종료한다."""
        await self._avatar.connect()
        stt_task = asyncio.create_task(self._stt.run(self._queue))
        try:
            await self._consume()
        finally:
            stt_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await stt_task
            await self._cancel_response()

    async def _consume(self) -> None:
        while True:
            event = await self._queue.get()
            if isinstance(event, Shutdown):
                # 정상 종료: 진행 중인 응답은 취소하지 않고 끝까지 마치게 둔다.
                await self._drain_response()
                return
            if isinstance(event, SpeechStarted):
                await self._on_speech_started()
            elif isinstance(event, Transcript) and event.is_final:
                await self._on_final_transcript(event.text)

    async def _on_speech_started(self) -> None:
        # 응답 중이면 끼어들기: 진행 중인 응답을 취소한다.
        await self._cancel_response()
        if self._state is not State.LISTENING:
            await self._set_state(State.LISTENING)

    async def _on_final_transcript(self, text: str) -> None:
        # 이전 응답이 아직 있으면 취소 후 새 응답 시작(직전 발화 우선).
        await self._cancel_response()
        self._response_task = asyncio.create_task(self._respond(text))

    async def _respond(self, user_text_ko: str) -> None:
        """한 번의 사용자 발화에 대한 응답 사이클. 취소되면 barge-in으로 간주해 정리한다."""
        speaking = False
        parts: list[str] = []
        try:
            await self._set_state(State.THINKING)
            async for chunk in self._llm.stream_reply(user_text_ko, self._history):
                if not speaking:
                    speaking = True
                    await self._avatar.start_speaking()
                    await self._set_state(State.SPEAKING)
                await self._sink.on_subtitle(chunk.subtitle_ko, chunk.speech_en)
                async for audio in self._tts.synthesize(chunk.speech_en):
                    await self._avatar.feed_audio(audio)
                parts.append(chunk.speech_en)
        except asyncio.CancelledError:
            # barge-in: 아바타 입을 닫고 청취 상태로 되돌린 뒤 취소를 재전파한다.
            await self._end_speech(speaking)
            raise
        # 정상 완료: 정리 후 대화 이력 갱신.
        await self._end_speech(speaking)
        self._history.append({"role": "user", "content": user_text_ko})
        self._history.append({"role": "assistant", "content": " ".join(parts)})

    async def _end_speech(self, speaking: bool) -> None:
        if speaking:
            await self._avatar.stop_speaking()
        await self._set_state(State.LISTENING)

    async def _drain_response(self) -> None:
        # 진행 중인 응답을 취소하지 않고 완료될 때까지 기다린다(정상 종료 경로).
        task = self._response_task
        if task is not None and not task.done():
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._response_task = None

    async def _cancel_response(self) -> None:
        task = self._response_task
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        self._response_task = None

    async def _set_state(self, state: State) -> None:
        self._state = state
        await self._sink.on_state(state)
