# 오케스트레이터의 정상 응답 경로와 barge-in(끼어들기) 동작 검증
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from neru.avatar.logging_avatar import LoggingAvatar
from neru.events import ReplyChunk, Shutdown, SpeechStarted, State, Transcript
from neru.llm.base import LLMProvider
from neru.llm.echo import EchoLLM
from neru.orchestrator import Orchestrator
from neru.stt.scripted import ScriptedSTT
from neru.tts.base import TTSProvider
from neru.tts.silent import SilentTTS


class RecorderSink:
    """상태 변화와 자막을 기록하는 테스트용 싱크."""

    def __init__(self) -> None:
        self.states: list[State] = []
        self.subtitles: list[tuple[str, str]] = []

    async def on_state(self, state: State) -> None:
        self.states.append(state)

    async def on_subtitle(self, subtitle_ko: str, speech_en: str) -> None:
        self.subtitles.append((subtitle_ko, speech_en))


class GatedLLM(LLMProvider):
    """첫 청크를 내보낸 뒤 gate에서 멈추는 LLM(끼어들기 타이밍을 결정적으로 만들기 위함)."""

    def __init__(self) -> None:
        self.first_yielded = asyncio.Event()
        self.gate = asyncio.Event()  # 테스트에서 set하지 않아 취소될 때까지 대기

    async def stream_reply(
        self, user_text_ko: str, history: list[dict]
    ) -> AsyncIterator[ReplyChunk]:
        yield ReplyChunk(speech_en="Hello there.", subtitle_ko="안녕하세요.")
        self.first_yielded.set()
        await self.gate.wait()
        yield ReplyChunk(speech_en="unreached", subtitle_ko="도달안함")


async def test_happy_path_full_response():
    avatar = LoggingAvatar()
    sink = RecorderSink()
    orch = Orchestrator(
        stt=ScriptedSTT([Transcript("안녕 neru", is_final=True), Shutdown()]),
        llm=EchoLLM(),
        tts=SilentTTS(),
        avatar=avatar,
        sink=sink,
    )

    await asyncio.wait_for(orch.run(), timeout=2.0)

    # 상태 전이: THINKING → SPEAKING → LISTENING
    assert sink.states == [State.THINKING, State.SPEAKING, State.LISTENING]
    # EchoLLM은 두 청크를 내보낸다.
    assert len(sink.subtitles) == 2
    assert sink.subtitles[0][0] == "네가 말했어: 안녕 neru."
    # 아바타 제어 순서
    assert avatar.calls == ["connect", "start_speaking", "stop_speaking"]
    # 대화 이력이 사용자+어시스턴트로 갱신됨
    assert orch._history == [
        {"role": "user", "content": "안녕 neru"},
        {"role": "assistant", "content": "You said: 안녕 neru. That's interesting!"},
    ]


async def test_barge_in_cancels_response_mid_speech():
    avatar = LoggingAvatar()
    sink = RecorderSink()
    llm = GatedLLM()
    orch = Orchestrator(
        stt=ScriptedSTT([]),  # 유휴 STT — 이벤트는 submit으로 직접 주입
        llm=llm,
        tts=SilentTTS(),
        avatar=avatar,
        sink=sink,
    )

    run_task = asyncio.create_task(orch.run())

    # 사용자 발화 → 응답 시작, 첫 청크 발화(SPEAKING)까지 진행 후 gate에서 대기
    await orch.submit(Transcript("게임 추천해줘", is_final=True))
    await asyncio.wait_for(llm.first_yielded.wait(), timeout=2.0)

    # 발화 도중 사용자가 끼어듦 → 응답 취소되어야 함
    await orch.submit(SpeechStarted())
    await orch.submit(Shutdown())
    await asyncio.wait_for(run_task, timeout=2.0)

    # 말하기 시작했다가 끼어들기로 중단됨
    assert "start_speaking" in avatar.calls
    assert "stop_speaking" in avatar.calls
    # 첫 자막만 나가고 두 번째(gate 이후)는 나가지 않음
    assert sink.subtitles == [("안녕하세요.", "Hello there.")]
    # 마지막 상태는 청취로 복귀
    assert sink.states[-1] == State.LISTENING
    # 응답이 완결되지 않았으므로 이력은 비어 있음
    assert orch._history == []


class FlakyTTS(TTSProvider):
    """첫 호출에서만 예외를 던지고 이후엔 정상 동작하는 TTS(오류 복구 검증용)."""

    def __init__(self) -> None:
        self.count = 0

    async def synthesize(self, text_en: str) -> AsyncIterator[bytes]:
        self.count += 1
        if self.count == 1:
            raise ConnectionError("tts down")
        for word in text_en.split():
            yield word.encode("utf-8")


async def _drive_turn(orch: Orchestrator, text: str) -> None:
    """한 발화를 주입하고 그 응답 태스크가 끝날 때까지 결정적으로 기다린다."""
    prev = orch._response_task
    await orch.submit(Transcript(text, is_final=True))
    task = None
    for _ in range(1000):
        task = orch._response_task
        if task is not None and task is not prev:
            break
        await asyncio.sleep(0)
    else:
        raise AssertionError("응답 태스크가 생성되지 않음")
    await task


class StopRaisingAvatar(LoggingAvatar):
    """stop_speaking에서 예외를 던지는 아바타(정리 중 오류 상황 재현)."""

    async def stop_speaking(self) -> None:
        self.calls.append("stop_speaking")
        raise RuntimeError("avatar cable unplugged")


async def test_provider_error_recovers_and_pipeline_continues():
    avatar = LoggingAvatar()
    sink = RecorderSink()
    tts = FlakyTTS()
    orch = Orchestrator(
        stt=ScriptedSTT([]),  # 유휴 STT — 턴을 직접 직렬로 주입
        llm=EchoLLM(),
        tts=tts,
        avatar=avatar,
        sink=sink,
    )
    run_task = asyncio.create_task(orch.run())

    await _drive_turn(orch, "첫 발화")  # 턴1: TTS 오류 → 정리 후 청취 복귀
    await _drive_turn(orch, "둘째 발화")  # 턴2: 정상 완료

    await orch.submit(Shutdown())
    await asyncio.wait_for(run_task, timeout=2.0)

    # 턴1: SPEAKING 진입 후 오류로 stop / 턴2: 정상 start~stop → run은 크래시 없이 지속
    assert avatar.calls == [
        "connect",
        "start_speaking",
        "stop_speaking",
        "start_speaking",
        "stop_speaking",
    ]
    # 턴1은 오류로 이력 없음, 턴2만 커밋됨
    assert orch._history == [
        {"role": "user", "content": "둘째 발화"},
        {"role": "assistant", "content": "You said: 둘째 발화. That's interesting!"},
    ]
    assert sink.states[-1] == State.LISTENING


async def test_cleanup_error_during_barge_in_does_not_crash():
    avatar = StopRaisingAvatar()
    sink = RecorderSink()
    llm = GatedLLM()
    orch = Orchestrator(
        stt=ScriptedSTT([]),
        llm=llm,
        tts=SilentTTS(),
        avatar=avatar,
        sink=sink,
    )

    run_task = asyncio.create_task(orch.run())
    await orch.submit(Transcript("발화", is_final=True))
    await asyncio.wait_for(llm.first_yielded.wait(), timeout=2.0)

    # 발화 중 끼어들기 → 정리(stop_speaking)에서 예외가 나도 run()은 살아 있어야 한다.
    await orch.submit(SpeechStarted())
    await orch.submit(Shutdown())
    await asyncio.wait_for(run_task, timeout=2.0)

    assert "stop_speaking" in avatar.calls
    # 정리 예외에도 불구하고 최종 상태는 청취로 복귀(안전망)
    assert sink.states[-1] == State.LISTENING
