# 로컬 프록시로 ClaudeLLM을 실제 호출해 EN/KO 스트리밍이 나오는지 수동 검증하는 프로브
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# src 레이아웃을 import 경로에 추가(스크립트 단독 실행용)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from neru.config import load_settings
from neru.llm.claude import ClaudeLLM


async def main() -> None:
    settings = load_settings()
    print(f"[probe] model={settings.llm_model} base_url={settings.llm_base_url}")
    llm = ClaudeLLM(settings)
    user_ko = sys.argv[1] if len(sys.argv) > 1 else "안녕 neru, 오늘 뭐 하고 놀까?"
    print(f"[probe] user(ko): {user_ko}\n")

    count = 0
    async for chunk in llm.stream_reply(user_ko, history=[]):
        count += 1
        print(f"  EN: {chunk.speech_en}")
        print(f"  KO: {chunk.subtitle_ko}")
    print(f"\n[probe] {count} ReplyChunk(s) received.")


if __name__ == "__main__":
    asyncio.run(main())
