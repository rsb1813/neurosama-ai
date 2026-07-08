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
