# VTube Studio 아바타 드라이버 — pyvts로 MouthOpen을 직접 주입하며 오디오를 실시간 재생해 립싱크
from __future__ import annotations

import asyncio
import logging
import threading

import numpy as np

from .base import AvatarDriver

logger = logging.getLogger(__name__)


class VTubeStudioAvatar(AvatarDriver):
    """pyvts로 VTube Studio에 붙어 립싱크를 구동하는 드라이버.

    - VB-Cable 없이 직접 주입: 재생 중인 오디오의 진폭(RMS)을 VTS의 `MouthOpen`
      파라미터에 InjectParameterDataRequest로 주입한다.
    - 오디오를 sounddevice OutputStream으로 실시간 재생하며, 그 재생 속도가
      곧 입 움직임의 페이싱이 된다(진폭은 재생되는 블록에서 계산).
    - feed_audio는 PCM16 바이트를 재생 버퍼에 넣기만 하고, 출력 콜백(별도 스레드)이
      실시간으로 소비한다. 입 갱신은 asyncio 태스크가 주기적으로 진폭→MouthOpen 주입.

    최초 연결 시 VTS 창에 플러그인 허용 팝업이 뜨므로 사용자가 "허용"을 눌러야 한다.
    """

    def __init__(
        self,
        sample_rate: int = 24000,
        host: str = "localhost",
        port: int = 8001,
        token_path: str = "./pyvts_token.txt",
        param: str = "MouthOpen",
        gain: float = 6.0,  # RMS→MouthOpen 배율(실 모델 보며 미세조정)
        smoothing: float = 0.3,
        update_hz: float = 30.0,
    ) -> None:
        self._sample_rate = sample_rate
        self._host = host
        self._port = port
        self._token_path = token_path
        self._param = param
        self._gain = gain
        self._smoothing = smoothing
        self._update_interval = 1.0 / update_hz

        self._vts = None
        self._connected = False
        self._buffer = bytearray()  # 재생 대기 PCM16
        self._lock = threading.Lock()
        self._current_amp = 0.0  # 마지막으로 재생된 블록의 RMS(0..1)
        self._mouth = 0.0
        self._stream = None
        self._mouth_task: asyncio.Task | None = None

    async def connect(self) -> None:
        import pyvts

        self._vts = pyvts.vts(
            plugin_info={
                "plugin_name": "neru",
                "developer": "neru",
                "plugin_icon": None,
                "authentication_token_path": self._token_path,
            },
            vts_api_info={
                "version": "1.0",
                "name": "VTubeStudioPublicAPI",
                "host": self._host,
                "port": self._port,
            },
        )
        await self._vts.connect()
        # 최초 실행 시 토큰 발급(사용자가 VTS에서 허용) → 이후엔 저장된 토큰 재사용.
        await self._vts.request_authenticate_token()
        await self._vts.request_authenticate()
        self._connected = True
        logger.info("VTube Studio 연결·인증 완료")

    async def start_speaking(self) -> None:
        import sounddevice as sd

        self._mouth = 0.0
        with self._lock:
            self._buffer.clear()
        # 아바타가 오디오 재생을 소유한다(진폭이 재생 콜백에서 나오므로 재생과 립싱크는 분리 불가).
        self._stream = sd.OutputStream(
            samplerate=self._sample_rate,
            channels=1,
            dtype="int16",
            blocksize=0,
            callback=self._output_callback,
        )
        self._stream.start()
        self._mouth_task = asyncio.create_task(self._drive_mouth())

    def _output_callback(self, outdata, frames, time_info, status) -> None:  # noqa: ANN001
        need = frames * 2  # int16 = 2바이트/샘플
        with self._lock:
            take = bytes(self._buffer[:need])
            del self._buffer[:need]
        samples = np.frombuffer(take, dtype="<i2")
        if len(samples) < frames:  # 버퍼 부족분은 무음 패딩
            samples = np.concatenate([samples, np.zeros(frames - len(samples), dtype="<i2")])
        outdata[:, 0] = samples
        # 재생 중인 블록의 진폭(0..1). 입 갱신 태스크가 읽는다.
        if take:
            f = samples.astype(np.float32) / 32768.0
            self._current_amp = float(np.sqrt(np.mean(f * f)))
        else:
            self._current_amp = 0.0

    async def feed_audio(self, chunk: bytes) -> None:
        with self._lock:
            self._buffer.extend(chunk)

    async def _drive_mouth(self) -> None:
        while True:
            target = min(1.0, self._current_amp * self._gain)
            self._mouth = self._smoothing * self._mouth + (1 - self._smoothing) * target
            await self._set_param(self._mouth)
            await asyncio.sleep(self._update_interval)

    async def _set_param(self, value: float) -> None:
        if not self._connected:
            return
        request = self._vts.vts_request.requestSetParameterValue(
            self._param, float(value), mode="set"
        )
        await self._vts.request(request)

    async def buffer_empty(self) -> bool:
        with self._lock:
            return len(self._buffer) == 0

    async def stop_speaking(self) -> None:
        if self._mouth_task is not None:
            self._mouth_task.cancel()
            try:
                await self._mouth_task
            except asyncio.CancelledError:
                pass
            self._mouth_task = None
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        with self._lock:
            self._buffer.clear()
        self._current_amp = 0.0
        await self._set_param(0.0)  # 입 닫기

    async def close(self) -> None:
        # 연결 전 실패한 경우 websocket이 없으므로(자체 close가 크래시) 존재할 때만 닫는다.
        if self._vts is not None and getattr(self._vts, "websocket", None) is not None:
            await self._vts.close()
        self._vts = None
        self._connected = False
