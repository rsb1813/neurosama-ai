# ChatterboxTTS provider를 실제 호출해 지연을 측정하고 스피커로 재생하는 수동 검증 프로브
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from neru.config import load_settings
from neru.tts.chatterbox_local import ChatterboxTTS


async def synth_once(tts: ChatterboxTTS, text: str, label: str) -> np.ndarray:
    t0 = time.time()
    first_t: float | None = None
    chunks: list[bytes] = []
    async for chunk in tts.synthesize(text):
        if first_t is None:
            first_t = time.time() - t0
        chunks.append(chunk)
    total = time.time() - t0
    audio = np.frombuffer(b"".join(chunks), dtype="<i2")
    dur = len(audio) / tts.sample_rate
    print(
        f"[{label}] first-chunk={first_t:.2f}s total={total:.2f}s "
        f"audio={dur:.2f}s rtf={total/dur:.2f} sr={tts.sample_rate}"
    )
    return audio


async def main() -> None:
    text = (
        sys.argv[1]
        if len(sys.argv) > 1
        else "Hi hi, my favorite human is finally here! What should we play today?"
    )
    voice = load_settings().tts_voice_prompt
    tts = ChatterboxTTS(device="cuda", audio_prompt_path=voice)
    print(f"[probe] voice_prompt={voice or '(default)'}")
    print("[probe] cold call includes model load...")
    await synth_once(tts, text, "cold")  # 모델 로드 포함
    audio = await synth_once(tts, text, "warm")  # 정상 상태 지연

    try:
        import sounddevice as sd

        print("[probe] playing on default output...")
        sd.play(audio, tts.sample_rate)
        sd.wait()
    except Exception as exc:  # 출력 장치 없거나 재생 실패해도 지연 측정은 유효
        print(f"[probe] playback skipped: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
