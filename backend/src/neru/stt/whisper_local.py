# 로컬 Whisper(faster-whisper/CTranslate2) 기반 한국어 STT provider — 마이크를 VAD로 세그먼트해 전사
from __future__ import annotations

import asyncio
import collections
import logging
import os

import numpy as np

from ..events import Shutdown, SpeechStarted, Transcript
from .base import STTProvider

logger = logging.getLogger(__name__)

_SAMPLE_RATE = 16000  # Whisper·silero 공통 입력 샘플레이트
_VAD_FRAME = 512  # silero VAD가 요구하는 16kHz 고정 청크 크기(=32ms)
_PREROLL_FRAMES = 8  # 발화 시작 직전 ~256ms를 pre-roll로 유지(speech_pad·트리거 지연 보완)

# 세그먼터가 "발화 시작"을 알리는 sentinel(전사 대상 오디오와 구분).
_STARTED = object()


def _ensure_cuda_dll_path() -> None:
    # CTranslate2가 cuBLAS/cuDNN DLL을 찾도록 torch가 번들한 lib 디렉터리를 검색 경로에 추가.
    # (별도 nvidia-* 휠 없이 torch cu128의 CUDA 런타임을 그대로 재사용)
    import torch

    lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.isdir(lib):
        os.add_dll_directory(lib)
        os.environ["PATH"] = lib + os.pathsep + os.environ.get("PATH", "")


class _VadSegmenter:
    """silero VADIterator를 감싼 프레임 단위 발화 세그먼터.

    step(frame)은 발화 시작 시 `_STARTED`, 발화 완결 시 float32 오디오(np.ndarray),
    그 외에는 None을 반환한다. 발화 시작 직전 프레임들을 pre-roll로 붙여 첫 음소가
    잘리지 않게 한다(silero가 보고하는 start 지점은 트리거 프레임보다 앞선다).

    run()과 검증 프로브가 같은 인스턴스 로직을 구동하도록 여기 한 곳에만 둔다.
    """

    def __init__(self, silero, vad_iterator_cls, threshold: float, min_silence_ms: int) -> None:
        self._vad = vad_iterator_cls(
            silero,
            threshold=threshold,
            sampling_rate=_SAMPLE_RATE,
            min_silence_duration_ms=min_silence_ms,
        )
        self._speaking = False
        self._buffer: list[np.ndarray] = []
        self._preroll: collections.deque[np.ndarray] = collections.deque(maxlen=_PREROLL_FRAMES)

    def step(self, frame: np.ndarray):
        import torch

        if self._speaking:
            self._buffer.append(frame)
        else:
            self._preroll.append(frame)
        # silero 추론은 프레임당 ~1ms로 짧아 호출 스레드에서 동기 실행(별도 오프로드는 오히려 손해).
        result = self._vad(torch.from_numpy(frame))
        if result is None:
            return None
        if "start" in result:
            self._speaking = True
            self._buffer = list(self._preroll)  # pre-roll(트리거 프레임 포함)로 버퍼 시작
            return _STARTED
        if "end" in result and self._speaking:
            self._speaking = False
            audio = np.concatenate(self._buffer)
            self._buffer = []
            return audio
        return None

    def flush(self) -> np.ndarray | None:
        # 파일 끝 등으로 end 없이 발화가 이어진 경우 남은 버퍼를 회수.
        if self._speaking and self._buffer:
            audio = np.concatenate(self._buffer)
            self._speaking = False
            self._buffer = []
            return audio
        return None


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
        device: str = "cuda",  # 단일 RTX 5080 대상 — device는 CUDA 고정
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

    def _ensure_model(self) -> None:
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

    def _make_segmenter(self) -> _VadSegmenter:
        return _VadSegmenter(
            self._silero, self._vad_iterator_cls, self._vad_threshold, self._min_silence_ms
        )

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

        loop = asyncio.get_running_loop()

        # 오디오 콜백(별도 스레드)에서 asyncio 큐로 프레임 전달.
        frame_q: asyncio.Queue = asyncio.Queue()

        def _callback(indata, frames, time_info, status) -> None:  # noqa: ANN001
            loop.call_soon_threadsafe(frame_q.put_nowait, indata[:, 0].copy())

        try:
            await asyncio.to_thread(self._ensure_model)
            segmenter = self._make_segmenter()
            stream = sd.InputStream(
                samplerate=_SAMPLE_RATE,
                channels=1,
                dtype="float32",
                blocksize=_VAD_FRAME,
                callback=_callback,
                device=self._device_index,
            )
            stream.start()
        except Exception:
            # 시작 실패(CUDA·DLL·마이크 없음 등) 시 오케스트레이터 소비 루프가 큐에서
            # 무한 대기하지 않도록 Shutdown을 발행한 뒤 예외를 전파한다.
            logger.exception("STT 시작 실패")
            await out.put(Shutdown())
            raise

        try:
            while True:
                frame = await frame_q.get()
                result = segmenter.step(frame)
                if result is None:
                    continue
                if result is _STARTED:
                    await out.put(SpeechStarted())
                else:
                    text = await asyncio.to_thread(self._transcribe, result)
                    if text:
                        await out.put(Transcript(text=text, is_final=True))
        finally:
            # 취소·정상 종료 모두에서 마이크 자원 정리(동기 호출이라 재취소에 안전).
            stream.stop()
            stream.close()
