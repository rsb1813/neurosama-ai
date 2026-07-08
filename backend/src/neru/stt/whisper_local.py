# 로컬 Whisper(faster-whisper/CTranslate2) 기반 한국어 STT provider — 마이크를 VAD로 세그먼트해 전사
from __future__ import annotations

import asyncio
import os

import numpy as np

from ..events import SpeechStarted, Transcript
from .base import STTProvider

_SAMPLE_RATE = 16000  # Whisper·silero 공통 입력 샘플레이트
_VAD_FRAME = 512  # silero VAD가 요구하는 16kHz 고정 청크 크기(=32ms)


def _ensure_cuda_dll_path() -> None:
    # CTranslate2가 cuBLAS/cuDNN DLL을 찾도록 torch가 번들한 lib 디렉터리를 검색 경로에 추가.
    # (별도 nvidia-* 휠 없이 torch cu128의 CUDA 런타임을 그대로 재사용)
    import torch

    lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.isdir(lib):
        os.add_dll_directory(lib)
        os.environ["PATH"] = lib + os.pathsep + os.environ.get("PATH", "")


class WhisperLocalSTT(STTProvider):
    """faster-whisper로 한국어 마이크 입력을 전사하는 provider.

    - silero VAD로 발화 시작/끝을 감지: 시작 시 SpeechStarted(=barge-in 트리거),
      끝나면 버퍼를 faster-whisper로 전사해 Transcript(is_final=True) 발행.
    - 모델 로드·전사는 블로킹이라 `asyncio.to_thread`로 오프로드한다.
    - RTX 5080에서 CTranslate2 CUDA 백엔드 사용(torch/lib의 DLL 재사용).
    """

    def __init__(
        self,
        model_size: str = "large-v3",
        device: str = "cuda",
        compute_type: str = "float16",
        language: str = "ko",
        vad_threshold: float = 0.5,
        min_silence_ms: int = 500,
        device_index: int | None = None,
    ) -> None:
        self._model_size = model_size
        self._device = device
        self._compute_type = compute_type
        self._language = language
        self._vad_threshold = vad_threshold
        self._min_silence_ms = min_silence_ms
        self._device_index = device_index
        self._model = None
        self._silero = None
        self._vad_iterator_cls = None

    def _load(self) -> None:
        # 무거운 import·모델 로드는 첫 실행 시 1회.
        if self._model is None:
            _ensure_cuda_dll_path()
            from faster_whisper import WhisperModel
            from silero_vad import VADIterator, load_silero_vad

            self._model = WhisperModel(
                self._model_size, device=self._device, compute_type=self._compute_type
            )
            self._silero = load_silero_vad()
            self._vad_iterator_cls = VADIterator

    def _transcribe(self, audio: np.ndarray) -> str:
        # condition_on_previous_text=False: Whisper의 반복·환각 루프를 억제.
        segments, _ = self._model.transcribe(
            audio,
            language=self._language,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        return "".join(seg.text for seg in segments).strip()

    async def run(self, out: asyncio.Queue) -> None:
        import sounddevice as sd
        import torch

        loop = asyncio.get_running_loop()
        await asyncio.to_thread(self._load)
        vad = self._vad_iterator_cls(
            self._silero,
            threshold=self._vad_threshold,
            sampling_rate=_SAMPLE_RATE,
            min_silence_duration_ms=self._min_silence_ms,
        )

        # 오디오 콜백(별도 스레드)에서 asyncio 큐로 프레임 전달.
        frame_q: asyncio.Queue = asyncio.Queue()

        def _callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
            loop.call_soon_threadsafe(frame_q.put_nowait, indata[:, 0].copy())

        stream = sd.InputStream(
            samplerate=_SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=_VAD_FRAME,
            callback=_callback,
            device=self._device_index,
        )

        buffer: list[np.ndarray] = []
        speaking = False
        stream.start()
        try:
            while True:
                frame = await frame_q.get()
                if speaking:
                    buffer.append(frame)
                result = vad(torch.from_numpy(frame))
                if result is None:
                    continue
                if "start" in result:
                    speaking = True
                    buffer = [frame]
                    await out.put(SpeechStarted())
                elif "end" in result and speaking:
                    speaking = False
                    audio = np.concatenate(buffer)
                    buffer = []
                    text = await asyncio.to_thread(self._transcribe, audio)
                    if text:
                        await out.put(Transcript(text=text, is_final=True))
        finally:
            # 취소·정상 종료 모두에서 마이크 자원 정리.
            stream.stop()
            stream.close()
