# VTubeStudioAvatar 검증 프로브 — 문장을 합성해 아바타로 재생하며 MouthOpen 구동(입 움직임)
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from neru.avatar.vtube_studio import VTubeStudioAvatar
from neru.config import load_settings
from neru.tts.chatterbox_local import ChatterboxTTS


async def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    text = args[0] if args else "Hi hi! I am neru. Watch my mouth move as I speak to you!"

    settings = load_settings()
    tts = ChatterboxTTS(audio_prompt_path=settings.tts_voice_prompt)
    print("[probe] synthesizing (first call loads model)...")
    chunks = [c async for c in tts.synthesize(text)]
    total = sum(len(c) for c in chunks)
    print(f"[probe] {total} bytes @ {tts.sample_rate}Hz ({total / 2 / tts.sample_rate:.2f}s)")

    avatar = VTubeStudioAvatar(sample_rate=tts.sample_rate)
    try:
        await avatar.connect()
        print("[probe] VTube Studio 연결·인증 완료 — 입이 움직입니다.")
    except Exception as exc:
        print(f"[probe] VTS 연결 실패({exc!r}) — 오디오 재생·입값만 검증(무-VTS).")

    async def monitor() -> None:  # 입값이 진폭을 따라가는지 확인
        while True:
            print(f"    mouth={avatar._mouth:.2f} amp={avatar._current_amp:.3f}")
            await asyncio.sleep(0.2)

    mon = asyncio.create_task(monitor())
    await avatar.start_speaking()
    for chunk in chunks:
        await avatar.feed_audio(chunk)
    while not await avatar.buffer_empty():  # 재생 완료까지 대기
        await asyncio.sleep(0.05)
    await asyncio.sleep(0.3)  # 마지막 블록 재생 여유
    mon.cancel()
    await avatar.stop_speaking()
    await avatar.close()
    print("[probe] done")


if __name__ == "__main__":
    asyncio.run(main())
