# AIRI 연동용 OpenAI 호환 오디오 게이트웨이 — 로컬 Chatterbox TTS·faster-whisper STT를 HTTP로 노출
from __future__ import annotations

import asyncio
import hmac
import io
import logging
import wave

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse, Response

from .config import load_settings
from .gpu import ensure_cuda_dll_path, transcribe
from .tts import ChatterboxTTS

logger = logging.getLogger(__name__)

# AIRI provider가 baseUrl=http://localhost:3457/v1 로 STT/TTS를 함께 호출한다.
# OpenAI Audio API 형식만 맞추면 AIRI 코드 수정 없이 붙는다:
#   POST /v1/audio/speech          (TTS)  — 우리 Chatterbox(Neuro 클론) 음성
#   POST /v1/audio/transcriptions  (STT)  — 우리 faster-whisper large-v3(ko)

app = FastAPI(title="neru OpenAI-compatible audio gateway")

_settings = load_settings()

_GATEWAY_HOST = "127.0.0.1"
_GATEWAY_PORT = 3457
_ALLOWED_HOSTS = {f"{_GATEWAY_HOST}:{_GATEWAY_PORT}", f"localhost:{_GATEWAY_PORT}"}
# 오디오 업로드 상한 — 정상 음성 클립엔 넉넉하고, CSRF발 무제한 업로드로 인한 OOM/GPU DoS는 차단.
_MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_EXPECTED_AUTHORIZATION = f"Bearer {_settings.api_key}"


@app.middleware("http")
async def _restrict_to_local_app(request: Request, call_next):
    # multipart/form-data POST는 CORS "simple request"라 프리플라이트 없이 크로스오리진으로도
    # 전송된다 — 외부 웹페이지가 사용자가 열어둔 이 게이트웨이로 드라이브바이 요청을 쏠 수 있다.
    # Host를 강제해 DNS 리바인딩을, Origin 허용목록으로 브라우저發 크로스사이트 요청을 막는다.
    # Origin/Host는 브라우저가 아닌 클라이언트(curl, 로컬의 다른 프로세스)라면 자유롭게 위조
    # 가능하므로, Authorization: Bearer 토큰을 추가로 요구해 실제 접근 제어로 삼는다 — 이 헤더는
    # CORS 단순 요청 조건을 깨뜨려 프리플라이트를 강제하는 부수효과도 있다.
    if request.url.path.startswith("/v1/"):
        host = request.headers.get("host", "")
        if host not in _ALLOWED_HOSTS:
            return JSONResponse({"error": "forbidden"}, status_code=403)

        authorization = request.headers.get("authorization", "")
        if not hmac.compare_digest(authorization, _EXPECTED_AUTHORIZATION):
            return JSONResponse({"error": "unauthorized"}, status_code=401)

        origin = request.headers.get("origin")
        # Origin: null(file:// 페이지, 또는 이를 흉내낸 로컬 공격 페이지)도 차단 — 값을 아는
        # 대상만 허용목록에 남긴다.
        if origin is not None:
            origin_host = origin.split("://", 1)[-1].split(":")[0]
            if origin_host not in (_GATEWAY_HOST, "localhost"):
                return JSONResponse({"error": "forbidden"}, status_code=403)

        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                too_large = int(content_length) > _MAX_UPLOAD_BYTES
            except ValueError:
                too_large = False
            if too_large:
                return JSONResponse({"error": "payload too large"}, status_code=413)

    return await call_next(request)


async def _read_upload_capped(file: UploadFile, limit: int) -> bytes:
    # Content-Length 없는 청크 전송도 대비해 실제로 읽은 바이트 수를 직접 상한.
    data = bytearray()
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        data.extend(chunk)
        if len(data) > limit:
            raise HTTPException(status_code=413, detail="payload too large")
    return bytes(data)


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
    data = await _read_upload_capped(file, _MAX_UPLOAD_BYTES)
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
    uvicorn.run(app, host=_GATEWAY_HOST, port=_GATEWAY_PORT, log_level="info")


if __name__ == "__main__":
    main()
