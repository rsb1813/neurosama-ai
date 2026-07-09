# neru → AIRI 포크 통합 설계

**날짜**: 2026-07-09
**상태**: 승인됨 (브레인스토밍 합의)
**범위**: 구조 이관 + Python 게이트웨이 자동 기동(개발 모드). 페르소나·이중언어·모델·리브랜딩·패키지 번들링은 후속 스펙.

---

## 배경 / 방향 전환

지금까지 neru는 **두 개의 병렬 시스템**을 가졌다.
1. 자체 Python 백엔드(`backend/`) — 오케스트레이터·provider ABC·mock·VTS 아바타·STT/TTS/LLM.
2. vendored **Project AIRI 포크**(`airi/`) — 완성도 높은 Vue/Electron 버튜버 앱.

자체 백엔드의 오케스트레이션·아바타·턴테이킹·자막은 **AIRI가 이미 하는 일**이라 중복이다. 그래서 방향을 바꾼다.

> **하나의 시스템 = AIRI 포크.** 우리의 고유 자산(GPU 음성 기술)만 AIRI 안으로 통합하고, 나머지 자체 코드는 삭제한다. 앞으로의 작업은 "AIRI에 기능 추가·수정"이다.

**유일하게 이식 불가한 자산**: Chatterbox(Neuro 목소리 클론)와 faster-whisper large-v3(한국어)는 **Python + CUDA(RTX 5080)** 다. AIRI의 TS/브라우저(transformers.js) 스택으로 옮기면 이 품질을 잃는다. 따라서 이 GPU 조각만 Python 서비스로 남아 AIRI 안에 통합된다.

**LLM은 이관 대상이 아니다** — 이미 있는 로컬 프록시(`localhost:3456`, OpenAI 호환)이며 우리 코드가 아니다. AIRI가 주소만 가리킨다.

---

## 목표 구조

```
neurosama-ai/                          (git 루트)
├─ airi/                               ← 유일한 시스템 (Project AIRI 포크)
│  ├─ apps/stage-tamagotchi/           ← 데스크톱 앱 (Electron)
│  │  └─ src/main/…/neru-audio.ts      ← 신규: Python 게이트웨이 spawn/kill (injeca DI)
│  ├─ services/neru-audio/             ← 신규: Python GPU 서비스 (STT+TTS, OpenAI 호환)
│  └─ … (AIRI 나머지 그대로)
└─ 문서 (checklist.md, context-notes.md, WORKSPACE.md, .meridian/, docs/)
```

루트 `backend/`·`frontend/`는 삭제한다. 살릴 가치가 있는 GPU 코드만 `airi/services/neru-audio/`로 재배치한다.

---

## `airi/services/neru-audio/` — Python 서비스

기존 코드를 재활용하되 **provider ABC 의존을 끊고 게이트웨이 자립형으로** 만든다.

| 대상 파일 | 출처 | 변경 |
|-----------|------|------|
| `app.py` | `backend/src/neru/bridge/openai_audio.py` | 그대로 (FastAPI: `/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/models`) |
| `tts.py` | `backend/src/neru/tts/chatterbox_local.py` | `TTSProvider` ABC 상속 제거 → 독립 클래스 |
| `gpu.py` | `backend/src/neru/gpu.py` | 그대로 (`ensure_cuda_dll_path`, `transcribe`) |
| `config.py` | `backend/src/neru/config.py` | **정리**: `tts_voice_prompt`, `stt_model_size`만 유지. LLM/VTS/mic 설정 삭제 |
| `assets/voices/neuro_ref.wav` | 동일 | 그대로 (git 추적) |
| `pyproject.toml` | `backend/pyproject.toml` | **정리** (아래) |

**whisper의 VAD·마이크(`whisper_local.py`)는 이관하지 않는다.** 그건 자체 오케스트레이터의 라이브 마이크용이었고, 이제 마이크·VAD·턴테이킹은 AIRI가 담당한다. 게이트웨이는 `WhisperModel` 직접 로드 + `gpu.transcribe`만 쓰므로 `whisper_local.py`가 필요 없다(현재 `app.py`도 이미 whisper_local을 임포트하지 않는다).

**정리된 `pyproject.toml` 의존성**: `fastapi`, `uvicorn`, `python-multipart`, `torch`/`torchaudio`(cu128), `chatterbox-tts`, `faster-whisper`, `numpy<2`, `numba>=0.61`, `setuptools<81`, `python-dotenv`. **제거**: `anthropic`, `sounddevice`, `silero-vad`, `pyvts`, `soundfile`(게이트웨이는 stdlib `wave` 사용). cu128 인덱스·override·`requires-python <3.13`·pytest는 유지.

**포트**: 게이트웨이는 `127.0.0.1:3457`(현행 유지).

---

## 삭제 (AIRI가 이미 수행)

- **오케스트레이션/이벤트**: `orchestrator.py`, `events.py`, `sink.py`, `sinks_console.py`
- **LLM**: `llm/`(base·claude·echo) — LLM은 프록시+AIRI가 호출
- **provider ABC·mock**: `stt/base.py`·`stt/scripted.py`, `tts/base.py`·`tts/silent.py`
- **아바타**: `avatar/`(base·logging·vtube_studio) — AIRI가 아바타 담당
- **STT 라이브 경로**: `stt/whisper_local.py`(VAD/mic) — AIRI가 담당
- **엔트리/페르소나**: `main.py`, `persona.py`
  - ⚠️ `persona.py`의 **neru 정체성(영어 발화 + 한국어 자막 + 성격)** 내용은 삭제 전 후속 스펙으로 보존 → AIRI **캐릭터 카드**로 이주
- **테스트/프로브**: `tests/`(orchestrator·avatar·stt provider), `scripts/`(probe_*) — 삭제 코드용. GPU 스모크가 필요하면 `neru-audio`에 최소 프로브 1개만 재작성(선택)
- **옛 프론트**: `frontend/` 전체
- 비워진 `backend/` 디렉터리 제거

---

## 자동 기동 (Electron이 게이트웨이를 spawn)

- **신규 Electron 메인 모듈** (`apps/stage-tamagotchi/src/main/` 아래, AIRI의 injeca DI·eventa 패턴을 따름):
  - 앱 ready → `neru-audio` 게이트웨이를 **child process로 spawn** (개발 모드: `uv run` in `airi/services/neru-audio`) → `/v1/models` health-poll로 기동 확인 → 로그.
  - 앱 종료(`will-quit`) → child **kill** (좀비 방지).
  - 실패 처리: 포트 점유·spawn 실패·health 타임아웃을 로그로 노출(조용히 삼키지 않음, CLAUDE.md §13·error-audit 정신).
- **AIRI provider 프리시드**: 온보딩 없이 바로 연결되도록 기본 설정 주입 — LLM→`http://localhost:3456/v1/`, STT/TTS→`http://localhost:3457/v1/`. (프리시드 방식은 AIRI provider 스토어 구조 확인 후 결정: 기본값 코드 or 초기 설정 파일.)

**검증(DoD)**: `airi.exe`/`pnpm desktop` 한 번 실행 → 게이트웨이가 자동으로 뜨고, AIRI가 STT/TTS/LLM 3개를 localhost로 연결. 앱 종료 시 Python child도 함께 종료.

---

## 알려진 리스크 (범위 밖, 후속 결정)

**패키지된 `airi.exe`의 Python 부재.** 개발 모드는 `uv run` spawn으로 충분하다(사용자 환경에 Python·uv 존재). 그러나 배포용 패키지에는 Python 런타임이 없고, torch+CUDA를 번들하면 앱이 수 GB가 된다. 후보: (a) PyInstaller 단일 exe(여전히 수 GB), (b) 사용자 사전 설치 Python 요구, (c) 별도 인스톤러. **이 스펙에서 제외**하고 별도 결정으로 둔다. 이 스펙의 자동 기동은 개발 모드(`uv run`) 기준으로 완성한다.

---

## 후속 스펙 (이번 범위 아님)

1. **neru 페르소나** — `persona.py` 내용 → AIRI 캐릭터 카드.
2. **영어 음성 + 한국어 자막** — AIRI 자막/TTS 분기 수정(코어 소폭 수정).
3. **neru 마녀 Live2D 모델** — 기본 AIRI 아바타 교체.
4. **리브랜딩** — productName·아이콘 `airi` → `neru`.
5. **패키지 Python 번들링** — 위 리스크 해결.

---

## 성공 기준 (이 스펙)

- 루트 `backend/`·`frontend/` 제거, GPU 코드는 `airi/services/neru-audio/`로 이동해 자립 실행(`uv run` → `/v1/models` 200, `/v1/audio/speech`·`/v1/audio/transcriptions` 동작).
- Electron 앱 실행 시 게이트웨이 자동 기동·종료 시 정리.
- AIRI가 3개 provider(LLM 프록시, STT, TTS)를 localhost로 프리시드 연결.
- 남은 문서(checklist·context-notes·WORKSPACE)가 새 구조를 반영.
