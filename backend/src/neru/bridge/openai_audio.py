# AIRI 연동용 OpenAI 호환 오디오 게이트웨이 — 로컬 Chatterbox TTS·faster-whisper STT를 HTTP로 노출
from __future__ import annotations

import asyncio
import io
import logging
import wave

from fastapi import FastAPI, Form, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from ..config import load_settings
from ..gpu import ensure_cuda_dll_path, transcribe
from ..tts.chatterbox_local import ChatterboxTTS

logger = logging.getLogger(__name__)

# AIRI provider가 baseUrl=http://localhost:3457/v1 로 STT/TTS를 함께 호출한다.
# OpenAI Audio API 형식만 맞추면 AIRI 코드 수정 없이 붙는다:
#   POST /v1/audio/speech          (TTS)  — 우리 Chatterbox(Neuro 클론) 음성
#   POST /v1/audio/transcriptions  (STT)  — 우리 faster-whisper large-v3(ko)

app = FastAPI(title="neru OpenAI-compatible audio gateway")

_settings = load_settings()

# 모델은 무거우니 프로세스당 1회 지연 로드 후 재사용.
_tts = ChatterboxTTS(audio_prompt_path=_settings.tts_voice_prompt)
# TTS generate()를 직렬화 — 동시 요청이 같은 CUDA 모델에서 겹치면 오디오가 깨지거나
# CUDA 오류가 난다(ChatterboxTTS 내부 락은 로드만 보호, generate는 미보호).
_tts_lock = asyncio.Lock()

# faster-whisper 모델과 로드 직렬화 락(단일 GPU 동시 로드 방지).
_whisper_model = None
_whisper_lock = asyncio.Lock()


async def _get_whisper():
    global _whisper_model
    if _whisper_model is not None:
        return _whisper_model
    async with _whisper_lock:
        if _whisper_model is None:
            _whisper_model = await asyncio.to_thread(_load_whisper)
    return _whisper_model


def _load_whisper():
    # CTranslate2가 cuBLAS/cuDNN을 찾도록 torch 번들 lib을 PATH에 올린 뒤 로드.
    ensure_cuda_dll_path()
    from faster_whisper import WhisperModel

    return WhisperModel(_settings.stt_model_size, device="cuda", compute_type="float16")


def _pcm_to_wav(pcm: bytes, sample_rate: int) -> bytes:
    # PCM16 mono raw → WAV 컨테이너(브라우저 Web Audio가 디코드 가능).
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)  # PCM16 = 2 bytes
        wav.setframerate(sample_rate)
        wav.writeframes(pcm)
    return buf.getvalue()


@app.get("/v1/models")
async def list_models() -> JSONResponse:
    # 일부 클라이언트가 모델 목록을 조회하므로 최소 응답을 제공.
    models = [
        {"id": "chatterbox", "object": "model", "owned_by": "neru"},
        {"id": _settings.stt_model_size, "object": "model", "owned_by": "neru"},
    ]
    return JSONResponse({"object": "list", "data": models})


@app.post("/v1/audio/speech")
async def speech(body: dict) -> Response:
    # OpenAI: {model, input, voice?, response_format?, speed?} → 오디오 바이트.
    text = (body.get("input") or "").strip()
    if not text:
        return JSONResponse({"error": "input is required"}, status_code=400)

    pcm = bytearray()
    async with _tts_lock:  # 동시 합성 직렬화(위 _tts_lock 주석 참고)
        async for chunk in _tts.synthesize(text):
            pcm.extend(chunk)

    sample_rate = _tts.sample_rate or 24000
    fmt = (body.get("response_format") or "wav").lower()
    if fmt == "pcm":
        # OpenAI 'pcm' = 16bit 24kHz mono raw little-endian.
        return Response(content=bytes(pcm), media_type="audio/pcm")
    # 그 외(mp3 요청 포함)는 WAV로 반환 — 별도 인코더 의존성 없이 브라우저가 재생.
    return Response(content=_pcm_to_wav(bytes(pcm), sample_rate), media_type="audio/wav")


@app.post("/v1/audio/transcriptions")
async def transcriptions(
    file: UploadFile,
    model: str = Form(default=""),
    language: str = Form(default=""),
    response_format: str = Form(default="json"),
) -> Response:
    # OpenAI: multipart {file, model, language?, response_format?} → {text}.
    data = await file.read()
    lang = language or "ko"  # neru는 한국어 입력 기본
    whisper = await _get_whisper()
    # BytesIO를 PyAV로 디코드하므로 임의 컨테이너(webm/wav) 수용. 전사 정책은 STT provider와 공유.
    text = await asyncio.to_thread(transcribe, whisper, io.BytesIO(data), lang)

    if response_format == "text":
        return PlainTextResponse(text)
    return JSONResponse({"text": text})


def main() -> None:
    import uvicorn

    # 0.0.0.0가 아닌 localhost 바인딩 — 로컬 AIRI만 접근.
    uvicorn.run(app, host="127.0.0.1", port=3457, log_level="info")


if __name__ == "__main__":
    main()
