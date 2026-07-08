# 턴테이킹 상태머신 + barge-in(끼어들기)을 담당하는 파이프라인 오케스트레이터
from __future__ import annotations

import asyncio
import logging

from .avatar.base import AvatarDriver
from .events import Event, Shutdown, SpeechStarted, State, Transcript
from .llm.base import LLMProvider
from .sink import OutputSink
from .stt.base import STTProvider
from .tts.base import TTSProvider

logger = logging.getLogger(__name__)


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

        self._queue: asyncio.Queue[Event] = asyncio.Queue()
        self._response_task: asyncio.Task | None = None
        self._history: list[dict] = []
        self._state: State = State.LISTENING

    # STT를 거치지 않고 이벤트를 직접 주입(테스트/외부 트리거용)
    async def submit(self, event: Event) -> None:
        await self._queue.put(event)

    async def run(self) -> None:
        """아바타 연결 → STT 시작 → 소비 루프. Shutdown 이벤트로 정상 종료한다."""
        await self._avatar.connect()
        stt_task = asyncio.create_task(self._stt.run(self._queue))
        try:
            await self._consume()
        finally:
            if not stt_task.done():
                await self._cancel_task(stt_task)
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
        """한 번의 사용자 발화에 대한 응답 사이클.

        - 취소되면 barge-in으로 간주해 정리 후 취소를 재전파한다.
        - provider 오류 등 그 외 예외는 로깅·정리하고 이번 발화만 버린 뒤 파이프라인을 유지한다.
        """
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
            # barge-in: 예외 안전하게 정리한 뒤 취소를 재전파한다.
            await self._safe_end_speech(speaking)
            raise
        except Exception:
            # provider 오류(네트워크/타임아웃/인증 등): 로깅 후 이번 발화만 버리고 파이프라인 유지.
            logger.exception("응답 처리 중 오류 — 이번 발화를 건너뜁니다")
            await self._safe_end_speech(speaking)
            return
        # 정상 완료: 정리 후 대화 이력 갱신.
        await self._safe_end_speech(speaking)
        self._history.append({"role": "user", "content": user_text_ko})
        self._history.append({"role": "assistant", "content": " ".join(parts)})

    async def _end_speech(self, speaking: bool) -> None:
        if speaking:
            await self._avatar.stop_speaking()
        await self._set_state(State.LISTENING)

    async def _safe_end_speech(self, speaking: bool) -> None:
        # 정리 중 오류가 barge-in의 CancelledError를 가리거나 파이프라인을 무너뜨리지 않도록 방어.
        try:
            await self._end_speech(speaking)
        except Exception:
            logger.exception("발화 종료 정리 중 오류")

    async def _drain_response(self) -> None:
        # 정상 종료 경로: 진행 중 응답을 취소하지 않고 완료를 기다린다.
        # run()이 외부에서 취소되면 그 취소는 여기서 전파되어야 하므로 CancelledError를 삼키지 않는다.
        task = self._response_task
        if task is not None and not task.done():
            await task
        self._response_task = None

    async def _cancel_response(self) -> None:
        task = self._response_task
        if task is not None and not task.done():
            await self._cancel_task(task)
        self._response_task = None

    @staticmethod
    async def _cancel_task(task: asyncio.Task) -> None:
        # 대상 task를 취소하고 그 CancelledError만 삼킨다.
        # 단, 현재(부모) task 자신이 취소된 경우엔 그 취소를 보존해 재전파한다.
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current is not None and current.cancelling() > 0:
                raise
        except Exception:
            # 자식이 취소 외 예외로 종료된 경우는 무시(원인 로깅은 자식에서 처리).
            pass

    async def _set_state(self, state: State) -> None:
        self._state = state
        await self._sink.on_state(state)
