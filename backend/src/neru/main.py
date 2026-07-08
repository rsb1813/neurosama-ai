# 엔트리포인트: mock provider들을 조립해 파이프라인이 한 바퀴 도는 것을 보여주는 데모
from __future__ import annotations

import asyncio

from .avatar.logging_avatar import LoggingAvatar
from .events import Shutdown, SpeechStarted, Transcript
from .llm.echo import EchoLLM
from .orchestrator import Orchestrator
from .sinks_console import ConsoleSink
from .stt.scripted import ScriptedSTT
from .tts.silent import SilentTTS


async def demo() -> None:
    # 시나리오: 인사 → 응답 / 두 번째 발화 중 끼어들기 → 세 번째 발화 → 종료.
    script = [
        Transcript("안녕 neru, 오늘 뭐해?", is_final=True),
        Transcript("게임 하나 추천해줄래?", is_final=True),
        SpeechStarted(),  # 응답 도중 사용자가 끼어듦(barge-in)
        Transcript("역시 됐어, 그냥 얘기하자.", is_final=True),
        Shutdown(),
    ]

    orchestrator = Orchestrator(
        stt=ScriptedSTT(script, gap=0.3),
        llm=EchoLLM(chunk_delay=0.15),
        tts=SilentTTS(),
        avatar=LoggingAvatar(),
        sink=ConsoleSink(),
    )
    await orchestrator.run()
    print("[demo] 파이프라인 정상 종료")


def main() -> None:
    asyncio.run(demo())


if __name__ == "__main__":
    main()
