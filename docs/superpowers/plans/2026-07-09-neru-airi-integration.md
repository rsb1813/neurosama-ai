# neru → AIRI 통합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 자체 Python 백엔드/프론트를 없애고, GPU 음성 기술만 `airi/services/neru-audio/`로 통합해 Electron이 자동 기동하는 "AIRI 하나" 구조로 만든다.

**Architecture:** AIRI 포크가 유일한 시스템. 우리 고유 자산(Chatterbox Neuro 음성 + faster-whisper 한국어)은 OpenAI 호환 HTTP 게이트웨이(FastAPI, `127.0.0.1:3457`)로 `airi/services/neru-audio/`에 상주한다. Electron 메인 프로세스가 앱 실행 시 이 게이트웨이를 `uv run` child process로 spawn하고 종료 시 kill한다. AIRI provider 3개(LLM 프록시 3456, STT/TTS 3457)는 localStorage 프리시드로 온보딩 없이 연결한다.

**Tech Stack:** Python 3.11 + FastAPI/uvicorn, torch cu128, chatterbox-tts, faster-whisper; TypeScript + Electron(electron-vite) + injeca DI; pnpm 모노레포; uv.

## Global Constraints

- **Python 버전/의존성 (verbatim)**: `requires-python = ">=3.11,<3.13"`; torch/torchaudio는 cu128 인덱스 + `override-dependencies = ["torch==2.9.0+cu128", "torchaudio==2.9.0+cu128"]`; `setuptools<81`; `numba>=0.61`; `numpy<2`.
- **게이트웨이 바인딩**: `127.0.0.1:3457` (localhost 전용).
- **AIRI provider ID (verbatim)**: LLM=`openai-compatible`, STT=`openai-compatible-audio-transcription`, TTS=`openai-compatible-audio-speech`.
- **provider 저장 필드**: `apiKey`, `baseUrl` (baseUrl은 끝에 `/` 필수).
- **localStorage 키 (verbatim)**: `settings/credentials/providers`, `settings/providers/added`, `onboarding/completed`, `settings/consciousness/active-provider`, `settings/consciousness/active-model`, `settings/speech/active-provider`, `settings/speech/active-model`, `settings/hearing/active-provider`, `settings/hearing/active-model`.
- **소스 파일 헤더**: 새 Python/TS 파일 첫 줄은 역할을 설명하는 한국어 주석. 식별자·문자열 영어, 주석 한국어. config 파일은 헤더 생략.
- **AIRI 코드 규약 (airi/AGENTS.md)**: TS 파일명 camelCase, injeca DI + `node:` prefix 빌트인, gitmoji 금지, Conventional Commits(`feat(stage-tamagotchi): ...`).
- **커밋**: 영어 메시지, `git -c commit.gpgsign=false`, 끝에 두 줄 —
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012HfcS1r6hZn5Z5QeRdCNxj`
- **커밋 전 시크릿 스캔**: 스테이지에 `.env`/키/토큰 없음 확인. `airi/` 하위는 nested `.gitignore`가 node_modules/dist 제외.
- **검증 성격**: 이 작업은 이관·삭제·런타임 배선이라 단위 TDD보다 "실행해서 관찰"이 주 검증이다. 각 Task는 구체적 실행 커맨드 + 기대 관찰로 게이트한다.

---

## File Structure

```
airi/services/neru-audio/            (신규 Python 서비스)
├─ pyproject.toml
├─ .python-version                   (3.11)
├─ README.md
├─ neru_audio/
│  ├─ __init__.py
│  ├─ app.py                         (FastAPI 게이트웨이 + main())
│  ├─ tts.py                         (ChatterboxTTS, ABC 없음)
│  ├─ gpu.py                         (ensure_cuda_dll_path, transcribe)
│  └─ config.py                      (Settings: 음성 프롬프트 + STT 모델 크기)
└─ assets/voices/neuro_ref.wav

airi/apps/stage-tamagotchi/src/main/services/neru-audio/
└─ index.ts                          (신규: 게이트웨이 spawn/kill 매니저 + injeca 등록)

airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts   (신규: provider 프리시드)

삭제: 루트 backend/ 전체, 루트 frontend/ 전체
```

---

### Task 1: `airi/services/neru-audio/` Python 게이트웨이 서비스 생성 (기존 GPU 코드 이관)

**Files:**
- Create: `airi/services/neru-audio/pyproject.toml`
- Create: `airi/services/neru-audio/.python-version`
- Create: `airi/services/neru-audio/README.md`
- Create: `airi/services/neru-audio/neru_audio/__init__.py`
- Create: `airi/services/neru-audio/neru_audio/gpu.py` (from `backend/src/neru/gpu.py`, 내용 동일)
- Create: `airi/services/neru-audio/neru_audio/config.py` (아래 전체 내용)
- Create: `airi/services/neru-audio/neru_audio/tts.py` (from `backend/src/neru/tts/chatterbox_local.py`, ABC 제거)
- Create: `airi/services/neru-audio/neru_audio/app.py` (from `backend/src/neru/bridge/openai_audio.py`, import 조정)
- Create: `airi/services/neru-audio/assets/voices/neuro_ref.wav` (from `backend/assets/voices/neuro_ref.wav`, 복사)

**Interfaces:**
- Produces: `uv run neru-audio` → `127.0.0.1:3457`에서 `GET /v1/models`, `POST /v1/audio/speech`, `POST /v1/audio/transcriptions` 서빙. Task 3(Electron)이 이 실행 커맨드와 포트에 의존.

- [ ] **Step 1: 디렉터리 + 자산 복사**

```bash
cd /c/Users/jolib/Documents/neurosama-ai
mkdir -p airi/services/neru-audio/neru_audio airi/services/neru-audio/assets/voices
cp backend/assets/voices/neuro_ref.wav airi/services/neru-audio/assets/voices/neuro_ref.wav
cp backend/src/neru/gpu.py airi/services/neru-audio/neru_audio/gpu.py
printf '3.11\n' > airi/services/neru-audio/.python-version
: > airi/services/neru-audio/neru_audio/__init__.py
```

- [ ] **Step 2: `pyproject.toml` 작성 (정리된 의존성)**

Create `airi/services/neru-audio/pyproject.toml`:

```toml
[project]
name = "neru-audio"
version = "0.1.0"
description = "neru local GPU audio gateway (OpenAI-compatible STT+TTS) for AIRI"
requires-python = ">=3.11,<3.13"
dependencies = [
    "fastapi>=0.115",
    "uvicorn>=0.34",
    "python-multipart>=0.0.12",
    "python-dotenv>=1.0",
    "torch>=2.9.0",
    "torchaudio>=2.9.0",
    "chatterbox-tts>=0.1.7",
    "faster-whisper>=1.2",
    "setuptools<81",
    "numba>=0.61",
    "numpy<2",
]

[project.scripts]
neru-audio = "neru_audio.app:main"

[tool.uv.sources]
torch = { index = "pytorch-cu128" }
torchaudio = { index = "pytorch-cu128" }

[[tool.uv.index]]
name = "pytorch-cu128"
url = "https://download.pytorch.org/whl/cu128"
explicit = true

[tool.uv]
override-dependencies = ["torch==2.9.0+cu128", "torchaudio==2.9.0+cu128"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["neru_audio"]
```

- [ ] **Step 3: `config.py` 작성 (정리본 — LLM/VTS/mic 설정 제거)**

Create `airi/services/neru-audio/neru_audio/config.py`:

```python
# 게이트웨이 런타임 설정 — 클로닝 음성 경로와 STT 모델 크기 (.env 있으면 로드)
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# 기본 클로닝 음성(Neuro-sama 레퍼런스). config.py 기준 ../assets/voices/.
_DEFAULT_VOICE_PROMPT = Path(__file__).resolve().parents[1] / "assets" / "voices" / "neuro_ref.wav"

try:  # python-dotenv는 선택적 — 없으면 실제 환경변수만 사용
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:  # pragma: no cover
    pass


@dataclass(frozen=True)
class Settings:
    """게이트웨이 실행에 필요한 설정."""

    # TTS 클로닝 대상 음성 wav 경로. None이면 Chatterbox 기본 음성.
    tts_voice_prompt: str | None
    # faster-whisper 모델 크기.
    stt_model_size: str


def load_settings() -> Settings:
    # NERU_TTS_VOICE_PROMPT: 빈 문자열이면 기본 음성, 미설정이면 번들 Neuro 레퍼런스.
    voice_prompt = os.getenv("NERU_TTS_VOICE_PROMPT")
    if voice_prompt is None:
        voice_prompt = str(_DEFAULT_VOICE_PROMPT)
    elif voice_prompt == "":
        voice_prompt = None
    return Settings(
        tts_voice_prompt=voice_prompt,
        stt_model_size=os.getenv("NERU_STT_MODEL_SIZE", "large-v3"),
    )
```

- [ ] **Step 4: `tts.py` 작성 (Chatterbox, ABC 상속 제거)**

`backend/src/neru/tts/chatterbox_local.py`를 복사하되 단 두 곳만 바꾼다: (1) `from .base import TTSProvider` import 줄 삭제, (2) 클래스 선언 `class ChatterboxTTS(TTSProvider):` → `class ChatterboxTTS:`. 나머지 본문(지연 로드 락, `synthesize`, PCM16 청킹)은 그대로.

```bash
cp backend/src/neru/tts/chatterbox_local.py airi/services/neru-audio/neru_audio/tts.py
```
그 뒤 `tts.py`에서:
- 삭제: `from .base import TTSProvider`
- 변경: `class ChatterboxTTS(TTSProvider):` → `class ChatterboxTTS:`
- 첫 줄 헤더 주석은 유지(이미 한국어 헤더 있음).

- [ ] **Step 5: `app.py` 작성 (게이트웨이, 패키지 상대 import 조정)**

`backend/src/neru/bridge/openai_audio.py`를 복사하되 import를 새 패키지 구조에 맞춘다.

```bash
cp backend/src/neru/bridge/openai_audio.py airi/services/neru-audio/neru_audio/app.py
```
그 뒤 `app.py`에서 상단 import 블록을 아래로 교체(기존은 `from ..config`, `from ..gpu`, `from ..tts.chatterbox_local`):

```python
from .config import load_settings
from .gpu import ensure_cuda_dll_path, transcribe
from .tts import ChatterboxTTS
```
`main()` 함수(`uvicorn.run(app, host="127.0.0.1", port=3457, ...)`)와 `if __name__ == "__main__": main()`는 그대로 둔다.

- [ ] **Step 6: README + uv sync**

Create `airi/services/neru-audio/README.md`:

```markdown
# neru-audio

Local GPU audio gateway for the AIRI fork. Exposes OpenAI-compatible
`/v1/audio/speech` (Chatterbox, Neuro-cloned voice) and
`/v1/audio/transcriptions` (faster-whisper large-v3, Korean) on
`127.0.0.1:3457`. Auto-spawned by the Electron desktop app in dev via
`uv run neru-audio`.
```

Run:
```bash
cd /c/Users/jolib/Documents/neurosama-ai/airi/services/neru-audio
uv sync
```
Expected: 환경 생성, torch cu128 + chatterbox + faster-whisper 설치 (첫 설치는 수 분, uv 캐시 웜이면 빠름). 에러 없이 완료.

- [ ] **Step 7: 서비스 기동 + 헬스 검증**

```bash
cd /c/Users/jolib/Documents/neurosama-ai/airi/services/neru-audio
uv run neru-audio &
sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3457/v1/models
```
Expected: `200`. (모델 목록 엔드포인트는 GPU 모델을 로드하지 않으므로 빠르게 응답.)

전체 오디오(무거움, Chatterbox 최초 로드 시 모델 다운로드로 수 분) 수동 스모크:
```bash
curl -s -X POST http://127.0.0.1:3457/v1/audio/speech -H "content-type: application/json" \
  -d '{"model":"chatterbox","input":"hello from neru","response_format":"wav"}' --output /tmp/neru.wav
# 기대: /tmp/neru.wav가 RIFF/WAVE 헤더의 재생 가능한 파일
```
확인 후 백그라운드 서비스 종료(`kill %1`).

- [ ] **Step 8: 커밋**

시크릿 스캔 후:
```bash
cd /c/Users/jolib/Documents/neurosama-ai
git add airi/services/neru-audio
git -c commit.gpgsign=false commit -m "feat(neru-audio): relocate GPU audio gateway into the AIRI fork

Standalone FastAPI service (OpenAI-compatible /v1/audio/speech via Chatterbox
and /v1/audio/transcriptions via faster-whisper). Reuses gpu.py; ChatterboxTTS
drops the provider ABC. Runs with 'uv run neru-audio' on 127.0.0.1:3457.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012HfcS1r6hZn5Z5QeRdCNxj"
```
Note: `neuro_ref.wav`는 우리가 만든 자산이라 커밋에 포함(모델과 달리 저작권 이슈 없음, 기존 backend에서도 추적됨).

---

### Task 2: 병렬 자체 시스템 삭제 (backend/ + frontend/)

**Files:**
- Preserve→Create: `docs/superpowers/specs/neru-persona-reference.md` (persona.py 내용 보존)
- Delete: `backend/` 전체
- Delete: `frontend/` 전체

**Interfaces:**
- Consumes: Task 1의 `neru-audio` 서비스가 독립 동작함(백엔드 코드에 대한 의존 없음).

- [ ] **Step 1: neru 페르소나 내용 보존 (삭제 전)**

`backend/src/neru/persona.py`를 열어 시스템 프롬프트/성격 텍스트를 확인하고, 그 핵심(영어 발화 + 한국어 자막 규칙, 성격 묘사)을 `docs/superpowers/specs/neru-persona-reference.md`에 옮겨 적는다(후속 "캐릭터 카드" 스펙의 입력). 파일 상단에 목적 한 줄(한국어) 기재.

```bash
# persona.py를 읽고 내용을 참조 문서로 옮긴 뒤:
git add docs/superpowers/specs/neru-persona-reference.md
```

- [ ] **Step 2: 삭제 대상에 대한 잔존 참조 없음 확인**

```bash
cd /c/Users/jolib/Documents/neurosama-ai
grep -rniE "from neru|import neru|neru\.orchestrator|backend/src" airi/ docs/ --include=*.ts --include=*.py --include=*.md | grep -v "neru-audio\|neru_audio" || echo "no stale refs"
```
Expected: `no stale refs` (또는 neru-audio 관련만 — 그건 정상).

- [ ] **Step 3: 삭제 실행**

```bash
git rm -r backend frontend
```
Expected: backend/ 및 frontend/의 추적 파일 전부 삭제 스테이지.

- [ ] **Step 4: 검증 — 서비스는 여전히 동작, 트리 정상**

```bash
ls backend frontend 2>/dev/null || echo "removed"
cd airi/services/neru-audio && uv run neru-audio & sleep 5
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3457/v1/models   # 기대 200
kill %1
```
Expected: `removed` + `200` (서비스는 이관본으로 독립 동작).

- [ ] **Step 5: 커밋**

```bash
cd /c/Users/jolib/Documents/neurosama-ai
git -c commit.gpgsign=false commit -m "chore: remove parallel self-built backend and frontend

The AIRI fork now owns orchestration, avatar, turn-taking and subtitles; only
the GPU audio gateway remained unique and moved to airi/services/neru-audio in
the prior commit. neru persona content preserved in specs for a follow-on
character-card spec.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012HfcS1r6hZn5Z5QeRdCNxj"
```

---

### Task 3: Electron 메인이 게이트웨이 자동 spawn/kill (dev 모드)

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/main/services/neru-audio/index.ts`
- Modify: `airi/apps/stage-tamagotchi/src/main/index.ts` (모듈 등록 + eager invoke)

**Interfaces:**
- Consumes: Task 1의 `uv run neru-audio` (cwd=서비스 dir), 포트 `3457`, `GET /v1/models` 헬스.
- Consumes (AIRI): `injeca.provide` / `injeca.invoke` (`src/main/index.ts`), `onAppBeforeQuit` (`src/main/libs/bootkit/lifecycle.ts`), `is` from `@electron-toolkit/utils`. 참조 템플릿: `src/main/services/airi/godot-stage/index.ts` (spawn + kill + dev/packaged 분기).
- Produces: injeca 모듈 `modules:neru-audio` — 앱 ready 시 게이트웨이 기동, quit 시 kill.

- [ ] **Step 1: spawn 매니저 모듈 작성**

Create `airi/apps/stage-tamagotchi/src/main/services/neru-audio/index.ts`:

```ts
// neru-audio 게이트웨이(Python)를 앱 실행 시 spawn하고 종료 시 kill하는 매니저
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

import { onAppBeforeQuit } from '../../libs/bootkit/lifecycle'

const HEALTH_URL = 'http://127.0.0.1:3457/v1/models'

// app.getAppPath()(=apps/stage-tamagotchi, dev)에서 위로 올라가며 pnpm-workspace.yaml이
// 있는 airi 루트를 찾는다. ESM/CJS 모듈 형식에 무관(import.meta·__dirname 미사용).
function findWorkspaceRoot(): string {
  let dir = app.getAppPath()
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml')))
      return dir
    dir = dirname(dir)
  }
  throw new Error('[neru-audio] pnpm-workspace.yaml을 찾지 못했습니다')
}

async function waitForHealth(timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL)
      if (res.ok)
        return true
    }
    catch {
      // 아직 기동 전 — 재시도
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

function createNeruAudioManager() {
  let child: ChildProcess | undefined

  async function start(): Promise<void> {
    if (!is.dev) {
      // 패키지 배포에서의 Python 번들링은 후속 스펙. dev(uv)에서만 자동 기동.
      console.warn('[neru-audio] packaged 모드 자동 기동은 미구현 — 게이트웨이를 수동 실행하세요')
      return
    }
    const serviceDir = join(findWorkspaceRoot(), 'services', 'neru-audio')
    child = spawn('uv', ['run', 'neru-audio'], {
      cwd: serviceDir,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Windows에서 uv.CMD 해석
    })
    child.stdout?.on('data', d => console.warn(`[neru-audio] ${String(d).trim()}`))
    child.stderr?.on('data', d => console.warn(`[neru-audio] ${String(d).trim()}`))
    child.on('exit', (code) => { console.warn(`[neru-audio] exited code=${code}`); child = undefined })

    const healthy = await waitForHealth()
    if (!healthy)
      console.error('[neru-audio] 헬스 체크 타임아웃 — 게이트웨이가 응답하지 않습니다')
    else
      console.warn('[neru-audio] 게이트웨이 준비됨 (127.0.0.1:3457)')
  }

  function stop(): void {
    if (child && !child.killed)
      child.kill()
    child = undefined
  }

  return { start, stop }
}

export function setupNeruAudioManager() {
  const manager = createNeruAudioManager()
  onAppBeforeQuit(async () => { manager.stop() })
  void manager.start()
  return manager
}
```

- [ ] **Step 2: `index.ts`에 모듈 등록**

`airi/apps/stage-tamagotchi/src/main/index.ts`에서 다른 `injeca.provide('modules:...')`들(예: `modules:channel-server`, `modules:godot-stage-manager`) 근처에 추가:

```ts
const neruAudio = injeca.provide('modules:neru-audio', {
  dependsOn: {},
  build: async () => setupNeruAudioManager(),
})
```
파일 상단에 import 추가:
```ts
import { setupNeruAudioManager } from './services/neru-audio'
```
그리고 모듈이 **eager로 build되도록**, `injeca.invoke({ dependsOn: { ... } })` 목록(godot-stage 등이 들어있는 곳)에 `neruAudio`를 추가한다(의존되지 않으면 build되지 않음 — 조사에서 확인).

- [ ] **Step 3: typecheck**

```bash
cd /c/Users/jolib/Documents/neurosama-ai/airi
pnpm -F @proj-airi/stage-tamagotchi typecheck
```
Expected: 신규 모듈 관련 타입 에러 없음. (기존 코드베이스의 무관한 에러가 있으면 신규 파일 관련만 해결.)

- [ ] **Step 4: 검증 — 앱 실행 시 게이트웨이 자동 기동, 종료 시 정리**

먼저 수동으로 떠 있는 3457 서비스가 없는지 확인(있으면 kill). 그 뒤:
```bash
cd /c/Users/jolib/Documents/neurosama-ai/airi
CI=true pnpm desktop &
# 앱 로딩 후(약 20~40초):
sleep 40
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3457/v1/models   # 기대 200 (Electron이 spawn함)
```
그 다음 데스크톱 앱을 닫고(또는 electron 프로세스 종료):
```bash
powershell.exe -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force"
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3457/v1/models 2>/dev/null || echo "gateway stopped"
```
Expected: 앱 실행 중엔 `200`, 종료 후엔 `gateway stopped` (child가 함께 종료됨).

- [ ] **Step 5: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/main/services/neru-audio airi/apps/stage-tamagotchi/src/main/index.ts
git -c commit.gpgsign=false commit -m "feat(stage-tamagotchi): auto-spawn neru-audio gateway on launch

Electron main spawns 'uv run neru-audio' (dev) on app ready, health-polls
127.0.0.1:3457, and kills the child on quit. Modeled on the godot-stage
sidecar manager. Packaged-mode Python bundling is a follow-on.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012HfcS1r6hZn5Z5QeRdCNxj"
```

---

### Task 4: AIRI provider 프리시드 (온보딩 없이 3개 연결)

**Files:**
- Create: `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`
- Modify: 렌더러 엔트리(예: `airi/apps/stage-tamagotchi/src/renderer/main.ts`) — 최상단에서 프리시드 import

**Interfaces:**
- Produces: 첫 실행 시 localStorage에 LLM(3456)·STT/TTS(3457) provider + onboarding 완료 플래그를 기록. 이미 값이 있으면 건드리지 않음(사용자 편집 보존).

- [ ] **Step 1: 렌더러 엔트리 파일 확인**

```bash
ls airi/apps/stage-tamagotchi/src/renderer/main.ts 2>/dev/null \
  || grep -rl "createApp\|mount(" airi/apps/stage-tamagotchi/src/renderer --include=*.ts | head
```
결과의 파일이 렌더러 부트스트랩 엔트리다(이하 `<RENDERER_ENTRY>`).

- [ ] **Step 2: 프리시드 모듈 작성**

Create `airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts`:

```ts
// AIRI provider를 로컬 서비스로 프리시드 — 온보딩 없이 LLM(3456)·STT/TTS(3457) 연결
// 첫 실행 시 localStorage가 비어 있을 때만 기록해 사용자 편집을 덮어쓰지 않는다.
function seed(key: string, value: unknown): void {
  if (localStorage.getItem(key) === null)
    localStorage.setItem(key, JSON.stringify(value))
}

export function preseedNeruProviders(): void {
  const LLM = 'openai-compatible'
  const STT = 'openai-compatible-audio-transcription'
  const TTS = 'openai-compatible-audio-speech'

  // 게이트웨이·프록시는 apiKey를 검사하지 않지만 스키마상 필요 → 더미.
  seed('settings/credentials/providers', {
    [LLM]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3456/v1/' },
    [STT]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3457/v1/' },
    [TTS]: { apiKey: 'sk-local-proxy', baseUrl: 'http://localhost:3457/v1/' },
  })
  seed('settings/providers/added', { [LLM]: true, [STT]: true, [TTS]: true })

  // 각 모듈이 프리시드된 provider를 가리키게(모델명은 게이트웨이가 무시).
  seed('settings/consciousness/active-provider', LLM)
  seed('settings/consciousness/active-model', 'claude-opus-4-7')
  seed('settings/hearing/active-provider', STT)
  seed('settings/hearing/active-model', 'large-v3')
  seed('settings/speech/active-provider', TTS)
  seed('settings/speech/active-model', 'chatterbox')

  // 온보딩 위저드 건너뛰기.
  seed('onboarding/completed', true)
}
```

- [ ] **Step 3: 렌더러 엔트리 최상단에서 호출**

`<RENDERER_ENTRY>`의 **가장 위**(Pinia/스토어 생성 전, VueUse `useLocalStorage`가 값을 읽기 전)에 추가:

```ts
import { preseedNeruProviders } from './neruPreseed'

preseedNeruProviders()
```

- [ ] **Step 4: typecheck**

```bash
cd /c/Users/jolib/Documents/neurosama-ai/airi
pnpm -F @proj-airi/stage-tamagotchi typecheck
```
Expected: 신규 파일 관련 타입 에러 없음.

- [ ] **Step 5: 검증 — 새 프로필로 온보딩 없이 연결**

localStorage가 비어야 첫-실행 경로를 타므로, 데스크톱 앱의 저장 데이터를 초기화하거나(앱 종료 후) 새 프로필로 실행한다. 게이트웨이+프록시가 떠 있는 상태에서:
```bash
cd /c/Users/jolib/Documents/neurosama-ai/airi
CI=true pnpm desktop &
sleep 40
```
데스크톱 창에서: 온보딩 위저드가 **뜨지 않고** 바로 메인 화면이며, 채팅에 한국어로 입력 → Claude 응답이 표시되면 성공. (LLM 경로 확인. STT/TTS는 Task 3 게이트웨이 + 후속 음성 기능에서 실사용.)

- [ ] **Step 6: 커밋**

```bash
git add airi/apps/stage-tamagotchi/src/renderer/neruPreseed.ts <RENDERER_ENTRY>
git -c commit.gpgsign=false commit -m "feat(stage-tamagotchi): preseed local providers, skip onboarding

Seeds LLM (proxy 3456) and STT/TTS (gateway 3457) OpenAI-compatible providers
into localStorage on first run and marks onboarding complete, so the app
connects to the local stack without the wizard. Only seeds absent keys.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012HfcS1r6hZn5Z5QeRdCNxj"
```

---

### Task 5: 문서 갱신 (새 구조 반영)

**Files:**
- Modify: `WORKSPACE.md`
- Modify: `checklist.md`
- Modify: `context-notes.md`
- Modify: `.meridian/docs/pipeline-architecture.md`

- [ ] **Step 1: 문서 갱신**

- `WORKSPACE.md`: 구조를 "AIRI 포크 하나 + `airi/services/neru-audio` GPU 게이트웨이"로 갱신. 자체 backend/frontend 삭제 반영. Known Issues에 "패키지 Python 번들링 미해결" 추가.
- `checklist.md`: 통합 마일스톤(Task 1~5) 체크. 기존 M-C/M-D(브릿지)를 이 구조로 대체 표기.
- `context-notes.md`: 이번 통합 결정·구조·삭제 목록·프리시드 키를 append.
- `.meridian/docs/pipeline-architecture.md`: 파이프라인을 "AIRI(마이크·STT·LLM·아바타·자막) + neru-audio 게이트웨이(GPU STT/TTS)"로 갱신. VTube/자체 오케스트레이터 서술 제거 또는 "레거시(삭제됨)" 표기.

- [ ] **Step 2: 커밋**

```bash
git add WORKSPACE.md checklist.md context-notes.md .meridian/docs/pipeline-architecture.md
git -c commit.gpgsign=false commit -m "docs: reflect AIRI-integrated single-system structure

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012HfcS1r6hZn5Z5QeRdCNxj"
```

---

## 검증 요약 (DoD)

- `airi/services/neru-audio`가 `uv run neru-audio`로 독립 기동, `/v1/models` 200 + `/v1/audio/speech` WAV 반환.
- 루트 `backend/`·`frontend/` 삭제됨, 잔존 참조 없음.
- `pnpm desktop` 한 번 실행 → Electron이 게이트웨이 자동 spawn(3457 응답), 종료 시 child 정리.
- 새 프로필 실행 시 온보딩 없이 provider 3개 연결, 한국어 입력→Claude 응답.
- 문서가 새 구조 반영.
