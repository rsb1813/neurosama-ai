# 로컬 GPU(RTX 5080) 공통 헬퍼 — CUDA DLL 경로 설정 + faster-whisper 전사 정책 공유
from __future__ import annotations

import os
import sys


def ensure_cuda_dll_path() -> None:
    # os.add_dll_directory는 Windows 전용 API — Linux/macOS에는 존재하지 않아 그대로 호출하면
    # AttributeError로 STT 전체가 500을 반환한다. CTranslate2는 Linux에서 torch가 번들한
    # CUDA 라이브러리를 일반 로더 경로로 알아서 찾으므로, POSIX에서는 이 셈이 아예 필요 없다.
    if sys.platform != "win32":
        return

    # CTranslate2가 cuBLAS/cuDNN DLL을 찾도록 torch가 번들한 lib 디렉터리를 검색 경로에 추가.
    # (별도 nvidia-* 휠 없이 torch cu128의 CUDA 런타임을 그대로 재사용)
    # 네이티브 delay-load는 add_dll_directory만으론 부족해 PATH에도 올린다.
    import torch

    lib = os.path.join(os.path.dirname(torch.__file__), "lib")
    if os.path.isdir(lib):
        os.add_dll_directory(lib)
        os.environ["PATH"] = lib + os.pathsep + os.environ.get("PATH", "")


def transcribe(model, audio, language: str = "ko") -> str:
    # STT provider(마이크 경로)와 오디오 게이트웨이(HTTP 파일 경로)가 공유하는 전사 정책.
    # faster-whisper transcribe는 np.ndarray와 file-like(BytesIO)를 모두 수용한다.
    # condition_on_previous_text=False: Whisper의 반복·환각 루프를 억제.
    segments, _ = model.transcribe(
        audio,
        language=language,
        vad_filter=False,
        condition_on_previous_text=False,
    )
    return "".join(seg.text for seg in segments).strip()
