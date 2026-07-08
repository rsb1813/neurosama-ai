# WhisperLocalSTT를 검증하는 프로브 — 파일(오프라인) 또는 마이크(라이브)로 한국어 전사 로그
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from neru.events import SpeechStarted, Transcript
from neru.stt.whisper_local import _SAMPLE_RATE, _VAD_FRAME, WhisperLocalSTT


def _run_file(path: str, model_size: str) -> None:
    # 마이크 없이 wav를 VAD로 세그먼트해 전사 — 로직 결정적 검증.
    import soundfile as sf
    import torch

    stt = WhisperLocalSTT(model_size=model_size)
    stt._load()
    vad = stt._vad_iterator_cls(
        stt._silero, threshold=0.5, sampling_rate=_SAMPLE_RATE, min_silence_duration_ms=500
    )
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio[:, 0]
    if sr != _SAMPLE_RATE:  # 16kHz로 간단 리샘플
        idx = (np.arange(int(len(audio) * _SAMPLE_RATE / sr)) * sr / _SAMPLE_RATE).astype(int)
        audio = audio[idx]

    buffer: list[np.ndarray] = []
    speaking = False
    n_utt = 0
    for i in range(0, len(audio) - _VAD_FRAME, _VAD_FRAME):
        frame = audio[i : i + _VAD_FRAME]
        if speaking:
            buffer.append(frame)
        result = vad(torch.from_numpy(frame))
        if result is None:
            continue
        if "start" in result:
            speaking = True
            buffer = [frame]
            print("  <SpeechStarted>")
        elif "end" in result and speaking:
            speaking = False
            text = stt._transcribe(np.concatenate(buffer))
            n_utt += 1
            print(f"  KO[{n_utt}]: {text}")
    if speaking and buffer:  # 파일 끝까지 발화가 이어진 경우
        print(f"  KO[{n_utt + 1}]: {stt._transcribe(np.concatenate(buffer))}")
    print(f"[probe] done — {n_utt} utterance(s) segmented")


async def _run_mic(model_size: str, seconds: float, device_index: int | None) -> None:
    stt = WhisperLocalSTT(model_size=model_size, device_index=device_index)
    q: asyncio.Queue = asyncio.Queue()
    stt_task = asyncio.create_task(stt.run(q))
    print(f"[probe] mic STT running (model={model_size}). 한국어로 말하세요.")

    async def consume() -> None:
        while True:
            ev = await q.get()
            if isinstance(ev, SpeechStarted):
                print("  <SpeechStarted>")
            elif isinstance(ev, Transcript):
                print(f"  KO: {ev.text}")

    cons = asyncio.create_task(consume())
    try:
        await asyncio.sleep(seconds) if seconds > 0 else await stt_task
    finally:
        for t in (stt_task, cons):
            t.cancel()
        await asyncio.gather(stt_task, cons, return_exceptions=True)


def main() -> None:
    from neru.config import load_settings

    settings = load_settings()
    args = sys.argv[1:]
    model_size = args[args.index("--model") + 1] if "--model" in args else settings.stt_model_size
    if "--file" in args:
        _run_file(args[args.index("--file") + 1], model_size)
    else:
        seconds = float(args[args.index("--seconds") + 1]) if "--seconds" in args else 0
        device = (
            int(args[args.index("--device") + 1])
            if "--device" in args
            else settings.stt_device_index
        )
        asyncio.run(_run_mic(model_size, seconds, device))


if __name__ == "__main__":
    main()
